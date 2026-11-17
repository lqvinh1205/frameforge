"""Masks for decor objects that share their colour with the background (e.g. a
red pouf against a red wall), drawn as simple shapes and tightened to the
object's own colour.

    python decor_masks.py objects.json FRAMES_DIR OUT_DIR

objects.json:
{
  "colorGate": {"hue": 2, "range": 25, "minSat": 0.35},   # keep only pixels of the object's colour
  "objects": [
    {"name": "pillow", "frames": [210, 415], "poly": [[507,1193], [670,1180], [705,1285], [528,1298]]},
    {"name": "pouf", "keys": {                            # shape per key frame, interpolated between
        "220": {"cyl": [-188, 60, 1130, 1390]},
        "228": {"cyl": [132, 380, 1240, 1515]}},
     "frames": [220, 415]}
  ]
}
cyl = [x_left, x_right, y_top, y_bottom] of a standing cylinder (ellipse ends).
Per object "gate": false uses the shape alone (when nothing of a similar colour
touches it, e.g. dark scenes where the gate would punch holes).
Writes OUT_DIR/b_XXXX.png for every frame (zeros where no object).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np


def draw(mask: np.ndarray, shape: dict) -> None:
    if "poly" in shape:
        cv2.fillPoly(mask, [np.array(shape["poly"], np.int32)], 1.0)
    if "cyl" in shape:
        x0, x1, y0, y1 = shape["cyl"]
        cx, rx = (x0 + x1) / 2, (x1 - x0) / 2
        ry = max(8, rx * 0.2)
        cv2.rectangle(mask, (int(x0), int(y0 + ry)), (int(x1), int(y1 - ry)), 1.0, -1)
        cv2.ellipse(mask, (int(cx), int(y0 + ry)), (int(rx), int(ry)), 0, 0, 360, 1.0, -1)
        cv2.ellipse(mask, (int(cx), int(y1 - ry)), (int(rx), int(ry)), 0, 0, 360, 1.0, -1)


def shape_at(obj: dict, f: int) -> dict | None:
    lo, hi = obj.get("frames", [0, 10 ** 9])
    if not lo <= f <= hi:
        return None
    if "keys" not in obj:
        return obj
    keys = sorted((int(k), v) for k, v in obj["keys"].items())
    if f <= keys[0][0]:
        return keys[0][1]
    for (fa, a), (fb, b) in zip(keys, keys[1:]):
        if fa <= f <= fb:
            k = (f - fa) / (fb - fa)
            out = {}
            for key in a:
                if key in b:
                    out[key] = (np.array(a[key], float) * (1 - k) + np.array(b[key], float) * k).tolist()
            return out
    return keys[-1][1]


def main() -> int:
    cfg = json.load(open(sys.argv[1]))
    frames = sorted(Path(sys.argv[2]).glob("f_*.png"))
    out = Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    gate = cfg.get("colorGate")
    for p in frames:
        i = int(p.stem.split("_")[-1])
        bgr = cv2.imread(str(p))
        H, W = bgr.shape[:2]
        total = np.zeros((H, W), np.float32)
        hsv = None
        for obj in cfg["objects"]:
            s = shape_at(obj, i)
            if not s:
                continue
            m = np.zeros((H, W), np.float32)
            draw(m, s)
            m = cv2.GaussianBlur(m, (0, 0), cfg.get("blur", 2.0))
            g = obj.get("gate", gate)   # per object: a gate dict, or false = shape only
            if g:
                if hsv is None:
                    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
                h = hsv[..., 0] * 2
                d = np.abs((h - g["hue"] + 540) % 360 - 180)
                s_ = hsv[..., 1] / 255
                ok = np.clip((g["range"] + 8 - d) / 8, 0, 1) * np.clip((s_ - g["minSat"] + 0.1) / 0.1, 0, 1)
                m *= cv2.GaussianBlur(ok.astype(np.float32), (0, 0), 1.0)
            total = np.maximum(total, m)
        m = total
        cv2.imwrite(str(out / f"b_{i:04d}.png"), np.clip(m * 255, 0, 255).astype(np.uint8))
    print(f"xong {len(frames)} frame")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
