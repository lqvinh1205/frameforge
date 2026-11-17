// Local web server + Chrome. The page does the Three.js work; frames travel
// over plain HTTP on localhost (GET for input frames, POST for rendered ones).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize, resolve } from "node:path";
import { existsSync } from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

export const ROOT = resolve(import.meta.dirname, "../..");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".vrm": "application/octet-stream",
  ".fbx": "application/octet-stream",
};

export type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => unknown;

export interface Session {
  url: string;
  page?: Page;
  /** resolves when the page POSTs /done, rejects on /fail or a page error */
  finished: Promise<any>;
  close(): Promise<void>;
}

/** Static mounts: url prefix -> folder. */
const MOUNTS: [string, string][] = [
  ["/web/", join(ROOT, "web")],
  ["/three/", join(ROOT, "node_modules/three")],
  ["/vrm-lib/", join(ROOT, "node_modules/@pixiv")],
  ["/assets/", join(ROOT, "assets")],
];

function chromePath(): string {
  const c = [process.env.FF_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const p = c.find((x) => x && existsSync(x));
  if (!p) throw new Error("không tìm thấy Chrome/Chromium (đặt FF_CHROME=/đường/dẫn)");
  return p;
}

function glArgs(): string[] {
  // FF_GL=swiftshader for machines without a GPU.
  if (process.env.FF_GL === "swiftshader") return ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  return ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"];
}

export async function openSession(
  pagePath: string,
  routes: Record<string, Handler>,
  opts: { headless?: boolean; app?: boolean; extraMounts?: [string, string][] } = {},
): Promise<Session> {
  let finish!: (v: any) => void;
  let fail!: (e: Error) => void;
  const finished = new Promise<any>((a, b) => ((finish = a), (fail = b)));
  finished.catch(() => {});
  const mounts = [...(opts.extraMounts ?? []), ...MOUNTS];

  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
      if (path === "/done") {
        res.end("ok");
        return finish(body.length ? JSON.parse(body.toString()) : {});
      }
      if (path === "/fail") {
        res.end("ok");
        return fail(new Error(`lỗi trong trang: ${body.toString()}`));
      }
      if (path === "/favicon.ico") return res.writeHead(204).end();
      if (routes[path]) {
        await routes[path](req, res, body);
        if (!res.writableEnded) res.end();
        return;
      }
      for (const [prefix, dir] of mounts) {
        if (!path.startsWith(prefix)) continue;
        const file = normalize(join(dir, path.slice(prefix.length)));
        if (!file.startsWith(dir)) break;
        const data = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        return res.end(data);
      }
      res.writeHead(404).end("not found");
    } catch (e: any) {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(e?.message ?? e));
      if (req.url?.startsWith("/out")) fail(e);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}${pagePath}`;

  let browser: Browser | undefined;
  let page: Page | undefined;
  if (opts.app) {
    // Visible window for the editors; the user closes it when done.
    spawn(chromePath(), [`--app=${url}`, "--new-window", `--user-data-dir=${join(ROOT, ".chrome-profile")}`, ...glArgs()], {
      stdio: "ignore",
      detached: true,
    }).unref();
  } else {
    browser = await puppeteer.launch({
      executablePath: chromePath(),
      headless: opts.headless ?? true,
      protocolTimeout: 0,
      args: [...glArgs(), "--js-flags=--expose-gc", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows"],
    });
    page = await browser.newPage();
    page.on("pageerror", (e) => fail(e instanceof Error ? e : new Error(String(e))));
    page.on("console", (m) => {
      if (m.type() === "error" || process.env.FF_DEBUG) console.error(`[trang] ${m.text()}`);
    });
    await page.goto(url);
  }

  return {
    url,
    page,
    finished,
    async close() {
      await browser?.close().catch(() => {});
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
    },
  };
}

export function sendJson(res: ServerResponse, v: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(v));
}

export function sendFrame(res: ServerResponse, f: Buffer | null) {
  if (!f) return res.writeHead(204).end();
  res.writeHead(200, { "content-type": "application/octet-stream", "content-length": f.length });
  res.end(f);
}

/** Progress line: frames, fps, ETA. */
export function progress(label: string, total: number, log: (m: string) => void) {
  const t0 = Date.now();
  let last = 0;
  return (n: number, force = false) => {
    const now = Date.now();
    if (!force && now - last < 3000) return;
    last = now;
    const fps = n / Math.max(0.001, (now - t0) / 1000);
    const eta = total > n ? (total - n) / Math.max(fps, 0.01) : 0;
    const pct = total ? ` ${Math.min(100, Math.round((n / total) * 100))}%` : "";
    log(`${label}: ${n}/${total || "?"}${pct} · ${fps.toFixed(1)} fps · còn ~${fmtTime(eta)}`);
  };
}

export function fmtTime(s: number): string {
  s = Math.round(s);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
