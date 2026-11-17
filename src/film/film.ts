// Feature B: render a 3D cartoon film from a script. Kokoro voices each line,
// the timeline follows the speech, Three.js renders every frame on the GPU and
// ffmpeg encodes it with the voice mix.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { Encoder } from "../core/media.ts";
import { ROOT, fmtTime, openSession, progress, sendJson } from "../core/browser.ts";
import { SR, mouthLevels, readWav, stripTags, synthesise, writeWav } from "./audio.ts";
import { readVrmLicence } from "./vrm-meta.ts";

const FORMATS: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
  "4:5": [1080, 1352],
  "720p": [1280, 720],
  "9:16-720": [720, 1280],
};
const LEAD = 0.6; // silence before the first line
const TAIL = 1.0;

export interface Line {
  who: string;
  say?: string;
  action?: string;
  actionDur?: number;
  emotion?: string;
  react?: Record<string, string>;
  shot?: "wide" | "medium" | "close";
  moveTo?: number | { x?: number; z?: number };
  duration?: number; // silent lines
  pause?: number; // gap after this line
  delay?: number; // gap before this line
}

export interface Script {
  title?: string;
  format?: string;
  width?: number;
  height?: number;
  fps?: number;
  pause?: number;
  set?: any;
  cast: Record<string, any>;
  lines: Line[];
  music?: { path: string; db?: number };
  allowNonCommercial?: boolean;
  voiceEngine?: "kokoro" | "chatterbox";
  language?: string;
}

/** Load a script and resolve character templates ("use": "characters/an.json"). */
export function loadScript(path: string): { script: Script; dir: string } {
  const dir = dirname(resolve(path));
  const script: Script = JSON.parse(readFileSync(path, "utf8"));
  if (!script.cast || !script.lines?.length) throw new Error("kịch bản cần có 'cast' và 'lines'");
  for (const [id, c] of Object.entries(script.cast)) {
    if (c.use) {
      const p = [isAbsolute(c.use) ? c.use : join(dir, c.use), join(ROOT, c.use), join(ROOT, "characters", c.use)].find(existsSync);
      if (!p) throw new Error(`không thấy nhân vật mẫu '${c.use}' (của ${id})`);
      const { use, ...rest } = c;
      script.cast[id] = { ...JSON.parse(readFileSync(p, "utf8")), ...rest };
    }
  }
  for (const [id, c] of Object.entries(script.cast)) {
    if (!c.model) continue;
    const p = [isAbsolute(c.model) ? c.model : join(dir, c.model), join(ROOT, c.model), join(ROOT, "assets/vrm", c.model)].find(existsSync);
    if (!p) throw new Error(`không thấy file VRM '${c.model}' (của ${id})`);
    c.modelPath = p;
  }
  for (const [i, l] of script.lines.entries()) {
    if (!script.cast[l.who]) throw new Error(`câu ${i + 1}: không có nhân vật '${l.who}' trong cast`);
  }
  return { script, dir };
}

