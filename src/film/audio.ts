// Speech for the film: Kokoro (fast) or Chatterbox Turbo (expressive) per
// line, cached; wav read/write, mouth levels per video frame, and the mix.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../core/browser.ts";

export const SR = 24000;
const CACHE = join(homedir(), ".cache/frameforge/tts");
const TAG = /\[[a-z ]{2,20}\]/gi; // [laugh] [sigh] ... (Chatterbox only)

export function pythonForTts(): string {
  const c = [process.env.FF_PYTHON, join(homedir(), "Desktop/tool/render-video/.venv/bin/python"), "python3"];
  return c.find((p) => p && (p === "python3" || existsSync(p)))!;
}

export function pythonForChatterbox(): string | null {
  const c = [process.env.FF_CHATTERBOX_PY, join(homedir(), ".local/share/video-renderer/chatterbox-venv/bin/python")];
  return c.find((p) => p && existsSync(p)) ?? null;
}

/** Text without [tags], for Kokoro and subtitles. */
export function stripTags(s: string): string {
  return s.replace(TAG, " ").replace(/\s+/g, " ").trim();
}

export interface SpeechJob {
  text: string;
  voice: string; // kokoro voice (Chatterbox also uses it to make a reference clip)
  speed: number;
  engine?: "kokoro" | "chatterbox";
  voiceRef?: string; // Chatterbox: a >5 s wav of the voice to clone; "" = built-in voice
}

// A ~12 s line spoken by a Kokoro voice becomes that character's Chatterbox
// reference, so each character keeps a distinct voice we are free to use.
const REF_TEXT = "Well, I didn't expect that at all. Come on, let's go take a look. " +
  "Hey! Wait for me! You always run off without telling anyone. Honestly, it's fine.";

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 20);

function runWorker(py: string, script: string, jobs: object[], label: string, log: (m: string) => void, total: number) {
  const spec = join(tmpdir(), `ff_${label}_${process.pid}.json`);
  writeFileSync(spec, JSON.stringify({ jobs }));
  // stderr goes to a file: progress bars on an unread pipe can block the worker
  const errPath = spec.replace(/\.json$/, ".log");
  const errFd = openSync(errPath, "w");
  return new Promise<void>((res, rej) => {
    const p = spawn(py, [join(ROOT, "src/film", script), spec], { stdio: ["ignore", "pipe", errFd] });
    let done = 0;
    const t0 = Date.now();
    p.stdout.on("data", (d) => {
      done += String(d).match(/done \d+/g)?.length ?? 0;
      if (/done/.test(String(d))) log(`  ${label}: ${done}/${total} câu · ${Math.round((Date.now() - t0) / 1000)}s`);
    });
    p.on("close", (code) => {
      closeSync(errFd);
      if (code === 0) return res();
      const err = existsSync(errPath) ? readFileSync(errPath, "utf8").slice(-2500) : "";
      rej(new Error(`${label} lỗi (${py}):\n${err}`));
    });
  });
}

