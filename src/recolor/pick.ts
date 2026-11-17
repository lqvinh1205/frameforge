// Measure colours in a frame: HSV at clicked points, and the main colour
// families of the frame, so a recolour target can be written from real numbers.
import { spawnSync } from "node:child_process";
import { grabFrame, probe } from "../core/media.ts";

export interface Hsv {
  h: number; // degrees
  s: number; // 0..1
  v: number; // 0..1
}

export function rgb2hsv(r: number, g: number, b: number): Hsv {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}

/** Average HSV in a (2r+1)² box; hue averaged on the circle. */
export function sampleHsv(rgba: Uint8Array, W: number, H: number, x: number, y: number, r = 6): Hsv {
  let cx = 0, cy = 0, s = 0, v = 0, n = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++)
    for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
      const i = (yy * W + xx) * 4;
      const c = rgb2hsv(rgba[i], rgba[i + 1], rgba[i + 2]);
      cx += Math.cos((c.h * Math.PI) / 180) * c.s;
      cy += Math.sin((c.h * Math.PI) / 180) * c.s;
      s += c.s; v += c.v; n++;
    }
  let h = (Math.atan2(cy, cx) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { h, s: s / n, v: v / n };
}

/** A target that catches this colour family, with gates set from the sample. */
export function suggestTarget(c: Hsv, to: number, name = "") {
  return {
    name,
    from: Math.round(c.h),
    to,
    range: [14, 30],
    sat: [+(Math.max(0.05, c.s * 0.25)).toFixed(2), +(Math.max(0.12, c.s * 0.55)).toFixed(2)],
    val: [0.03, 0.1],
    satK: 1,
    valK: 1,
  };
}

/** Main saturated colour families: 12 hue bins of 30°, with share of the frame. */
export function dominantHues(rgba: Uint8Array, W: number, H: number) {
  const bins = new Array(12).fill(0).map(() => ({ n: 0, s: 0, v: 0, cx: 0, cy: 0 }));
  let total = 0;
  for (let y = 0; y < H; y += 4)
    for (let x = 0; x < W; x += 4) {
      const i = (y * W + x) * 4;
      const c = rgb2hsv(rgba[i], rgba[i + 1], rgba[i + 2]);
      total++;
      if (c.s < 0.25 || c.v < 0.12) continue;
      const b = bins[Math.floor(((c.h + 15) % 360) / 30)];
      b.n++; b.s += c.s; b.v += c.v;
      b.cx += Math.cos((c.h * Math.PI) / 180); b.cy += Math.sin((c.h * Math.PI) / 180);
    }
  return bins
    .map((b) => ({
      hue: Math.round(((Math.atan2(b.cy, b.cx) * 180) / Math.PI + 360) % 360),
      share: b.n / total,
      s: b.n ? b.s / b.n : 0,
      v: b.n ? b.v / b.n : 0,
    }))
    .filter((b) => b.share > 0.01)
    .sort((a, b) => b.share - a.share);
}

export const HUE_NAMES: [number, string][] = [
  [15, "đỏ"], [45, "cam"], [70, "vàng"], [160, "xanh lá"], [200, "xanh ngọc"], [255, "xanh dương"],
  [290, "tím"], [340, "hồng"], [360, "đỏ"],
];
export function hueName(h: number): string {
  return HUE_NAMES.find(([lim]) => h < lim)![1];
}

export async function pick(input: string, at: number, points: [number, number][], gridPng?: string) {
  const info = probe(input);
  const f = await grabFrame(input, info, at);
  const W = info.width, H = info.height;
  const out: string[] = [];
  out.push(`Frame ${at}s (${W}x${H}). Màu chính trong khung (bỏ qua trắng/xám/đen):`);
  for (const d of dominantHues(f, W, H).slice(0, 6))
    out.push(`  ${hueName(d.hue).padEnd(10)} sắc ${String(d.hue).padStart(3)}°  chiếm ${(d.share * 100).toFixed(1)}%  S ${d.s.toFixed(2)}  V ${d.v.toFixed(2)}`);
  const targets = [];
  for (const [x, y] of points) {
    const c = sampleHsv(f, W, H, x, y);
    out.push(`Điểm (${x},${y}): sắc ${c.h.toFixed(1)}° (${hueName(c.h)})  S ${c.s.toFixed(2)}  V ${c.v.toFixed(2)}`);
    targets.push(suggestTarget(c, Math.round((c.h + 180) % 360), `điểm ${x},${y}`));
  }
  if (gridPng) {
    // frame with a 100 px grid so coordinates can be read off by eye
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(at), "-i", input, "-frames:v", "1",
      "-vf", "drawgrid=w=100:h=100:t=1:c=white@0.5,drawgrid=w=500:h=500:t=3:c=yellow@0.8", gridPng]);
    if (r.status === 0) out.push(`Ảnh có lưới 100px (vạch vàng mỗi 500px): ${gridPng}`);
  }
  return { text: out.join("\n"), targets };
}
