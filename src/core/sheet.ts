// Before/after contact sheet: N evenly spaced frames of each video, one row each.
import { probe, run } from "./media.ts";

export function sheet(videos: string[], out: string, n = 6, rowHeight = 360) {
  const info = probe(videos[0]);
  const dur = info.duration;
  const args = ["-y", "-v", "error"];
  for (const v of videos) args.push("-i", v);
  const parts: string[] = [];
  videos.forEach((_, i) => {
    // fps=n/dur picks n frames spread over the clip; tile puts them in a row
    parts.push(`[${i}:v]fps=${n}/${Math.max(dur, 0.1).toFixed(3)},scale=-2:${rowHeight},tile=${n}x1[r${i}]`);
  });
  const rows = videos.map((_, i) => `[r${i}]`).join("");
  const graph = videos.length > 1 ? `${parts.join(";")};${rows}vstack=inputs=${videos.length}[o]` : `${parts[0].replace("[r0]", "[o]")}`;
  args.push("-filter_complex", graph, "-map", "[o]", "-frames:v", "1", out);
  run("ffmpeg", args);
  return out;
}
