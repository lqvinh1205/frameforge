// Turns a resolved script (timeline + per-frame mouth levels) into a posed
// scene and a camera for any time t. Pure function of t, so frames can be
// rendered in any order and re-rendered identically.
import * as THREE from "three";
import { buildCharacter, pose, headY, ACTIONS, EMOTIONS } from "./character.js";
import { loadVrmCharacter, poseVrm } from "./vrm.js";
import { buildSet, addLights } from "./set.js";

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, k) => a + (b - a) * k;
const WALK_SPEED = 1.3; // m/s

export async function createDirector(job) {
  const scene = new THREE.Scene();
  scene.add(buildSet(job.set));
  addLights(scene, job.set);
  const aspect = job.width / job.height;
  const vertical = aspect < 1;
  const camera = new THREE.PerspectiveCamera(vertical ? 42 : 30, aspect, 0.1, 60);

  // characters + their walk segments
  const cast = {};
  let phase = 0;
  for (const [id, spec] of Object.entries(job.characters)) {
    const obj = spec.modelUrl ? await loadVrmCharacter(spec, spec.modelUrl) : buildCharacter(spec);
    scene.add(obj);
    cast[id] = { id, obj, spec, x: spec.x ?? 0, z: spec.z ?? 0, phase: (phase += 1.37), walks: [] };
  }
  for (const c of Object.values(cast)) {
    let x = c.x, z = c.z;
    for (const l of job.timeline) {
      if (l.who !== c.id || l.moveTo === undefined) continue;
      const tx = typeof l.moveTo === "number" ? l.moveTo : l.moveTo.x ?? x;
      const tz = typeof l.moveTo === "number" ? z : l.moveTo.z ?? z;
      const d = Math.hypot(tx - x, tz - z);
      c.walks.push({ t0: l.start, t1: l.start + Math.max(0.5, d / WALK_SPEED), x0: x, z0: z, x1: tx, z1: tz });
      x = tx; z = tz;
    }
  }
  const posAt = (c, t) => {
    let x = c.x, z = c.z, walking = false, dir = 0;
    for (const w of c.walks) {
      if (t >= w.t1) { x = w.x1; z = w.z1; continue; }
      if (t > w.t0) {
        const k = (t - w.t0) / (w.t1 - w.t0);
        x = lerp(w.x0, w.x1, k); z = lerp(w.z0, w.z1, k);
        walking = true;
        dir = Math.atan2(w.x1 - w.x0, w.z1 - w.z0);
      }
      break;
    }
    return { x, z, walking, dir };
  };

  const lines = job.timeline;
  const lineAt = (t) => {
    let cur = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].start <= t + 0.05) cur = i;
    return Math.max(0, cur);
  };

  // camera shot per line
  const shots = lines.map((l, i) => {
    if (l.shot) return l.shot;
    if (i === 0) return "wide";
    if (l.moveTo !== undefined || ["jump", "dance"].includes(l.action)) return "wide";
    if (i % 5 === 4) return "wide";
    const prev = lines[i - 1];
    return prev && prev.who === l.who ? "medium" : "close";
  });

  function partnerOf(id, pos) {
    let best = null, bd = 1e9;
    for (const o of Object.values(cast)) {
      if (o.id === id) continue;
      const d = Math.abs(pos[o.id].x - pos[id].x);
      if (d < bd) { bd = d; best = o.id; }
    }
    return best;
  }

  function frameCamera(t, li, pos) {
    const l = lines[li];
    const shot = shots[li] ?? "wide";
    const since = t - (l?.start ?? 0);
    const push = 1 - Math.min(0.06, since * 0.012); // slow push-in
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    const ids = Object.keys(cast);
    const speaker = l?.who && cast[l.who] ? l.who : ids[0];
    if (shot === "wide" || ids.length === 0) {
      const xs = ids.map((id) => pos[id].x);
      const min = Math.min(...xs, 0), max = Math.max(...xs, 0);
      const cx = (min + max) / 2;
      const spread = max - min + 1.4;
      const d = Math.max(spread / 2 / Math.tan(hf), 1.3 / Math.tan(vf)) * push;
      camera.position.set(cx, 1.3, d + 0.3);
      camera.lookAt(cx, vertical ? 0.95 : 1.0, 0);
      return;
    }
    const sp = pos[speaker];
    const hy = headY(cast[speaker].obj);
    const other = partnerOf(speaker, pos);
    const side = other ? Math.sign(pos[other].x - sp.x) || 1 : 1;
    if (shot === "medium" && other) {
      const cx = (sp.x + pos[other].x) / 2;
      const spread = Math.abs(sp.x - pos[other].x) + 1.0;
      const d = Math.max(spread / 2 / Math.tan(hf), 0.75 / Math.tan(vf)) * push;
      camera.position.set(cx - side * 0.35, hy - 0.15, d + 0.2);
      camera.lookAt(cx, hy - 0.45, 0);
      return;
    }
    // close-up on the speaker, seen a little from the partner's side
    // head and shoulders: frame ~1.3 m tall in 9:16, ~0.95 m in 16:9
    const half = vertical ? 0.62 : 0.48;
    const d = (half / Math.tan(vf)) * push;
    camera.position.set(sp.x + side * d * 0.3, hy - 0.05, sp.z + d);
    camera.lookAt(sp.x, hy - (vertical ? 0.24 : 0.16), sp.z);
  }

  return {
    scene,
    camera,
    duration: job.duration,
    /** pose everything for time t (seconds) */
    setTime(t) {
      const frame = Math.min(job.frames - 1, Math.round(t * job.fps));
      const li = lineAt(t);
      const line = lines[li];
      const pos = {};
      for (const c of Object.values(cast)) pos[c.id] = posAt(c, t);

      for (const c of Object.values(cast)) {
        const p = pos[c.id];
        const st = { phase: c.phase, walking: p.walking, talk: job.amp[c.id]?.[frame] ?? 0, emotion: "neutral" };
        // what this character does in the current line
        let mine = null;
        for (let i = li; i >= 0 && i >= li - 1; i--) {
          const l = lines[i];
          if (l.who === c.id && t >= l.start && t <= l.start + Math.max(l.dur, l.actionDur ?? 0) + 0.3) { mine = l; break; }
        }
        if (mine) {
          st.speaking = t <= mine.start + mine.dur && !!mine.text;
          st.emotion = mine.emotion ?? "neutral";
          if (mine.action) {
            st.action = mine.action;
            st.actionT = t - mine.start;
            st.actionDur = mine.actionDur ?? Math.max(1.4, mine.dur);
          }
        } else if (line?.react?.[c.id] && t >= line.start) {
          const r = line.react[c.id];
          if (ACTIONS.includes(r)) {
            st.action = r;
            st.actionT = t - line.start;
            st.actionDur = Math.max(1.4, line.dur);
          }
          if (EMOTIONS.includes(r)) st.emotion = r;
          else if (r === "laugh" || r === "clap" || r === "dance") st.emotion = "happy";
          else if (r === "angry" || r === "cry") st.emotion = r === "cry" ? "sad" : "angry";
          else if (r === "surprised") st.emotion = "surprised";
        }
        // facing: body half-turned to the nearest partner, head to the speaker
        const partner = partnerOf(c.id, pos);
        const dxp = partner ? pos[partner].x - p.x : 0;
        const bodyYaw = p.walking ? p.dir : partner ? Math.sign(dxp) * 0.42 : 0;
        const focus = line && line.who !== c.id && cast[line.who] ? line.who : partner;
        const dxf = focus ? pos[focus].x - p.x : 0;
        const k = line ? ss(0, 0.4, t - line.start) : 1;
        st.lookYaw = p.walking ? 0 : lerp(0, Math.sign(dxf) * 0.3, k) + (focus === partner ? 0 : 0);
        c.obj.position.set(p.x, 0, p.z);
        c.obj.rotation.y = bodyYaw;
        (c.obj.userData.isVrm ? poseVrm : pose)(c.obj, t, st);
      }
      frameCamera(t, li, pos);
    },
  };
}
