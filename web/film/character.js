// Procedural toon characters: built from primitives so every colour, hair
// style and outfit is a parameter, and fully posed by time (deterministic).
import * as THREE from "three";

export const DEFAULT_CHARACTER = {
  name: "Nhân vật",
  gender: "m",            // m | f  (body shape, default voice)
  skin: "#f1c9a5",
  hair: "#2b1d16",
  hairStyle: "short",     // short | long | bun | spiky | bald
  eyes: "#2a1a10",
  shirt: "#3d7be0",
  pants: "#2d3142",
  shoes: "#1d1d1f",
  outfit: "shirt",        // shirt | dress
  height: 1.0,            // scale
  build: 1.0,             // width
  glasses: false,
  blush: false,
  voice: "",              // kokoro voice, e.g. am_michael / af_heart
  speed: 1.0,
};

let gradient;
function toonGradient() {
  if (gradient) return gradient;
  const d = new Uint8Array([70, 70, 70, 255, 165, 165, 165, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: toonGradient(), ...extra });
}

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x15121a, side: THREE.BackSide });

/** Mesh with a cartoon outline (inverted hull). */
function part(geo, mat, outline = 0.012) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  if (outline > 0) {
    geo.computeBoundingSphere();
    const r = geo.boundingSphere.radius || 1;
    const o = new THREE.Mesh(geo, OUTLINE);
    o.scale.setScalar(1 + outline / r);
    o.position.copy(geo.boundingSphere.center).multiplyScalar(-(outline / r));
    m.add(o);
  }
  return m;
}

const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);

