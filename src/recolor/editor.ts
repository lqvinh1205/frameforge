// Interactive recolour editor: a Chrome app window showing one frame through the
// same shader as the batch render. Click to pick a colour, drag sliders, save.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { grabFrame, probe } from "../core/media.ts";
import { openSession, sendFrame, sendJson } from "../core/browser.ts";
import { recolor } from "./recolor.ts";

export async function editor(input: string, configPath: string, test?: { screenshot: string; click?: [number, number] }) {
  const info = probe(input);
  let config: any = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : { targets: [] };
  let busy = false;
  const s = await openSession(
    "/web/recolor/editor.html",
    {
      "/job": (_q, res) =>
        sendJson(res, { width: info.width, height: info.height, duration: info.duration, fps: info.fps, name: basename(input), config, configPath }),
      "/frame": async (req, res) => {
        const t = Number(new URL(req.url!, "http://x").searchParams.get("t") ?? 0);
        sendFrame(res, await grabFrame(input, info, Math.min(t, Math.max(0, info.duration - 0.1))));
      },
      "/save": (_q, res, body) => {
        config = JSON.parse(body.toString());
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        sendJson(res, { saved: configPath });
      },
      "/render": async (_q, res, body) => {
        if (busy) return sendJson(res, { error: "đang render, chờ chút" });
        busy = true;
        const { start, duration } = JSON.parse(body.toString() || "{}");
        const out = join(dirname(resolve(input)), `${basename(input, extname(input))} - doi mau${duration ? " (thu)" : ""}.mp4`);
        try {
          const r = await recolor({ input, output: out, config, start, duration, log: (m) => console.log(m) });
          sendJson(res, { output: out, ...r });
        } catch (e: any) {
          sendJson(res, { error: e.message });
        } finally {
          busy = false;
        }
      },
    },
    { app: !test },
  );
  if (test && s.page) {
    // self-check: load, optionally click a pixel, screenshot, quit
    await s.page.setViewport({ width: 1280, height: 860 });
    await s.page.waitForFunction(() => document.querySelector("#status") !== null && (window as any).performance.now() > 1500);
    await new Promise((r) => setTimeout(r, 1500));
    if (test.click) {
      const box = await (await s.page.$("canvas"))!.boundingBox();
      await s.page.mouse.click(box!.x + (test.click[0] / info.width) * box!.width, box!.y + (test.click[1] / info.height) * box!.height);
      await new Promise((r) => setTimeout(r, 300));
    }
    await s.page.screenshot({ path: test.screenshot });
    await s.close();
    return;
  }
  console.log(`Trình chỉnh màu đang mở trong cửa sổ Chrome (${s.url}).`);
  console.log(`Cấu hình lưu vào: ${configPath}\nNhấn Ctrl+C ở đây để tắt.`);
  await new Promise(() => {}); // run until Ctrl+C
}
