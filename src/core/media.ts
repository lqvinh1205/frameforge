// ffmpeg / ffprobe side of the pipeline: probe a file, stream its frames out as
// raw RGBA, and encode RGBA frames coming back from the browser.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { Readable } from "node:stream";
import { join } from "node:path";

export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  fpsStr: string; // exact rate as ffmpeg wrote it, e.g. "30000/1001"
  frames: number;
  duration: number;
  hasAudio: boolean;
  audioCodec: string;
  colorspace: string; // tag for -colorspace (bt709, smpte170m, ...)
  swsMatrix: string; // name for swscale's in/out_color_matrix
  range: "tv" | "pc";
}

export function probe(path: string): VideoInfo {
  if (!existsSync(path)) throw new Error(`không thấy file: ${path}`);
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`ffprobe lỗi: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s: any) => s.codec_type === "video");
  if (!v) throw new Error("file không có hình");
  const a = j.streams.find((s: any) => s.codec_type === "audio");
  const rate = v.avg_frame_rate && v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : v.r_frame_rate;
  const [n, d] = rate.split("/").map(Number);
  const fps = n / (d || 1);
  const duration = Number(v.duration ?? j.format.duration ?? 0);
  let { width, height } = v;
  // ffmpeg auto-rotates phone videos when decoding, so swap to what we will get.
  const rot = Math.abs(Number(v.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0));
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  const tagged = ["bt709", "bt470bg", "smpte170m", "bt2020nc"].includes(v.color_space);
  const colorspace = tagged ? v.color_space : height >= 720 ? "bt709" : "smpte170m";
  const swsMatrix = colorspace === "bt709" ? "bt709" : colorspace === "bt2020nc" ? "bt2020" : "bt601";
  return {
    width,
    height,
    fps,
    fpsStr: rate,
    frames: Number(v.nb_frames) || Math.round(duration * fps),
    duration,
    hasAudio: !!a,
    audioCodec: a?.codec_name ?? "",
    colorspace,
    swsMatrix,
    range: v.color_range === "pc" ? "pc" : "tv",
  };
}

/** Pulls fixed-size frames out of a byte stream. */
export class FrameReader {
  readonly size: number;
  private ended = false;
  private stream: Readable;
  private chunks: Buffer[] = [];
  private have = 0;
  private wake?: () => void;
  proc?: ChildProcess;

  constructor(stream: Readable, frameBytes: number, ahead = 3) {
    this.stream = stream;
    this.size = frameBytes;
    stream.on("data", (c: Buffer) => {
      this.chunks.push(c);
      this.have += c.length;
      if (this.have >= frameBytes * ahead) stream.pause(); // keep a few frames buffered, no more
      this.wake?.();
    });
    const end = () => {
      this.ended = true;
      this.wake?.();
    };
    stream.on("end", end);
    stream.on("error", end);
  }

  async next(): Promise<Buffer | null> {
    while (this.have < this.size && !this.ended) {
      if (this.stream.isPaused()) this.stream.resume();
      await new Promise<void>((r) => (this.wake = r));
      this.wake = undefined;
    }
    if (this.have < this.size) return null; // a short tail is a cut-off frame
    const out = Buffer.allocUnsafe(this.size);
    let off = 0;
    while (off < this.size) {
      const c = this.chunks[0];
      const take = Math.min(c.length, this.size - off);
      c.copy(out, off, 0, take);
      off += take;
      if (take === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(take);
    }
    this.have -= this.size;
    if (this.stream.isPaused()) this.stream.resume();
    return out;
  }

  close() {
    this.proc?.kill("SIGKILL");
  }
}

export interface DecodeOpts {
  start?: number;
  duration?: number;
  width?: number; // scale to (mask videos)
  height?: number;
  pixFmt?: "rgba" | "yuv420p"; // yuv420p: frames stay in the file's own colours (1.5 bytes/pixel)
}

/** Decode a video to raw RGBA frames, top row first, using the file's own colour matrix. */
export function decode(path: string, info: VideoInfo, o: DecodeOpts = {}): FrameReader {
  const w = o.width ?? info.width;
  const h = o.height ?? info.height;
  const args = ["-v", "error", "-nostdin"];
  if (o.start) args.push("-ss", String(o.start));
  if (o.duration) args.push("-t", String(o.duration));
  args.push("-i", path, "-an", "-sn", "-dn");
  const fmt = o.pixFmt ?? "rgba";
  if (fmt === "rgba") args.push("-vf", `scale=${w}:${h}:in_color_matrix=${info.swsMatrix}:in_range=${info.range},format=rgba`);
  else args.push("-vf", `scale=${w}:${h}:out_range=tv,format=yuv420p`); // full-range sources become limited
  args.push("-f", "rawvideo", "-pix_fmt", fmt, "-");
  const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "inherit"] });
  const r = new FrameReader(p.stdout!, fmt === "rgba" ? w * h * 4 : (w * h * 3) / 2);
  r.proc = p;
  return r;
}

const VAAPI_DEVICE = "/dev/dri/renderD128";
let vaapiOk: boolean | undefined;

export function vaapiAvailable(): boolean {
  if (vaapiOk !== undefined) return vaapiOk;
  if (process.env.FF_HWENC === "cpu" || !existsSync(VAAPI_DEVICE)) return (vaapiOk = false);
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-vaapi_device", VAAPI_DEVICE, "-f", "lavfi", "-i", "color=black:s=256x144:d=0.2",
      "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-f", "null", "-"],
    { timeout: 20000 },
  );
  return (vaapiOk = r.status === 0);
}

export interface EncodeOpts {
  width: number;
  height: number;
  fpsStr: string;
  vflip?: boolean; // WebGL reads bottom row first (rgba input only)
  pixFmt?: "rgba" | "yuv420p"; // what arrives on stdin; yuv420p is already in the output colours
  audio?: { path: string; start?: number; duration?: number; copy?: boolean } | null;
  hw?: "auto" | "cpu" | "vaapi";
  crf?: number;
  preset?: string;
  colorspace?: string;
  swsMatrix?: string;
  range?: "tv" | "pc";
  codec?: "h264" | "vp9"; // vp9 = same as most Facebook/Instagram downloads (CPU, slower)
}

/** ffmpeg process that takes RGBA frames on stdin and writes an H.264 mp4. */
export class Encoder {
  readonly usesGpu: boolean;
  private p: ChildProcess;
  private err = "";
  private done: Promise<number>;
  frames = 0;

  constructor(out: string, o: EncodeOpts) {
    this.usesGpu = o.codec !== "vp9" && (o.hw === "vaapi" || (o.hw !== "cpu" && vaapiAvailable()));
    const crf = o.crf ?? 18;
    const cs = o.colorspace ?? "bt709";
    const prim = cs === "bt709" ? "bt709" : cs === "bt2020nc" ? "bt2020" : "smpte170m";
    const trc = cs === "bt709" ? "bt709" : cs === "bt2020nc" ? "bt2020-10" : "smpte170m";
    const args = ["-y", "-v", "error", "-nostdin"];
    if (this.usesGpu) args.push("-vaapi_device", VAAPI_DEVICE);
    const fmt = o.pixFmt ?? "rgba";
    args.push("-f", "rawvideo", "-pix_fmt", fmt, "-s", `${o.width}x${o.height}`, "-framerate", o.fpsStr, "-i", "-");
    const a = o.audio;
    if (a) {
      if (a.start) args.push("-ss", String(a.start));
      if (a.duration) args.push("-t", String(a.duration));
      args.push("-i", a.path);
    }
    const vf: string[] = [];
    if (o.vflip) vf.push("vflip");
    if (fmt === "rgba") vf.push(`scale=out_color_matrix=${o.swsMatrix ?? "bt709"}:out_range=${o.range ?? "tv"}`);
    vf.push(this.usesGpu ? "format=nv12,hwupload" : "format=yuv420p");
    args.push("-map", "0:v", "-vf", vf.join(","));
    if (a) args.push("-map", "1:a?", ...(a.copy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]));
    if (o.codec === "vp9") {
      args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2");
    } else if (this.usesGpu) {
      args.push("-c:v", "h264_vaapi", "-async_depth", "8", "-rc_mode", "CQP", "-qp", String(Math.min(51, crf + 2)),
        "-profile:v", "high");
    } else {
      args.push("-c:v", "libx264", "-preset", o.preset ?? "medium", "-crf", String(crf));
    }
    args.push("-colorspace", cs, "-color_primaries", prim, "-color_trc", trc, "-color_range", o.range ?? "tv");
    args.push("-movflags", "+faststart", out);
    this.p = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    this.p.stderr!.on("data", (d) => (this.err = (this.err + d).slice(-4000)));
    this.p.stdin!.on("error", () => {}); // reported through close()
    this.done = new Promise((res) => this.p.on("close", (code) => res(code ?? 1)));
  }

  async write(buf: Uint8Array): Promise<void> {
    this.frames++;
    if (!this.p.stdin!.write(buf)) {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error("ffmpeg không nhận frame sau 120 giây (treo?)")), 120000);
        this.p.stdin!.once("drain", () => (clearTimeout(t), res()));
      });
    }
  }

  async close(): Promise<void> {
    this.p.stdin!.end();
    const code = await this.done;
    if (code !== 0) throw new Error(`ffmpeg encode lỗi (${code}): ${this.err.trim()}`);
  }

  kill() {
    this.p.kill("SIGKILL");
  }
}

/** Writes every frame it gets as a numbered PNG (yuv420p or rgba input). */
export class PngWriter {
  private p: ChildProcess;
  private done: Promise<number>;
  constructor(dir: string, o: { width: number; height: number; pixFmt: "rgba" | "yuv420p"; swsMatrix?: string; prefix?: string }) {
    const vf = o.pixFmt === "yuv420p" ? `scale=in_color_matrix=${o.swsMatrix ?? "bt709"}:in_range=tv,format=rgb24` : "format=rgb24";
    this.p = spawn("ffmpeg", ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", o.pixFmt, "-s", `${o.width}x${o.height}`,
      "-i", "-", "-vf", vf, "-start_number", "0", join(dir, `${o.prefix ?? "r_"}%04d.png`)], { stdio: ["pipe", "ignore", "inherit"] });
    this.done = new Promise((res) => this.p.on("close", (c) => res(c ?? 1)));
  }
  async write(buf: Uint8Array) {
    if (!this.p.stdin!.write(buf)) await new Promise((r) => this.p.stdin!.once("drain", r));
  }
  async close() {
    this.p.stdin!.end();
    if ((await this.done) !== 0) throw new Error("ghi PNG lỗi");
  }
}

/** Grab one frame as RGBA. */
export async function grabFrame(path: string, info: VideoInfo, t: number): Promise<Buffer> {
  const r = decode(path, info, { start: Math.max(0, t), duration: 2 });
  const f = await r.next();
  r.close();
  if (!f) throw new Error(`không lấy được frame ở ${t}s`);
  return f;
}

export function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} lỗi: ${(r.stderr || "").slice(-2000)}`);
}
