// VRM characters (VRoid Studio etc.) driven by the same poses as the built-in
// toon characters: pose() runs on an invisible proxy rig, then its joint angles
// are copied onto the VRM's normalized humanoid bones and expressions.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { pose } from "./character.js";

const HALF_PI = Math.PI / 2;
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Same structure as buildCharacter()'s userData, without meshes. */
function makeProxy(spec) {
  const o = () => new THREE.Object3D();
  const root = o();
  root.userData = {
    spec, body: o(), torso: o(), head: o(), arms: [o(), o()], legs: [o(), o()], eyes: [o(), o()], brows: [o(), o()],
    mouth: o(), hairG: o(),
  };
  root.userData.torso.position.y = 0.8;
  return root;
}

const EXPRESSIONS = ["aa", "ih", "ou", "ee", "oh", "blink", "happy", "angry", "sad", "surprised", "relaxed"];

// elbow bend per action, [right-hand side (+x), left-hand side (-x)]
const ELBOWS = { think: [2.0, 0.2], cry: [2.1, 2.1], clap: [0.9, 0.9], angry: [1.3, 1.3], wave: [0.6, 0.2], shrug: [1.0, 1.0], point: [0.05, 0.2] };

export async function loadVrmCharacter(spec, url) {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error(`${url} không phải file VRM`);
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // VRM 0.x models face -z
  vrm.scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  // optional recolouring: { "Hair": "#ff8800" } tints every material whose name contains "Hair"
  for (const [part, color] of Object.entries(spec.materialColors ?? {})) {
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m?.name?.toLowerCase().includes(part.toLowerCase()) && m.color) m.color.set(color);
      }
    });
  }
  const root = new THREE.Group();
  root.add(vrm.scene);
  root.scale.setScalar(spec.height ?? 1);
  const hips = vrm.humanoid.getNormalizedBoneNode("hips");
  vrm.update(0);
  const hp = new THREE.Vector3();
  vrm.humanoid.getRawBoneNode("head").getWorldPosition(hp);
  root.userData = {
    spec, vrm, isVrm: true, proxy: makeProxy(spec), hipsY: hips.position.y,
    headY: hp.y * (spec.height ?? 1) + 0.05, lastT: null,
  };
  return root;
}

export function poseVrm(ch, t, st) {
  const u = ch.userData;
  const { vrm, proxy } = u;
  pose(proxy, t, st);
  const P = proxy.userData;
  const b = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const set = (n, x, y, z) => b(n)?.rotation.set(x, y, z);

  const hips = b("hips");
  hips.position.y = u.hipsY + P.body.position.y;
  hips.rotation.set(0, 0, P.body.rotation.z);
  set("spine", P.torso.rotation.x * 0.6, 0, 0);
  set("chest", P.torso.rotation.x * 0.4 + (P.torso.scale.y - 1) * 3, 0, 0);
  const H = P.head.rotation;
  set("neck", H.x * 0.4, H.y * 0.4, H.z * 0.4);
  set("head", H.x * 0.6, H.y * 0.6, H.z * 0.6);

  // arms: proxy arms[1] is the +x side = the VRM's left arm (VRM faces +z)
  const R = P.arms[1].rotation, L = P.arms[0].rotation;
  set("leftUpperArm", R.x, R.y, R.z - HALF_PI);
  set("rightUpperArm", L.x, L.y, L.z + HALF_PI);
  let [eR, eL] = [0.2, 0.2];
  if (st.action && ELBOWS[st.action]) {
    const at = st.actionT ?? 0, dur = st.actionDur ?? 1.5;
    const k = ss(0, 0.25, at) * (1 - ss(dur - 0.25, dur, at));
    eR += (ELBOWS[st.action][0] - 0.2) * k;
    eL += (ELBOWS[st.action][1] - 0.2) * k;
  }
  set("leftLowerArm", 0, -eR, 0);
  set("rightLowerArm", 0, eL, 0);
  set("leftUpperLeg", P.legs[1].rotation.x, 0, 0);
  set("rightUpperLeg", P.legs[0].rotation.x, 0, 0);
  set("leftLowerLeg", Math.max(0, -P.legs[1].rotation.x) * 0.8, 0, 0);
  set("rightLowerLeg", Math.max(0, -P.legs[0].rotation.x) * 0.8, 0, 0);

  // face
  const em = vrm.expressionManager;
  if (em) {
    for (const e of EXPRESSIONS) em.setValue(e, 0);
    const open = Math.min(1, Math.max(0, (P.mouth.scale.y - 0.18) / 1.1));
    em.setValue("aa", open * 0.85);
    em.setValue("oh", open * 0.35 * (0.5 + 0.5 * Math.sin(t * 5.3)));
    em.setValue("ih", open * 0.2 * (0.5 + 0.5 * Math.sin(t * 7.1 + 1)));
    const emo = st.emotion ?? "neutral";
    const talking = open > 0.05;
    if (emo !== "neutral") em.setValue(emo, emo === "happy" && talking ? 0.45 : 0.75);
    // happy usually closes the eyes already; don't blink on top of it
    if (P.eyes[0].scale.y < 0.5 && emo !== "happy") em.setValue("blink", 1);
  }

  // spring bones (hair, cloth) step at the video frame rate
  const dt = u.lastT === null || t <= u.lastT || t - u.lastT > 0.5 ? 1 / 30 : t - u.lastT;
  u.lastT = t;
  vrm.update(dt);
}

/** Read a VRM's licence fields (works for VRM 0.x and 1.0). */
export function vrmMeta(vrm) {
  return vrm?.meta ?? {};
}
