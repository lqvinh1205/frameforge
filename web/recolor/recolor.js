// Recolour shader: change the hue of chosen colour families (and of masked
// regions) while keeping each pixel's own brightness and saturation, so shading,
// fabric folds and texture stay natural. Shared by the batch renderer and the editor.
import * as THREE from "three";

export const MAXT = 8;

const vert = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
uniform bool uFlip;
out vec2 vUv;
void main() {
  vUv = uFlip ? vec2(uv.x, 1.0 - uv.y) : uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const frag = /* glsl */ `
precision highp float;
#define MAXT ${MAXT}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFrame;
uniform sampler2D uMask;
uniform bool uHasMask;
uniform float uShowMask;   // 0 = result, 1 = tint changed areas, 2 = original
uniform int uCount;
uniform float uFrom[MAXT];
uniform float uTo[MAXT];
uniform vec2 uRange[MAXT];   // hue distance: full effect below x, none above y (degrees)
uniform vec2 uSat[MAXT];     // saturation gate (ignore greys/whites)
uniform vec2 uSatMax[MAXT];  // upper saturation gate (only weakly tinted pixels, e.g. light spill)
uniform vec2 uVal[MAXT];     // brightness gate (ignore near-black)
uniform float uSatK[MAXT];
uniform float uValK[MAXT];
uniform float uKeep[MAXT];   // 1 = keep the pixel's hue offset from the source hue
uniform float uProtect[MAXT];// skin protection strength
uniform float uActive[MAXT]; // 0..1 at this frame ("when")
uniform vec2 uSkinHue;
uniform vec2 uSkinSat;
uniform float uSkinVal;
// mask channels r,g,b: mode 0 off, 1 hue, 2 repaint (dark fabric), 3 protect, 4 person (gates skin test)
uniform ivec3 uMaskMode;
uniform vec3 uMaskHue;
uniform vec3 uMaskSat;   // hue: sat multiplier, repaint: absolute sat
uniform vec3 uMaskVal;   // hue: val multiplier, repaint: brightness gain

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)) * 360.0, d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(vec3(c.x / 360.0) + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float hueDiff(float a, float b) {      // signed, -180..180
  float d = mod(a - b + 540.0, 360.0) - 180.0;
  return d;
}

void main() {
  vec4 src = texture(uFrame, vUv);
  vec3 col = src.rgb;
  vec3 hsv = rgb2hsv(col);
  vec4 m = uHasMask ? texture(uMask, vUv) : vec4(0.0);

  float sh = hsv.x > 300.0 ? hsv.x - 360.0 : hsv.x;
  float skin = smoothstep(uSkinHue.x - 3.0, uSkinHue.x, sh) * (1.0 - smoothstep(uSkinHue.y, uSkinHue.y + 3.0, sh))
             * smoothstep(uSkinSat.x - 0.08, uSkinSat.x, hsv.y) * (1.0 - smoothstep(uSkinSat.y, uSkinSat.y + 0.1, hsv.y))
             * smoothstep(uSkinVal - 0.1, uSkinVal, hsv.z);
  float person = 1.0, protect = 0.0;
  for (int c = 0; c < 3; c++) {
    if (uMaskMode[c] == 4) person = m[c];
    if (uMaskMode[c] == 3) protect = max(protect, m[c]);
  }
  skin *= person;

  float total = 0.0;
  for (int i = 0; i < MAXT; i++) {
    if (i >= uCount) break;
    float d = abs(hueDiff(hsv.x, uFrom[i]));
    float w = (1.0 - smoothstep(uRange[i].x, uRange[i].y, d))
            * smoothstep(uSat[i].x, uSat[i].y, hsv.y)
            * (1.0 - smoothstep(uSatMax[i].x, uSatMax[i].y, hsv.y))
            * smoothstep(uVal[i].x, uVal[i].y, hsv.z)
            * uActive[i] * (1.0 - uProtect[i] * skin) * (1.0 - protect);
    float h = uTo[i] + uKeep[i] * hueDiff(hsv.x, uFrom[i]);
    vec3 nc = hsv2rgb(vec3(mod(h + 360.0, 360.0), clamp(hsv.y * uSatK[i], 0.0, 1.0), clamp(hsv.z * uValK[i], 0.0, 1.0)));
    col = mix(col, nc, w);
    total = max(total, w);
  }

  for (int c = 0; c < 3; c++) {
    float k = m[c];
    if (k <= 0.0) continue;
    if (uMaskMode[c] == 1) {
      vec3 nc = hsv2rgb(vec3(uMaskHue[c], clamp(hsv.y * uMaskSat[c], 0.0, 1.0), clamp(hsv.z * uMaskVal[c], 0.0, 1.0)));
      k *= 1.0 - 0.9 * skin;
      col = mix(col, nc, k);
      total = max(total, k);
    } else if (uMaskMode[c] == 2) {
      float L = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 nc = hsv2rgb(vec3(uMaskHue[c], uMaskSat[c], clamp(L * uMaskVal[c] + 0.07, 0.0, 1.0)));
      col = mix(col, nc, k);
      total = max(total, k);
    }
  }

  if (uShowMask > 1.5) col = src.rgb;
  else if (uShowMask > 0.5) col = mix(src.rgb * 0.45, vec3(0.1, 1.0, 0.35), total * 0.85);
  outColor = vec4(col, 1.0);
}`;

const MODES = { off: 0, hue: 1, repaint: 2, protect: 3, person: 4 };

export const DEFAULT_SKIN = { hue: [5, 28], sat: [0.18, 0.7], val: 0.2 };

/** Fill in defaults so the JSON can stay short. */
export function normTarget(t) {
  return {
    name: t.name ?? "",
    enabled: t.enabled !== false,
    from: t.from ?? 0,
    to: t.to ?? 180,
    range: t.range ?? [14, 30],
    sat: t.sat ?? [0.1, 0.3],
    satMax: t.satMax ?? [2, 3],
    val: t.val ?? [0.03, 0.1],
    satK: t.satK ?? 1,
    valK: t.valK ?? 1,
    keepOffset: t.keepOffset !== false,
    protectSkin: t.protectSkin !== false,
    when: t.when ?? null,
    fade: t.fade ?? 0.25,
  };
}

function activity(t, when, fade) {
  if (!when || !when.length) return 1;
  let a = 0;
  for (const [s, e] of when) {
    const up = fade > 0 ? Math.min(1, Math.max(0, (t - s) / fade + 1)) : t >= s ? 1 : 0;
    const down = fade > 0 ? Math.min(1, Math.max(0, (e - t) / fade + 1)) : t <= e ? 1 : 0;
    a = Math.max(a, Math.min(up, down));
  }
  return a;
}

/** Fullscreen quad that recolours a W×H RGBA frame. */
export function createRecolor(W, H, hasMask) {
  const mkTex = (w = W, h = H) => {
    const tex = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = false;
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  };
  const frameTex = mkTex();
  const maskTex = hasMask ? mkTex() : mkTex(1, 1);
  const arr = (v) => Array.from({ length: MAXT }, () => (typeof v === "function" ? v() : v));
  const uniforms = {
    uFrame: { value: frameTex },
    uMask: { value: maskTex },
    uHasMask: { value: !!hasMask },
    uFlip: { value: false },
    uShowMask: { value: 0 },
    uCount: { value: 0 },
    uFrom: { value: arr(0) },
    uTo: { value: arr(0) },
    uRange: { value: arr(() => new THREE.Vector2()) },
    uSat: { value: arr(() => new THREE.Vector2()) },
    uSatMax: { value: arr(() => new THREE.Vector2(2, 3)) },
    uVal: { value: arr(() => new THREE.Vector2()) },
    uSatK: { value: arr(1) },
    uValK: { value: arr(1) },
    uKeep: { value: arr(1) },
    uProtect: { value: arr(1) },
    uActive: { value: arr(1) },
    uSkinHue: { value: new THREE.Vector2() },
    uSkinSat: { value: new THREE.Vector2() },
    uSkinVal: { value: 0.2 },
    uMaskMode: { value: [0, 0, 0] }, // ivec3
    uMaskHue: { value: new THREE.Vector3() },
    uMaskSat: { value: new THREE.Vector3(1, 1, 1) },
    uMaskVal: { value: new THREE.Vector3(1, 1, 1) },
  };
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let targets = [];
  const api = {
    scene,
    camera,
    uniforms,
    setConfig(cfg) {
      targets = (cfg.targets ?? []).map(normTarget).filter((t) => t.enabled).slice(0, MAXT);
      const u = uniforms;
      u.uCount.value = targets.length;
      targets.forEach((t, i) => {
        u.uFrom.value[i] = t.from;
        u.uTo.value[i] = t.to;
        u.uRange.value[i].set(t.range[0], Math.max(t.range[1], t.range[0] + 0.5));
        u.uSat.value[i].set(t.sat[0], Math.max(t.sat[1], t.sat[0] + 0.01));
        u.uSatMax.value[i].set(t.satMax[0], Math.max(t.satMax[1], t.satMax[0] + 0.01));
        u.uVal.value[i].set(t.val[0], Math.max(t.val[1], t.val[0] + 0.01));
        u.uSatK.value[i] = t.satK;
        u.uValK.value[i] = t.valK;
        u.uKeep.value[i] = t.keepOffset ? 1 : 0;
        u.uProtect.value[i] = t.protectSkin ? 1 : 0;
      });
      const sk = { ...DEFAULT_SKIN, ...(cfg.skin ?? {}) };
      u.uSkinHue.value.set(sk.hue[0], sk.hue[1]);
      u.uSkinSat.value.set(sk.sat[0], sk.sat[1]);
      u.uSkinVal.value = sk.val;
      const mk = cfg.mask ?? {};
      ["r", "g", "b"].forEach((c, i) => {
        const l = mk[c] ?? {};
        u.uMaskMode.value[i] = MODES[l.mode ?? "off"] ?? 0;
        u.uMaskHue.value.setComponent(i, l.hue ?? 0);
        u.uMaskSat.value.setComponent(i, l.mode === "repaint" ? (l.sat ?? 0.55) : (l.satK ?? 1));
        u.uMaskVal.value.setComponent(i, l.mode === "repaint" ? (l.gain ?? 1.9) : (l.valK ?? 1));
      });
      material.uniformsNeedUpdate = true;
    },
    setTime(t) {
      targets.forEach((tg, i) => (uniforms.uActive.value[i] = activity(t, tg.when, tg.fade)));
    },
    /** use a texture already on the GPU (e.g. from the yuv unpack pass) */
    useTexture(tex) {
      uniforms.uFrame.value = tex;
    },
    setFrame(rgba, mask) {
      if (rgba) {
        uniforms.uFrame.value = frameTex;
        frameTex.image.data.set(rgba);
        frameTex.needsUpdate = true;
      }
      if (mask) {
        maskTex.image.data.set(mask);
        maskTex.needsUpdate = true;
      }
    },
  };
  return api;
}

export function makeRenderer(W, H, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // no colour conversion: untouched pixels stay exact
  return renderer;
}