/** Synthesise every line (cached); returns wav paths in order. */
export async function synthesise(jobs: SpeechJob[], log: (m: string) => void): Promise<string[]> {
  mkdirSync(CACHE, { recursive: true });
  const cbPy = pythonForChatterbox();
  if (jobs.some((j) => j.engine === "chatterbox") && !cbPy)
    throw new Error("chưa cài Chatterbox (venv ~/.local/share/video-renderer/chatterbox-venv, hoặc đặt FF_CHATTERBOX_PY)");

  // Chatterbox reference clips made from Kokoro voices
  const refFor = (j: SpeechJob) => (j.voiceRef !== undefined ? j.voiceRef : join(CACHE, `ref_${j.voice}.wav`));
  const kokoro: object[] = [];
  const refsNeeded = new Set<string>();
  for (const j of jobs) {
    if (j.engine === "chatterbox" && j.voiceRef === undefined) {
      const r = refFor(j);
      if (!existsSync(r) && !refsNeeded.has(r)) {
        refsNeeded.add(r);
        kokoro.push({ text: REF_TEXT, voice: j.voice, speed: 1, out: r });
      }
    }
  }
  const paths = jobs.map((j) => {
    if (j.engine === "chatterbox") {
      const ref = refFor(j);
      // a user's clip is keyed by its size too (edited file = new voice); generated refs by voice name
      const refTag = !ref ? "builtin" : j.voiceRef ? hash(ref + (existsSync(ref) ? readFileSync(ref).length : "")) : `kokoro-${j.voice}`;
      return join(CACHE, `cb_${hash(`chatterbox-turbo|${refTag}|${j.text}`)}.wav`);
    }
    return join(CACHE, `${hash(`kokoro|${j.voice}|${j.speed.toFixed(3)}|${stripTags(j.text)}`)}.wav`);
  });
  jobs.forEach((j, i) => {
    if (j.engine !== "chatterbox" && !existsSync(paths[i]))
      kokoro.push({ text: stripTags(j.text), voice: j.voice, speed: j.speed, out: paths[i] });
  });
  if (kokoro.length) {
    log(`Tạo giọng Kokoro: ${kokoro.length} câu...`);
    await runWorker(pythonForTts(), "tts_worker.py", kokoro, "kokoro", log, kokoro.length);
  }
  const cb = jobs.map((j, i) => ({ j, out: paths[i] }))
    .filter(({ j, out }) => j.engine === "chatterbox" && !existsSync(out))
    .map(({ j, out }) => ({ text: j.text, out, prompt: refFor(j) }));
  if (cb.length) {
    const words = cb.reduce((n, c) => n + c.text.split(/\s+/).length, 0);
    log(`Tạo giọng Chatterbox: ${cb.length} câu (ước ~${Math.ceil((20 + words * 0.4 * 3) / 60)} phút trên CPU)...`);
    await runWorker(cbPy!, "chatterbox_worker.py", cb, "chatterbox", log, cb.length);
  }
  return paths;
}

export function readWav(path: string): Float32Array {
  let b = readFileSync(path);
  const fmtOk = b.toString("ascii", 12, 16) === "fmt " && b.readUInt16LE(20) === 1 && b.readUInt16LE(22) === 1 &&
    b.readUInt32LE(24) === SR && b.readUInt16LE(34) === 16;
  if (!fmtOk) {
    const tmp = join(tmpdir(), `ff_conv_${process.pid}.wav`);
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", path, "-ac", "1", "-ar", String(SR), "-c:a", "pcm_s16le", tmp]);
    if (r.status !== 0) throw new Error(`không đọc được ${path}: ${r.stderr}`);
    b = readFileSync(tmp);
  }
  // find the "data" chunk
  let o = 12;
  while (o < b.length - 8) {
    const id = b.toString("ascii", o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === "data") {
      const n = Math.floor(size / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
      return out;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`wav không hợp lệ: ${path}`);
}

export function writeWav(path: string, x: Float32Array, sr = SR) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  writeFileSync(path, b);
}

/** Mouth opening (0..1) per video frame for one clip. */
export function mouthLevels(x: Float32Array, fps: number): number[] {
  const per = SR / fps;
  const n = Math.ceil(x.length / per);
  const rms: number[] = [];
  for (let f = 0; f < n; f++) {
    let s = 0, c = 0;
    for (let i = Math.floor(f * per); i < Math.min(x.length, Math.floor((f + 1) * per)); i++, c++) s += x[i] * x[i];
    rms.push(Math.sqrt(s / Math.max(1, c)));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const ref = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.9)] ?? 0.05);
  const out: number[] = [];
  let prev = 0;
  for (const r of rms) {
    let v = Math.min(1, Math.pow(r / ref, 0.7));
    if (v < 0.12) v = 0;
    // open fast, close a bit slower; alternate a touch so long vowels still move
    prev = v > prev ? v : prev * 0.55 + v * 0.45;
    out.push(prev);
  }
  return out;
}

