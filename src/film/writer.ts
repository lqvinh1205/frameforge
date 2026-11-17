// Story idea / rough script -> frameforge film JSON, written by Claude through
// the local Claude Code CLI (`claude -p`, the user's subscription).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../core/browser.ts";
import { ACTIONS, EMOTIONS } from "../../web/film/character.js";
import { PROP_TYPES } from "../../web/film/set.js";

export interface WriteOpts {
  story: string; // text, or a path to a .txt file
  output: string;
  cast?: string[]; // character template files (without .json) to use; default: let Claude pick
  format?: string;
  lang?: string; // dialogue language, default English (US)
  voice?: "kokoro" | "chatterbox";
  seconds?: number; // target length
  model?: string;
  log?: (m: string) => void;
}

function library() {
  const dir = join(ROOT, "characters");
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
    return { use: f, name: s.name ?? f, gender: s.gender ?? "m", look: s.model ? `VRM ${s.model}` : `${s.hairStyle ?? ""} hair, ${s.outfit ?? "shirt"}` };
  });
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "set", "cast", "lines"],
  properties: {
    title: { type: "string" },
    set: {
      type: "object",
      additionalProperties: false,
      required: ["wall", "floor", "light", "props"],
      properties: {
        wall: { type: "string", description: "hex colour" },
        floor: { type: "string", description: "hex colour" },
        light: { type: "string", enum: ["day", "evening", "night"] },
        props: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "x", "z"],
            properties: {
              type: { type: "string", enum: PROP_TYPES },
              x: { type: "number" },
              z: { type: "number" },
              color: { type: "string" },
            },
          },
        },
      },
    },
    cast: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "use", "x"],
        properties: { id: { type: "string" }, use: { type: "string" }, x: { type: "number" } },
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["who", "say"],
        properties: {
          who: { type: "string" },
          say: { type: "string", description: "spoken words; empty for a silent action" },
          action: { type: "string", enum: ["", ...ACTIONS] },
          emotion: { type: "string", enum: EMOTIONS },
          react: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["who", "do"],
              properties: { who: { type: "string" }, do: { type: "string", enum: [...new Set([...ACTIONS, ...EMOTIONS])] } },
            },
          },
          shot: { type: "string", enum: ["", "wide", "medium", "close"] },
          moveTo: { type: "number" },
          duration: { type: "number", description: "seconds, only for silent lines" },
        },
      },
    },
  },
};

function system(o: WriteOpts, lib: ReturnType<typeof library>) {
  const lang = o.lang ?? "English (US)";
  return `You turn a story idea or rough script into a short animated sketch for TikTok/Reels/Shorts, as JSON for a 3D renderer.

Rules:
- Target length about ${o.seconds ?? 30} seconds of dialogue (roughly ${Math.round((o.seconds ?? 30) * 2.4)} words in total). Hook in the first line, a clear punchline or twist at the end.
- Dialogue language: ${lang}. Natural spoken style, short lines (max ~14 words each). Use slang only where the source has it. Keep it advertiser-friendly: no profanity, no hate, nothing sexual.
- Cast: ${o.cast?.length ? `use exactly these templates: ${o.cast.join(", ")}` : "pick 2-3 fitting templates from the library"}. Library (use = file name): ${JSON.stringify(lib)}
  Give each a short lowercase id. Stand them between x = -1.6 and 1.6, at least 1.2 apart.
- Room: back wall at z = -3.2, characters at z = 0, camera in front (positive z). Put 3-6 props behind the characters (z between -3 and -0.8) so nobody is blocked; colours as hex. "picture" hangs on the back wall (only x matters).
- Every line: "who" is a cast id. Add an "action" on most lines (${ACTIONS.join(", ")}) and an "emotion" when it helps. Use "react" so listeners respond (laugh, surprised, shake, nod...). Silent beats: empty "say" plus "duration" 1-2 s.
- "shot": leave empty to let the editor choose; use "close" for punchlines and "wide" for physical comedy.
- "moveTo" (x) makes the speaker walk during the line; use it rarely.
${o.voice === "chatterbox" ? '- The voice engine understands a few sound tags inside "say": [laugh], [chuckle], [sigh], [gasp]. Use at most 2 in the whole sketch.' : '- Do not put any [tags] in "say".'}
Return only the JSON object.`;
}

export function writeScript(o: WriteOpts) {
  const log = o.log ?? console.log;
  const story = existsSync(o.story) ? readFileSync(o.story, "utf8") : o.story;
  const lib = library();
  if (o.cast?.length) {
    for (const c of o.cast) if (!lib.some((l) => l.use === `${c}.json` || l.use === c)) throw new Error(`không có nhân vật mẫu '${c}' trong characters/`);
    o.cast = o.cast.map((c) => (c.endsWith(".json") ? c : `${c}.json`));
  }
  const exe = spawnSync("which", ["claude"], { encoding: "utf8" }).stdout.trim();
  if (!exe) throw new Error("không tìm thấy lệnh `claude` (Claude Code)");
  log(`Claude đang viết kịch bản (thường 20-60 giây)...`);
  // run from an empty folder so no project CLAUDE.md or settings leak into the prompt
  const cwd = mkdtempSync(join(tmpdir(), "ff_cc_"));
  const r = spawnSync(exe, ["-p", story, "--output-format", "json", "--no-session-persistence", "--tools", "",
    "--system-prompt", system(o, lib), "--json-schema", JSON.stringify(SCHEMA), "--effort", "medium",
    "--model", o.model ?? "claude-opus-5-5"], { cwd, encoding: "utf8", timeout: 600000, maxBuffer: 1 << 24 });
  let data: any;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    throw new Error(`Claude Code lỗi: ${(r.stderr || r.stdout || "").trim().slice(-500)}`);
  }
  if (data.is_error) throw new Error(`Claude Code lỗi: ${String(data.result ?? data.subtype).slice(0, 400)}`);
  const out = data.structured_output ?? JSON.parse(data.result);

  // schema shape -> renderer shape
  const ids = new Set(out.cast.map((c: any) => c.id));
  const script: any = {
    title: out.title,
    format: o.format ?? "9:16",
    ...(o.voice === "chatterbox" ? { voiceEngine: "chatterbox" } : {}),
    set: out.set,
    cast: Object.fromEntries(out.cast.map((c: any) => [c.id, { use: c.use, x: c.x }])),
    lines: out.lines.filter((l: any) => ids.has(l.who)).map((l: any) => {
      const line: any = { who: l.who };
      if (l.say?.trim()) line.say = l.say.trim();
      else line.duration = l.duration || 1.5;
      if (l.action) line.action = l.action;
      if (l.emotion && l.emotion !== "neutral") line.emotion = l.emotion;
      const react = (l.react ?? []).filter((x: any) => ids.has(x.who) && x.who !== l.who);
      if (react.length) line.react = Object.fromEntries(react.map((x: any) => [x.who, x.do]));
      if (l.shot) line.shot = l.shot;
      if (typeof l.moveTo === "number") line.moveTo = Math.max(-2, Math.min(2, l.moveTo));
      return line;
    }),
  };
  writeFileSync(o.output, JSON.stringify(script, null, 2));
  log(`Đã viết ${script.lines.length} câu, ${Object.keys(script.cast).length} nhân vật → ${o.output}`);
  return script;
}
