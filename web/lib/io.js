// Talks to the Node side: pull input frames, push rendered ones.

export async function job() {
  return (await fetch("/job")).json();
}

/** Next raw RGBA frame of an input stream, or null at the end. */
export async function getFrame(stream) {
  const r = await fetch(`/in/${stream}`);
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`/in/${stream}: ${r.status} ${await r.text()}`);
  return new Uint8Array(await r.arrayBuffer());
}

let sent = 0;
export async function putFrame(pixels) {
  // A Blob body uploads in ~20 ms; a typed-array body takes ~1 s in Chrome.
  // Blobs are only freed by GC, which an idle-free render loop never triggers:
  // collect every 20 frames or Chrome fails with ERR_BLOB_OUT_OF_MEMORY.
  if (++sent % 20 === 0 && globalThis.gc) globalThis.gc();
  const r = await fetch("/out", { method: "POST", body: new Blob([pixels]) });
  if (!r.ok) throw new Error(`/out: ${r.status} ${await r.text()}`);
}

export function done(info = {}) {
  return fetch("/done", { method: "POST", body: JSON.stringify(info) });
}

export function fail(err) {
  return fetch("/fail", { method: "POST", body: String(err?.stack ?? err) });
}

/** Read the WebGL canvas into `buf` (bottom row first). */
export function readPixels(renderer, w, h, buf) {
  const gl = renderer.getContext();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf;
}