const srtTime = (s: number) => {
  const ms = Math.round(s * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

export interface FilmOpts {
  script: string;
  output?: string;
  hw?: "auto" | "cpu" | "vaapi";
  crf?: number;
  stills?: number[]; // only render these times to a contact sheet
  log?: (m: string) => void;
}

export async function film(o: FilmOpts) {
  const log = o.log ?? console.log;
  const t0 = Date.now();
  const { script, dir } = loadScript(o.script);
  const [W, H] = script.width && script.height ? [script.width, script.height] : FORMATS[script.format ?? "9:16"] ?? FORMATS["9:16"];
  const fps = script.fps ?? 30;
  const name = basename(o.script, extname(o.script));
  const output = resolve(o.output ?? join(dir, `${name}.mp4`));

  // 1. voices
  const spoken = script.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.say?.trim());
  const voiceOf = (id: string) => {
    const c = script.cast[id];
    const engine = (c.engine ?? script.voiceEngine ?? "kokoro") as "kokoro" | "chatterbox";
    const voiceRef = c.voiceRef === undefined ? undefined
      : c.voiceRef === "" ? "" : [isAbsolute(c.voiceRef) ? c.voiceRef : join(dir, c.voiceRef), join(ROOT, c.voiceRef)].find(existsSync);
    if (c.voiceRef && !voiceRef) throw new Error(`không thấy file giọng mẫu '${c.voiceRef}' (của ${id})`);
    return { voice: c.voice || (c.gender === "f" ? "af_heart" : "am_michael"), speed: c.speed ?? 1, engine, voiceRef };
  };
  const wavs = await synthesise(spoken.map(({ l }) => ({ text: l.say!.trim(), ...voiceOf(l.who) })), log);
  const clips = new Map<number, Float32Array>();
  spoken.forEach(({ i }, k) => clips.set(i, readWav(wavs[k])));

  // 2. timeline
  let cursor = LEAD;
  const timeline = script.lines.map((l, i) => {
    const clip = clips.get(i);
    const start = cursor + (l.delay ?? 0);
    const dur = clip ? clip.length / SR : (l.duration ?? 1.2);
    cursor = start + dur + (l.pause ?? script.pause ?? 0.35);
    return { ...l, text: stripTags(l.say ?? ""), start, dur };
  });
  const duration = cursor - (script.pause ?? 0.35) + TAIL;
  const frames = Math.ceil(duration * fps);

  // 3. mouth levels + voice mix
  const amp: Record<string, number[]> = {};
  for (const id of Object.keys(script.cast)) amp[id] = new Array(frames).fill(0);
  const mix = new Float32Array(Math.ceil(duration * SR));
  timeline.forEach((l, i) => {
    const clip = clips.get(i);
    if (!clip) return;
    const s0 = Math.round(l.start * SR);
    for (let k = 0; k < clip.length && s0 + k < mix.length; k++) mix[s0 + k] += clip[k];
    const f0 = Math.round(l.start * fps);
    mouthLevels(clip, fps).forEach((v, k) => {
      if (f0 + k < frames) amp[l.who][f0 + k] = Math.max(amp[l.who][f0 + k], v);
    });
  });
  let peak = 0;
  for (const v of mix) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.89) for (let i = 0; i < mix.length; i++) mix[i] *= 0.89 / peak;
  const work = join(tmpdir(), `ff_film_${process.pid}`);
  mkdirSync(work, { recursive: true });
  let audio = join(work, "voice.wav");
  writeWav(audio, mix);
  if (script.music?.path) {
    const music = isAbsolute(script.music.path) ? script.music.path : join(dir, script.music.path);
    const mixed = join(work, "mix.wav");
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", audio, "-stream_loop", "-1", "-i", music, "-filter_complex",
      `[1:a]volume=${script.music.db ?? -20}dB,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.9[a]`,
      "-map", "[a]", "-ar", "48000", "-t", String(duration), mixed]);
    if (r.status !== 0) throw new Error(`trộn nhạc nền lỗi: ${r.stderr}`);
    audio = mixed;
  }
  {
    // social-media loudness: -16 LUFS, peaks under -1.5 dB
    const norm = join(work, "final.wav");
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", audio, "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.84:level=false", norm]);
    if (r.status !== 0) throw new Error(`chuẩn hoá âm lượng lỗi: ${r.stderr}`);
    audio = norm;
  }

  // 4. subtitles beside the video (in a folder, so players don't auto-load them)
  if (!o.stills) {
    const subDir = join(dirname(output), `${basename(output, ".mp4")} - phu de`);
    mkdirSync(subDir, { recursive: true });
    const srt = timeline.filter((l) => l.text).map((l, i) =>
      `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.start + l.dur)}\n${l.text}\n`).join("\n");
    writeFileSync(join(subDir, `${script.language ?? "en"}.srt`), srt);
  }

  // 5. VRM models: licence check (monetized videos) + one URL per model
  const modelRoutes: Record<string, (q: any, res: any) => void> = {};
  const credits: string[] = [];
  for (const [id, c] of Object.entries(script.cast)) {
    if (!c.modelPath) continue;
    const lic = readVrmLicence(c.modelPath);
    if (!lic.commercial && !script.allowNonCommercial)
      throw new Error(`Nhân vật '${id}' (${basename(c.modelPath)}) KHÔNG cho dùng thương mại (${lic.note}). ` +
        `Video bật kiếm tiền thì không dùng được. Nếu chỉ làm chơi, thêm "allowNonCommercial": true vào kịch bản.`);
    if (lic.creditRequired) credits.push(`${lic.name || basename(c.modelPath)} model by ${lic.authors}${lic.licenseUrl ? ` (${lic.licenseUrl})` : ""}`);
    const url = `/model/${encodeURIComponent(id)}.vrm`;
    const file = c.modelPath;
    modelRoutes[url] = (_q, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(readFileSync(file));
    };
    c.modelUrl = url;
  }
  if (credits.length) {
    const subDir = join(dirname(output), `${basename(output, ".mp4")} - phu de`);
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "credits.txt"), credits.join("\n") + "\n");
    log(`Ghi công bắt buộc (dán vào mô tả video):\n  ${credits.join("\n  ")}`);
  }

  // 6. render
  const job = {
    width: W, height: H, fps, frames, duration, set: script.set ?? {}, characters: script.cast, timeline, amp,
    stills: o.stills,
  };
  const total = o.stills?.length ?? frames;
  log(`Phim ${W}x${H} @ ${fps} fps · ${fmtTime(duration)} · ${timeline.length} câu · ${total} frame`);

  let enc: Encoder | null = null;
  const stillFrames: Buffer[] = [];
  if (!o.stills) {
    enc = new Encoder(output, { width: W, height: H, fpsStr: String(fps), pixFmt: "yuv420p", hw: o.hw ?? "auto", crf: o.crf ?? 20,
      audio: { path: audio }, colorspace: "bt709", swsMatrix: "bt709", range: "tv" });
    log(`encode: ${enc.usesGpu ? "iGPU (VAAPI)" : "CPU"}`);
  }
  const tick = progress("render", total, log);
  let n = 0;
  const s = await openSession("/web/film/film.html", {
    ...modelRoutes,
    "/job": (_q, res) => sendJson(res, job),
    "/out": async (_q, _res, body) => {
      n++;
      if (enc) await enc.write(body);
      else stillFrames.push(body);
      tick(n);
    },
  });
  try {
    await s.finished;
    await enc?.close();
  } catch (e) {
    enc?.kill();
    if (o.hw === "auto" || o.hw === undefined) {
      if (enc?.usesGpu && /ffmpeg/.test(String((e as Error).message))) {
        await s.close();
        log("iGPU lỗi, render lại bằng CPU...");
        return film({ ...o, hw: "cpu" });
      }
    }
    throw e;
  } finally {
    await s.close();
  }

  if (o.stills) {
    const sheet = output.replace(/\.mp4$/, ".anh.png");
    const cols = Math.min(stillFrames.length, 6);
    const rows = Math.ceil(stillFrames.length / cols);
    await new Promise<void>((res, rej) => {
      const p = spawn("ffmpeg", ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", `${W}x${H}`, "-i", "-",
        "-vf", `scale=-2:${H > W ? 640 : 360},tile=${cols}x${rows}`, "-frames:v", "1", sheet], { stdio: ["pipe", "ignore", "inherit"] });
      p.on("close", (c) => (c === 0 ? res() : rej(new Error("ghép ảnh lỗi"))));
      for (const f of stillFrames) p.stdin.write(f);
      p.stdin.end();
    });
    log(`Ảnh xem trước: ${sheet}`);
    return { output: sheet, frames: n };
  }
  tick(n, true);
  log(`Xong: ${output} · ${fmtTime(duration)} phim, render ${fmtTime((Date.now() - t0) / 1000)}`);
  return { output, frames: n };
}
