// Character creator: a Chrome app window with a live 3D preview; saves
// reusable character templates into characters/*.json.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ROOT, openSession, sendJson } from "../core/browser.ts";

const DIR = join(ROOT, "characters");

function slug(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nhan-vat";
}

export async function studio(characterPath?: string, test?: { screenshot: string }) {
  mkdirSync(DIR, { recursive: true });
  const start = characterPath && existsSync(characterPath) ? JSON.parse(readFileSync(characterPath, "utf8")) : null;
  const s = await openSession(
    "/web/film/studio.html",
    {
      "/job": (_q, res) => sendJson(res, { spec: start, file: characterPath ? basename(characterPath) : null }),
      "/models": (_q, res) => {
        const d = join(ROOT, "assets/vrm");
        sendJson(res, existsSync(d) ? readdirSync(d).filter((f) => f.toLowerCase().endsWith(".vrm")) : []);
      },
      "/list": (_q, res) =>
        sendJson(res, readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => ({ file: f, spec: JSON.parse(readFileSync(join(DIR, f), "utf8")) }))),
      "/save": (_q, res, body) => {
        const spec = JSON.parse(body.toString());
        const file = join(DIR, `${slug(spec.name ?? "")}.json`);
        writeFileSync(file, JSON.stringify(spec, null, 2));
        sendJson(res, { saved: resolve(file), use: basename(file) });
      },
    },
    { app: !test },
  );
  if (test && s.page) {
    await s.page.setViewport({ width: 1280, height: 860 });
    await new Promise((r) => setTimeout(r, 2500));
    await s.page.screenshot({ path: test.screenshot });
    await s.close();
    return;
  }
  console.log(`Trình tạo nhân vật đang mở trong cửa sổ Chrome (${s.url}).`);
  console.log(`Nhân vật lưu vào: ${DIR}\nNhấn Ctrl+C ở đây để tắt.`);
  await new Promise(() => {});
}
