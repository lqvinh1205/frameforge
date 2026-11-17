#!/usr/bin/env node
// frameforge command line.  Run `node ff.ts help`.
import { parseArgs } from "node:util";
import { basename, dirname, extname, join, resolve } from "node:path";

const HELP = `frameforge — vẽ lại video bằng Three.js + ffmpeg

ĐỔI MÀU VIDEO THẬT
  node ff.ts pick  VIDEO --at 3 [--point 540,900 ...]      đo màu tại điểm, liệt kê màu chính, xuất ảnh lưới
  node ff.ts edit  VIDEO [--config cfg.json]                mở trình chỉnh: click chọn màu, kéo thanh, lưu cấu hình
  node ff.ts recolor VIDEO --config cfg.json [-o out.mp4]   render cả video
        [--mask mask.mkv] [--start 10 --duration 5] [--hw auto|cpu|vaapi] [--crf 18]
        [--codec h264|vp9] [--frames-dir thu-muc]   vp9 = giữ định dạng như file Facebook; lưu mọi frame ra PNG
  node ff.ts sheet A.mp4 [B.mp4] -o so-sanh.png [--n 6]     ảnh so sánh trước/sau

LÀM PHIM 3D TỪ KỊCH BẢN
  node ff.ts film  kich-ban.json [-o phim.mp4] [--still 1.5,4] [--hw ...] [--crf 20]
  node ff.ts studio [--character characters/an.json]        trình tạo nhân vật mẫu (khối hoặc VRM, chỉnh màu, lưu)
  node ff.ts write "ý tưởng truyện" | truyen.txt -o kich-ban.json   Claude viết kịch bản JSON
        [--cast an,binh] [--seconds 30] [--voice kokoro|chatterbox] [--lang "English (US)"] [--format 9:16]

Biến môi trường: FF_HWENC=cpu (tắt iGPU), FF_GL=swiftshader (máy không GPU),
FF_PYTHON=python có cài kokoro (mặc định dùng venv của render-video),
FF_CHATTERBOX_PY=python có cài chatterbox (mặc định venv chatterbox của render-video).`;

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: "string", short: "o" },
    config: { type: "string", short: "c" },
    mask: { type: "string" },
    at: { type: "string" },
    point: { type: "string", multiple: true },
    start: { type: "string" },
    duration: { type: "string" },
    hw: { type: "string" },
    crf: { type: "string" },
    n: { type: "string" },
    still: { type: "string" },
    character: { type: "string" },
    cast: { type: "string" },
    seconds: { type: "string" },
    voice: { type: "string" },
    lang: { type: "string" },
    format: { type: "string" },
    model: { type: "string" },
    codec: { type: "string" },
    "frames-dir": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const [cmd, ...rest] = positionals;
const num = (s?: string) => (s === undefined ? undefined : Number(s));
const hw = (a.hw ?? "auto") as "auto" | "cpu" | "vaapi";
const sibling = (input: string, suffix: string, ext = ".mp4") =>
  join(dirname(resolve(input)), basename(input, extname(input)) + suffix + ext);

async function main(): Promise<number> {
  if (!cmd || cmd === "help" || a.help) {
    console.log(HELP);
    return 0;
  }
  const input = rest[0];
  switch (cmd) {
    case "pick": {
      const { pick } = await import("./src/recolor/pick.ts");
      const pts = (a.point ?? []).map((p) => p.split(",").map(Number) as [number, number]);
      const r = await pick(input, num(a.at) ?? 0, pts, a.output ?? sibling(input, ".luoi", ".png"));
      console.log(r.text);
      if (r.targets.length) console.log("\nGợi ý targets (đổi 'to' thành sắc bạn muốn):\n" + JSON.stringify(r.targets, null, 2));
      return 0;
    }
    case "recolor": {
      if (!a.config) throw new Error("thiếu --config cfg.json (tạo bằng 'edit' hoặc xem examples/)");
      const { recolor } = await import("./src/recolor/recolor.ts");
      await recolor({
        input, output: a.output ?? sibling(input, " - doi mau"), config: a.config, mask: a.mask,
        start: num(a.start), duration: num(a.duration), hw, crf: num(a.crf),
        codec: a.codec as any, framesDir: a["frames-dir"],
      });
      return 0;
    }
    case "edit": {
      const { editor } = await import("./src/recolor/editor.ts");
      await editor(input, a.config ?? sibling(input, ".recolor", ".json"));
      return 0;
    }
    case "sheet": {
      const { sheet } = await import("./src/core/sheet.ts");
      const out = a.output ?? sibling(input, ".so-sanh", ".png");
      console.log(sheet(rest, out, num(a.n) ?? 6));
      return 0;
    }
    case "film": {
      const { film } = await import("./src/film/film.ts");
      await film({
        script: input, output: a.output, hw, crf: num(a.crf),
        stills: a.still ? a.still.split(",").map(Number) : undefined,
      });
      return 0;
    }
    case "write": {
      const { writeScript } = await import("./src/film/writer.ts");
      writeScript({
        story: rest.join(" "), output: a.output ?? "kich-ban.json", cast: a.cast?.split(",").map((s) => s.trim()),
        seconds: num(a.seconds), voice: a.voice as any, lang: a.lang, format: a.format, model: a.model,
      });
      return 0;
    }
    case "studio": {
      const { studio } = await import("./src/film/studio.ts");
      await studio(a.character);
      return 0;
    }
    default:
      console.error(`Lệnh không có: ${cmd}\n\n${HELP}`);
      return 2;
  }
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`Lỗi: ${e?.message ?? e}`);
    if (process.env.FF_DEBUG) console.error(e);
    process.exit(1);
  },
);
