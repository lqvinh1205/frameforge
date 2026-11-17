// Rooms and props built from primitives; every colour is a parameter.
import * as THREE from "three";
import { toon } from "./character.js";

export const DEFAULT_SET = {
  wall: "#e8d9bf",
  floor: "#9b7653",
  sky: "#9fd3ff",          // seen through the window
  window: true,
  light: "day",            // day | evening | night
  props: [],
};

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

const PROPS = {
  sofa(c) {
    const g = new THREE.Group(), m = toon(c.color ?? "#5b7bb5");
    g.add(mesh(new THREE.BoxGeometry(2.0, 0.42, 0.85), m, 0, 0.21, 0));
    g.add(mesh(new THREE.BoxGeometry(2.0, 0.6, 0.22), m, 0, 0.6, -0.32));
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.6, 0.85), m, -1.0, 0.4, 0), mesh(new THREE.BoxGeometry(0.22, 0.6, 0.85), m, 1.0, 0.4, 0));
    const cm = toon(c.accent ?? "#f2c14e");
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.35, 0.12), cm, -0.6, 0.6, -0.15));
    return g;
  },
  table(c) {
    const g = new THREE.Group(), m = toon(c.color ?? "#8a5a3b");
    g.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 32), m, 0, 0.5, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.5, 12), m, 0, 0.25, 0));
    return g;
  },
  desk(c) {
    const g = new THREE.Group(), m = toon(c.color ?? "#b98b5e");
    g.add(mesh(new THREE.BoxGeometry(1.4, 0.06, 0.7), m, 0, 0.75, 0));
    for (const [x, z] of [[-0.65, -0.3], [0.65, -0.3], [-0.65, 0.3], [0.65, 0.3]]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.75, 0.06), m, x, 0.375, z));
    return g;
  },
  chair(c) {
    const g = new THREE.Group(), m = toon(c.color ?? "#c0603a");
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), m, 0, 0.46, 0));
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.55, 0.06), m, 0, 0.75, -0.22));
    for (const [x, z] of [[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.46, 0.05), m, x, 0.23, z));
    return g;
  },
  plant(c) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.35, 16), toon(c.pot ?? "#d27d4f"), 0, 0.175, 0));
    const lm = toon(c.color ?? "#4f9d55");
    for (const [x, y, z, r] of [[0, 0.65, 0, 0.28], [0.15, 0.85, 0.05, 0.2], [-0.14, 0.8, -0.05, 0.22], [0, 1.0, 0, 0.17]]) g.add(mesh(new THREE.IcosahedronGeometry(r, 1), lm, x, y, z));
    return g;
  },
  lamp(c) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 20), toon("#333"), 0, 0.02, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.45, 8), toon("#333"), 0, 0.74, 0));
    const shade = mesh(new THREE.CylinderGeometry(0.16, 0.28, 0.3, 20, 1, true), toon(c.color ?? "#fff1c9", { side: THREE.DoubleSide, emissive: new THREE.Color(c.color ?? "#fff1c9"), emissiveIntensity: 0.4 }), 0, 1.5, 0);
    g.add(shade);
    const l = new THREE.PointLight(c.light ?? "#ffd9a0", 1.2, 4, 1.5);
    l.position.set(0, 1.4, 0);
    g.add(l);
    return g;
  },
  bed(c) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.35, 2.1), toon(c.color ?? "#8a5a3b"), 0, 0.175, 0));
    g.add(mesh(new THREE.BoxGeometry(1.45, 0.18, 2.0), toon(c.sheet ?? "#f4f4f4"), 0, 0.44, 0));
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.9, 0.08), toon(c.color ?? "#8a5a3b"), 0, 0.45, -1.05));
    g.add(mesh(new THREE.BoxGeometry(0.55, 0.12, 0.35), toon(c.accent ?? "#a7c7e7"), -0.35, 0.58, -0.75), mesh(new THREE.BoxGeometry(0.55, 0.12, 0.35), toon(c.accent ?? "#a7c7e7"), 0.35, 0.58, -0.75));
    return g;
  },
  shelf(c) {
    const g = new THREE.Group(), m = toon(c.color ?? "#a0724f");
    for (const y of [0.05, 0.6, 1.15, 1.7]) g.add(mesh(new THREE.BoxGeometry(1.0, 0.04, 0.32), m, 0, y, 0));
    g.add(mesh(new THREE.BoxGeometry(0.04, 1.72, 0.32), m, -0.5, 0.86, 0), mesh(new THREE.BoxGeometry(0.04, 1.72, 0.32), m, 0.5, 0.86, 0));
    const colors = ["#d94f4f", "#4f7fd9", "#e6b84f", "#5fae6e", "#8f5fd9"];
    let i = 0;
    for (const y of [0.07, 0.62, 1.17]) for (let x = -0.4; x < 0.35; x += 0.11) g.add(mesh(new THREE.BoxGeometry(0.08, 0.3 + ((i * 37) % 10) / 60, 0.24), toon(colors[i++ % colors.length]), x, y + 0.17, 0));
    return g;
  },
  rug(c) {
    const m = mesh(new THREE.CircleGeometry(c.size ?? 1.2, 40), toon(c.color ?? "#c2524a"), 0, 0.005, 0);
    m.rotation.x = -Math.PI / 2;
    return m;
  },
  picture(c) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.6, 0.04), toon(c.frame ?? "#5b3a29"), 0, 0, 0));
    g.add(mesh(new THREE.PlaneGeometry(0.68, 0.48), toon(c.color ?? "#7fb3d5"), 0, 0, 0.021));
    g.position.y = c.y ?? 1.75;
    return g;
  },
  door(c) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.95, 2.1, 0.06), toon(c.color ?? "#8b5e3c"), 0, 1.05, 0));
    g.add(mesh(new THREE.SphereGeometry(0.04, 10, 8), toon("#e0c060"), 0.35, 1.0, 0.05));
    return g;
  },
  tv(c) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.4, 0.5, 0.4), toon(c.color ?? "#3a3a40"), 0, 0.25, 0));
    g.add(mesh(new THREE.BoxGeometry(1.2, 0.7, 0.05), toon("#111"), 0, 0.9, 0));
    g.add(mesh(new THREE.PlaneGeometry(1.1, 0.6), new THREE.MeshBasicMaterial({ color: c.screen ?? "#2a6fb0" }), 0, 0.9, 0.03));
    return g;
  },
  box(c) {
    const s = c.size ?? [0.5, 0.5, 0.5];
    return mesh(new THREE.BoxGeometry(...s), toon(c.color ?? "#c9a36b"), 0, s[1] / 2, 0);
  },
  cake(c) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 24), toon(c.color ?? "#f6c6d0"), 0, 0.06, 0));
    g.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), toon("#d62f3a"), 0, 0.14, 0));
    g.position.y = c.y ?? 0.53;
    return g;
  },
};

