// Feature A: recolour objects in a real video. Frames are decoded by ffmpeg,
// recoloured by a Three.js shader in headless Chrome (on the GPU) and re-encoded.
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { decode, Encoder, PngWriter, probe, type VideoInfo } from "../core/media.ts";
import { openSession, progress, sendFrame, sendJson, fmtTime } from "../core/browser.ts";

export interface RecolorOpts {
  input: string;
  output: string;
  config: string | object;
  mask?: string; // video whose R/G/B channels are masks (see README)
  start?: number;
  duration?: number;
  hw?: "auto" | "cpu" | "vaapi";
  crf?: number;
  codec?: "h264" | "vp9";
  framesDir?: string; // also save every output frame as PNG here
  log?: (m: string) => void;
}

export function loadConfig(c: string | object): any {
  return typeof c === "string" ? JSON.parse(readFileSync(c, "utf8")) : c;
}

export async function recolor(o: RecolorOpts): Promise<{ frames: number; seconds: number; gpu: boolean }> {
  const log = o.log ?? console.log;
  const info = probe(o.input);
  const config = loadConfig(o.config);
  if (o.start !== undefined && o.start >= info.duration) throw new Error(`--start ${o.start}s nằm sau cuối video (${info.duration.toFixed(3)}s)`);
  try {
    return await once(o, info, config, o.hw ?? "auto", log);
  } catch (e) {
    if ((o.hw ?? "auto") !== "auto" || /không có frame/.test(String((e as Error).message))) throw e;
    log(`iGPU lỗi (${(e as Error).message.split("\n")[0]}), render lại bằng CPU...`);
    return once(o, info, config, "cpu", log);
  }
}

async function once(o: RecolorOpts, info: VideoInfo, config: any, hw: "auto" | "cpu" | "vaapi", log: (m: string) => void) {
  const t0 = Date.now();
  const span = { start: o.start, duration: o.duration };
  // yuv420p both ways when the size allows: 2.7x less data through the browser
  const pixFmt = info.width % 4 === 0 && info.height % 2 === 0 ? "yuv420p" : "rgba";
  const range = pixFmt === "yuv420p" ? "tv" : info.range;
  const video = decode(o.input, info, { ...span, pixFmt });
  const mask = o.mask ? decode(o.mask, probe(o.mask), { ...span, width: info.width, height: info.height }) : null;
  const total = Math.round((o.duration ?? Math.max(0, info.duration - (o.start ?? 0))) * info.fps);
  const enc = new Encoder(o.output, {
    width: info.width,
    height: info.height,
    fpsStr: info.fpsStr,
    audio: info.hasAudio
      ? { path: o.input, start: o.start, duration: o.duration, copy: !o.start && !o.duration && ["aac", "mp3"].includes(info.audioCodec) }
      : null,
    hw,
    crf: o.crf ?? (o.codec === "vp9" ? 30 : 18),
    codec: o.codec,
    pixFmt,
    colorspace: info.colorspace,
    swsMatrix: info.swsMatrix,
    range,
  });
  let png: PngWriter | null = null;
  if (o.framesDir) {
    mkdirSync(o.framesDir, { recursive: true });
    png = new PngWriter(o.framesDir, { width: info.width, height: info.height, pixFmt, swsMatrix: info.swsMatrix });
  }
  log(`Đổi màu ${info.width}x${info.height} @ ${info.fps.toFixed(2)} fps, ~${total} frame · encode: ${o.codec === "vp9" ? "VP9 (CPU)" : enc.usesGpu ? "iGPU (VAAPI)" : "CPU"}`);
  const tick = progress("render", total, log);
  const s = await openSession("/web/recolor/batch.html", {
    "/job": (_q, res) =>
      sendJson(res, {
        width: info.width, height: info.height, fps: info.fps, start: o.start ?? 0, hasMask: !!mask, config,
        pixFmt, matrix: info.swsMatrix, range, debug: !!process.env.FF_DEBUG,
      }),
    "/in/video": async (_q, res) => sendFrame(res, await video.next()),
    "/in/mask": async (_q, res) => sendFrame(res, mask ? await mask.next() : null),
    "/out": async (_q, _res, body) => {
      await Promise.all([enc.write(body), png?.write(body)]);
      tick(enc.frames);
    },
  });
  try {
    await s.finished;
    if (enc.frames === 0) throw new Error("không có frame nào trong khoảng thời gian đã chọn");
    await enc.close();
    await png?.close();
  } catch (e) {
    enc.kill();
    throw e;
  } finally {
    video.close();
    mask?.close();
    await s.close();
  }
  const seconds = (Date.now() - t0) / 1000;
  tick(enc.frames, true);
  log(`Xong: ${o.output} · ${enc.frames} frame trong ${fmtTime(seconds)}`);
  return { frames: enc.frames, seconds, gpu: enc.usesGpu };
}