export function buildCharacter(specIn) {
  const s = { ...DEFAULT_CHARACTER, ...specIn };
  const female = s.gender === "f";
  const M = {
    skin: toon(s.skin), hair: toon(s.hair), shirt: toon(s.shirt), pants: toon(s.pants), shoes: toon(s.shoes),
    eye: new THREE.MeshBasicMaterial({ color: s.eyes }), white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    mouth: new THREE.MeshBasicMaterial({ color: 0x5a1f22 }), blush: new THREE.MeshBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.45 }),
    lens: new THREE.MeshBasicMaterial({ color: 0x111111 }),
  };
  const root = new THREE.Group();           // position / facing
  const body = new THREE.Group();           // bob, lean
  root.add(body);
  body.scale.set(s.build, s.height, s.build);

  // legs (pivot at hip)
  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.1, 0.78, 0);
    const leg = part(cap(0.075, 0.55), M.pants);
    leg.position.y = -0.36;
    const shoe = part(new THREE.BoxGeometry(0.14, 0.08, 0.24), M.shoes, 0.008);
    shoe.position.set(0, -0.72, 0.04);
    pivot.add(leg, shoe);
    body.add(pivot);
    return pivot;
  });

  // torso
  const torso = new THREE.Group();
  torso.position.y = 0.8;
  body.add(torso);
  const chest = part(cap(female ? 0.19 : 0.21, 0.38), M.shirt);
  chest.position.y = 0.3;
  chest.scale.z = 0.8;
  torso.add(chest);
  if (s.outfit === "dress") {
    const skirt = part(new THREE.CylinderGeometry(0.17, 0.32, 0.42, 20), M.shirt);
    skirt.position.y = -0.05;
    torso.add(skirt);
  } else {
    const hips = part(cap(0.19, 0.06), M.pants);
    hips.position.y = 0.04;
    hips.scale.z = 0.8;
    torso.add(hips);
  }

  // arms (pivot at shoulder)
  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (female ? 0.24 : 0.27), 0.55, 0);
    const upper = part(cap(0.06, 0.42), M.shirt);
    upper.position.y = -0.26;
    const hand = part(new THREE.SphereGeometry(0.065, 14, 10), M.skin, 0.008);
    hand.position.y = -0.55;
    pivot.add(upper, hand);
    torso.add(pivot);
    return pivot;
  });

  // head
  const neck = part(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 12), M.skin, 0);
  neck.position.y = 0.66;
  torso.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.92;
  torso.add(head);
  const skull = part(new THREE.SphereGeometry(0.23, 28, 20), M.skin);
  skull.scale.set(1, 1.05, 0.95);
  head.add(skull);
  [-1, 1].forEach((side) => {
    const ear = part(new THREE.SphereGeometry(0.05, 10, 8), M.skin, 0.006);
    ear.position.set(side * 0.225, 0, -0.01);
    ear.scale.set(0.5, 1, 0.8);
    head.add(ear);
  });

  // hair
  const hairG = new THREE.Group();
  head.add(hairG);
  if (s.hairStyle !== "bald") {
    const capG = new THREE.SphereGeometry(0.245, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
    const hc = part(capG, M.hair);
    hc.rotation.x = -0.25;
    hc.position.set(0, 0.02, -0.01);
    hairG.add(hc);
    // fringe: a squashed sphere slice over the forehead
    const fringe = part(new THREE.SphereGeometry(0.2, 20, 10, -1.25, 2.5, 0.25, 0.55), M.hair, 0);
    fringe.position.set(0, 0.05, 0.035);
    fringe.scale.set(1.15, 1, 1);
    hairG.add(fringe);
  }
  if (s.hairStyle === "long") {
    const back = part(cap(0.2, 0.32), M.hair);
    back.position.set(0, -0.2, -0.1);
    back.scale.set(1.1, 1, 0.55);
    hairG.add(back);
  } else if (s.hairStyle === "bun") {
    const bun = part(new THREE.SphereGeometry(0.1, 16, 12), M.hair);
    bun.position.set(0, 0.24, -0.12);
    hairG.add(bun);
  } else if (s.hairStyle === "spiky") {
    for (let i = 0; i < 7; i++) {
      const sp = part(new THREE.ConeGeometry(0.06, 0.18, 8), M.hair, 0.005);
      const a = -0.9 + (i / 6) * 1.8;
      sp.position.set(Math.sin(a) * 0.17, 0.2 + Math.cos(a) * 0.05, -0.02 - Math.abs(a) * 0.03);
      sp.rotation.z = -a * 0.7;
      hairG.add(sp);
    }
  }

  // face
  const face = new THREE.Group();
  face.position.z = 0.205;
  head.add(face);
  const eyes = [-1, 1].map((side) => {
    const e = new THREE.Group();
    e.position.set(side * 0.08, 0.02, 0);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), M.eye);
    iris.scale.z = 0.4;
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), M.white);
    shine.position.set(0.012, 0.014, 0.014);
    e.add(iris, shine);
    face.add(e);
    return e;
  });
  const brows = [-1, 1].map((side) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.01), M.hair);
    b.position.set(side * 0.08, 0.085, 0.008);
    face.add(b);
    return b;
  });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 10), M.mouth);
  mouth.position.set(0, -0.085, 0.004);
  mouth.scale.set(1, 0.2, 0.3);
  face.add(mouth);
  if (s.blush || female) {
    [-1, 1].forEach((side) => {
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.032, 16), M.blush);
      b.position.set(side * 0.13, -0.04, 0.01);
      face.add(b);
    });
  }
  if (s.glasses) {
    [-1, 1].forEach((side) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 6, 20), M.lens);
      ring.position.set(side * 0.08, 0.02, 0.025);
      face.add(ring);
    });
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.008, 0.008), M.lens);
    bridge.position.set(0, 0.025, 0.025);
    face.add(bridge);
  }

  root.userData = { spec: s, body, torso, head, arms, legs, eyes, brows, mouth, hairG };
  root.traverse((o) => (o.castShadow = o.isMesh && o.material !== OUTLINE));
  return root;
}

// ---------- posing ----------

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, k) => a + (b - a) * k;

/** Head height in world units (camera framing). */
export function headY(ch) {
  return ch.userData.headY ?? 1.72 * ch.userData.spec.height;
}