export const PROP_TYPES = Object.keys(PROPS);

const LIGHTS = {
  day: { hemi: ["#ffffff", "#a08870", 1.6], sun: ["#fff3e0", 2.2], bg: 1 },
  evening: { hemi: ["#ffd2a8", "#6b4f3a", 1.2], sun: ["#ffb070", 1.8], bg: 0.75 },
  night: { hemi: ["#8ea2d8", "#2a2438", 0.7], sun: ["#9fb4ff", 0.6], bg: 0.35 },
};

/** Build the room. Room spans x ±W/2, back wall at z = -D. */
export function buildSet(specIn) {
  const s = { ...DEFAULT_SET, ...specIn };
  const g = new THREE.Group();
  const W = s.width ?? 9, D = 3.2, HGT = 4.5;
  const floor = mesh(new THREE.PlaneGeometry(W, D + 6), toon(s.floor), 0, 0, -D + (D + 6) / 2);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const wallM = toon(s.wall);
  g.add(mesh(new THREE.BoxGeometry(W, HGT, 0.1), wallM, 0, HGT / 2, -D));
  g.add(mesh(new THREE.BoxGeometry(0.1, HGT, D + 6), wallM, -W / 2, HGT / 2, -D + (D + 6) / 2));
  g.add(mesh(new THREE.BoxGeometry(0.1, HGT, D + 6), wallM, W / 2, HGT / 2, -D + (D + 6) / 2));
  const base = toon(new THREE.Color(s.wall).multiplyScalar(0.7));
  g.add(mesh(new THREE.BoxGeometry(W, 0.12, 0.04), base, 0, 0.06, -D + 0.06));
  if (s.window) {
    const wx = s.windowX ?? 1.6;
    const L = LIGHTS[s.light] ?? LIGHTS.day;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(s.sky).multiplyScalar(L.bg) }));
    sky.position.set(wx, 1.75, -D + 0.06);
    g.add(sky);
    const fm = toon("#f7f3ea");
    for (const [x, y, w, h] of [[0, 0.58, 1.5, 0.07], [0, -0.58, 1.5, 0.07], [-0.72, 0, 0.07, 1.2], [0.72, 0, 0.07, 1.2], [0, 0, 0.04, 1.1], [0, 0, 1.4, 0.04]])
      g.add(mesh(new THREE.BoxGeometry(w, h, 0.06), fm, wx + x, 1.75 + y, -D + 0.08));
  }
  for (const p of s.props ?? []) {
    const f = PROPS[p.type];
    if (!f) continue;
    const o = f(p);
    o.position.x += p.x ?? 0;
    o.position.z += p.z ?? 0;
    if (p.type === "picture") o.position.z = -D + 0.07;
    o.rotation.y = ((p.rotate ?? 0) * Math.PI) / 180;
    if (p.scale) o.scale.setScalar(p.scale);
    g.add(o);
  }
  return g;
}

export function addLights(scene, setSpec) {
  const L = LIGHTS[setSpec?.light ?? "day"] ?? LIGHTS.day;
  scene.add(new THREE.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]));
  const sun = new THREE.DirectionalLight(L.sun[0], L.sun[1]);
  sun.position.set(2.5, 5, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 5, bottom: -2, near: 0.5, far: 15 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight("#ffffff", 0.5);
  fill.position.set(-3, 2, 5);
  scene.add(fill);
  scene.background = new THREE.Color(setSpec?.wall ?? "#ddd").multiplyScalar(0.6);
}
