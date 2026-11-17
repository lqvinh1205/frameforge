// Move frames as yuv420p instead of RGBA: 1.5 bytes per pixel instead of 4, and
// the colour-matrix maths runs on the GPU. Rows are kept top-first throughout
// (row y of a render target = picture row y), so no flips are needed.
import * as THREE from "three";

const K = { bt709: [0.2126, 0.0722], bt601: [0.299, 0.114], bt2020: [0.2627, 0.0593] };

/** Can this size travel as packed yuv420p? */
export function yuvOk(W, H) {
  return W % 4 === 0 && H % 2 === 0;
}

const quadVert = /* glsl */ `
precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function rawMat(frag, uniforms) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: quadVert, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false,
  });
}

function quadScene(material) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return scene;
}

export const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export function makeTarget(W, H, type = THREE.HalfFloatType, opts = {}) {
  const rt = new THREE.WebGLRenderTarget(W, H, {
    type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, generateMipmaps: false, ...opts,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

function r8(w, h) {
  const t = new THREE.DataTexture(new Uint8Array(w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function matrixUniforms(matrix, range) {
  const [kr, kb] = K[matrix] ?? K.bt709;
  const full = range === "pc";
  return {
    uK: { value: new THREE.Vector3(kr, 1 - kr - kb, kb) },
    uYr: { value: full ? new THREE.Vector2(0, 255) : new THREE.Vector2(16, 219) },
    uCr: { value: full ? 255 : 224 },
  };
}

/** yuv420p bytes -> RGB render target (picture row y in target row y). */
export function createYuvUnpack(renderer, W, H, matrix, range) {
  const ty = r8(W, H), tu = r8(W / 2, H / 2), tv = r8(W / 2, H / 2);
  const target = makeTarget(W, H);
  const mat = rawMat(/* glsl */ `
precision highp float;
uniform sampler2D uY, uU, uV;
uniform vec3 uK; uniform vec2 uYr; uniform float uCr;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float y = (texelFetch(uY, p, 0).r * 255.0 - uYr.x) / uYr.y;
  float pb = (texelFetch(uU, p / 2, 0).r * 255.0 - 128.0) / uCr;
  float pr = (texelFetch(uV, p / 2, 0).r * 255.0 - 128.0) / uCr;
  float r = y + 2.0 * (1.0 - uK.x) * pr;
  float b = y + 2.0 * (1.0 - uK.z) * pb;
  float g = (y - uK.x * r - uK.z * b) / uK.y;
  outColor = vec4(r, g, b, 1.0); // no clamp: half-float keeps out-of-gamut values, so untouched pixels round-trip exactly
}`, { uY: { value: ty }, uU: { value: tu }, uV: { value: tv }, ...matrixUniforms(matrix, range) });
  const scene = quadScene(mat);
  const ySize = W * H, cSize = (W / 2) * (H / 2);
  return {
    target,
    /** upload one yuv420p frame and convert it */
    run(buf) {
      ty.image.data = buf.subarray(0, ySize);
      tu.image.data = buf.subarray(ySize, ySize + cSize);
      tv.image.data = buf.subarray(ySize + cSize, ySize + 2 * cSize);
      ty.needsUpdate = tu.needsUpdate = tv.needsUpdate = true;
      renderer.setRenderTarget(target);
      renderer.render(scene, quadCamera);
      renderer.setRenderTarget(null);
      return target.texture;
    },
  };
}

/**
 * RGB texture -> yuv420p bytes, read back in one readPixels. Each RGBA texel
 * of the pack target holds 4 consecutive bytes of the yuv420p file layout.
 * flip = source rows are bottom-first (a normal WebGL scene render).
 */
export function createYuvPack(renderer, W, H, matrix, range) {
  const PW = W / 4, PH = (H * 3) / 2;
  const target = makeTarget(PW, PH, THREE.UnsignedByteType);
  const mat = rawMat(/* glsl */ `
precision highp float;
uniform sampler2D uSrc;
uniform bool uFlip;
uniform bool uSrgb;      // source is linear light (a 3D render): encode to sRGB first
uniform int uW, uH;
uniform vec3 uK; uniform vec2 uYr; uniform float uCr;
out vec4 outColor;
vec3 px(int x, int y) {
  vec3 c = texelFetch(uSrc, ivec2(x, uFlip ? uH - 1 - y : y), 0).rgb;
  if (uSrgb) {
    c = clamp(c, 0.0, 1.0);
    c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  return c;
}
float luma(int x, int y) {
  vec3 c = px(x, y);
  return uYr.x + uYr.y * dot(c, uK);
}
float chroma(int cx, int cy, bool isV) {
  // average the 2x2 block, as swscale does for 4:2:0
  vec3 c = (px(2 * cx, 2 * cy) + px(2 * cx + 1, 2 * cy) + px(2 * cx, 2 * cy + 1) + px(2 * cx + 1, 2 * cy + 1)) * 0.25;
  float y = dot(c, uK);
  float d = isV ? (c.r - y) / (2.0 * (1.0 - uK.x)) : (c.b - y) / (2.0 * (1.0 - uK.z));
  return 128.0 + uCr * d;
}
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec4 o;
  int base = t.y * uW + t.x * 4;            // byte offset of this texel in the file
  int ySize = uW * uH, cW = uW / 2, cSize = cW * (uH / 2);
  for (int k = 0; k < 4; k++) {
    int b = base + k;
    float v;
    if (b < ySize) v = luma(b % uW, b / uW);
    else if (b < ySize + cSize) { int c = b - ySize; v = chroma(c % cW, c / cW, false); }
    else { int c = b - ySize - cSize; v = chroma(c % cW, c / cW, true); }
    o[k] = clamp(floor(v + 0.5), 0.0, 255.0) / 255.0;
  }
  outColor = o;
}`, {
    uSrc: { value: null }, uFlip: { value: false }, uSrgb: { value: false }, uW: { value: W }, uH: { value: H },
    ...matrixUniforms(matrix, range),
  });
  const scene = quadScene(mat);
  const out = new Uint8Array(PW * PH * 4); // = W*H*1.5
  return {
    bytes: out.length,
    /** pack `texture` and read it back; returns the shared output buffer */
    run(texture, flip = false, srgb = false) {
      mat.uniforms.uSrc.value = texture;
      mat.uniforms.uFlip.value = flip;
      mat.uniforms.uSrgb.value = srgb;
      renderer.setRenderTarget(target);
      renderer.render(scene, quadCamera);
      renderer.readRenderTargetPixels(target, 0, 0, PW, PH, out);
      renderer.setRenderTarget(null);
      return out;
    },
  };
}