/**
 * Pose a character for time t.
 * st = { talk 0..1, action, actionT, actionDur, emotion, lookYaw, walking, phase }
 */
export function pose(ch, t, st) {
  const u = ch.userData;
  const ph = st.phase ?? 0;
  const female = u.spec.gender === "f";
  // rest pose
  u.body.position.set(0, 0, 0);
  u.body.rotation.set(0, 0, Math.sin(t * 0.9 + ph) * 0.012);
  u.torso.rotation.set(0, 0, 0);
  u.torso.scale.set(1, 1 + Math.sin(t * 2.1 + ph) * 0.008, 1);
  u.head.rotation.set(0, 0, 0);
  const restOut = female ? 0.1 : 0.14;
  u.arms[0].rotation.set(0, 0, -restOut + Math.sin(t * 1.3 + ph) * 0.02);
  u.arms[1].rotation.set(0, 0, restOut - Math.sin(t * 1.3 + ph) * 0.02);
  u.legs.forEach((l) => l.rotation.set(0, 0, 0));
  u.brows.forEach((b, i) => { b.position.y = 0.085; b.rotation.z = 0; });

  // look toward someone
  u.head.rotation.y = st.lookYaw ?? 0;

  // talking: mouth + small head motion + light hand gestures
  const talk = st.talk ?? 0;
  u.mouth.scale.set(1 - talk * 0.15, 0.18 + talk * 1.1, 0.3);
  if (talk > 0.02 || st.speaking) {
    u.head.rotation.x += Math.sin(t * 7.3 + ph) * 0.035 * (0.3 + talk);
    u.head.rotation.z += Math.sin(t * 3.1 + ph) * 0.03;
    const g = st.speaking ? 1 : 0;
    u.arms[1].rotation.x = -0.25 * g + Math.sin(t * 2.6 + ph) * 0.12 * g;
    u.arms[1].rotation.z += 0.12 * g;
  }

  // blink
  const bt = (t + ph * 1.7) % 3.6;
  const blink = bt < 0.12 ? 0.1 : 1;
  u.eyes.forEach((e) => (e.scale.y = blink));

  // emotion (face)
  const emo = st.emotion ?? "neutral";
  const browY = { happy: 0.095, surprised: 0.11, angry: 0.075, sad: 0.088, neutral: 0.085 }[emo] ?? 0.085;
  const browR = { angry: 0.35, sad: -0.3 }[emo] ?? 0;
  u.brows.forEach((b, i) => {
    b.position.y = browY;
    b.rotation.z = (i === 0 ? -1 : 1) * browR;
  });
  if (emo === "happy" && talk < 0.1) u.mouth.scale.set(1.25, 0.32, 0.3);
  if (emo === "surprised") u.mouth.scale.set(0.7, Math.max(0.8, u.mouth.scale.y), 0.3);
  if (emo === "sad") u.head.rotation.x += 0.15;

  // walking
  if (st.walking) {
    const w = Math.sin(t * 9);
    u.legs[0].rotation.x = w * 0.45;
    u.legs[1].rotation.x = -w * 0.45;
    u.arms[0].rotation.x = -w * 0.35;
    u.arms[1].rotation.x = w * 0.35;
    u.body.position.y = Math.abs(Math.cos(t * 9)) * 0.03;
  }

  // actions
  const a = st.action;
  if (!a) return;
  const at = st.actionT ?? 0, dur = st.actionDur ?? 1.5;
  const k = ss(0, 0.25, at) * (1 - ss(dur - 0.25, dur, at)); // ease in/out
  const A = u.arms, R = A[1], L = A[0];
  switch (a) {
    case "wave":
      R.rotation.z = lerp(R.rotation.z, 2.7 + Math.sin(at * 12) * 0.3, k);
      R.rotation.x = lerp(R.rotation.x, 0, k);
      break;
    case "point":
      R.rotation.x = lerp(R.rotation.x, -1.45, k);
      R.rotation.z = lerp(R.rotation.z, 0.25, k);
      break;
    case "shrug":
      L.rotation.z = lerp(L.rotation.z, -0.7, k);
      R.rotation.z = lerp(R.rotation.z, 0.7, k);
      L.rotation.x = R.rotation.x = lerp(0, -0.5, k);
      u.head.rotation.z += 0.15 * k;
      u.torso.position.y = 0.8 + 0.02 * k;
      break;
    case "nod":
      u.head.rotation.x += Math.sin(at * 9) * 0.22 * k;
      break;
    case "shake":
      u.head.rotation.y += Math.sin(at * 10) * 0.35 * k;
      break;
    case "jump": {
      const hop = Math.max(0, Math.sin(at * 7));
      u.body.position.y += hop * 0.28 * k;
      L.rotation.z = lerp(L.rotation.z, -2.4, k * hop);
      R.rotation.z = lerp(R.rotation.z, 2.4, k * hop);
      break;
    }
    case "laugh":
      u.torso.rotation.x = lerp(0, -0.12, k) + Math.sin(at * 14) * 0.03 * k;
      u.head.rotation.x -= 0.25 * k;
      u.mouth.scale.set(1.3, lerp(u.mouth.scale.y, 0.9 + Math.sin(at * 14) * 0.25, k), 0.3);
      u.body.position.y += Math.abs(Math.sin(at * 14)) * 0.02 * k;
      break;
    case "angry":
      L.rotation.z = lerp(L.rotation.z, -0.35, k);
      R.rotation.z = lerp(R.rotation.z, 0.35, k);
      L.rotation.x = R.rotation.x = lerp(0, -0.6 + Math.sin(at * 18) * 0.08, k);
      u.torso.rotation.x = 0.08 * k;
      break;
    case "think":
      // hand to the chin, from the side so the face stays visible
      R.rotation.x = lerp(R.rotation.x, -1.75, k);
      R.rotation.z = lerp(R.rotation.z, 0.55, k);
      u.head.rotation.z += 0.12 * k;
      u.head.rotation.x -= 0.1 * k;
      break;
    case "cry":
      L.rotation.x = R.rotation.x = lerp(0, -2.4, k);
      L.rotation.z = lerp(L.rotation.z, 0.5, k);
      R.rotation.z = lerp(R.rotation.z, -0.5, k);
      u.head.rotation.x += 0.25 * k;
      u.body.position.y += Math.sin(at * 16) * 0.008 * k;
      break;
    case "clap": {
      const c = Math.sin(at * 16) * 0.15;
      L.rotation.x = R.rotation.x = lerp(0, -1.2, k);
      L.rotation.z = lerp(L.rotation.z, 0.45 + c, k);
      R.rotation.z = lerp(R.rotation.z, -0.45 - c, k);
      break;
    }
    case "dance": {
      const b = Math.sin(at * 8);
      u.body.position.y += Math.abs(b) * 0.06 * k;
      u.body.rotation.z += b * 0.12 * k;
      L.rotation.z = lerp(L.rotation.z, -1.8 - b * 0.5, k);
      R.rotation.z = lerp(R.rotation.z, 1.8 - b * 0.5, k);
      u.legs[0].rotation.x = b * 0.3 * k;
      u.legs[1].rotation.x = -b * 0.3 * k;
      break;
    }
    case "surprised":
      L.rotation.z = lerp(L.rotation.z, -0.9, k);
      R.rotation.z = lerp(R.rotation.z, 0.9, k);
      u.body.position.y += ss(0, 0.15, at) * (1 - ss(0.15, 0.4, at)) * 0.08;
      break;
  }
}

export const ACTIONS = ["wave", "point", "shrug", "nod", "shake", "jump", "laugh", "angry", "think", "cry", "clap", "dance", "surprised"];
export const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised"];
