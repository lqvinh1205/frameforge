"""Join single-channel masks into RGB mask frames + a lossless mask video, and
make overlay images for checking.

    python combine_masks.py MASK_DIR FRAMES_DIR FPS [--check 30,120,226,300]

Reads MASK_DIR/{r,g,b}_XXXX.png (any may be missing = black), writes
MASK_DIR/m_XXXX.png, MASK_DIR/masks.mkv (FFV1, exact) and MASK_DIR/kiem-tra/*.jpg
(clothes = blue, person = faint green, decor = yellow).
"""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import cv2
import numpy as np


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("masks")
    ap.add_argument("frames")
    ap.add_argument("fps")
    ap.add_argument("--check", default="")
    a = ap.parse_args()
    md, fd = Path(a.masks), Path(a.frames)
    frames = sorted(fd.glob("f_*.png"))
    H, W = cv2.imread(str(frames[0])).shape[:2]
    zero = np.zeros((H, W), np.uint8)

    def ch(c: str, i: int) -> np.ndarray:
        p = md / f"{c}_{i:04d}.png"
        return cv2.imread(str(p), cv2.IMREAD_GRAYSCALE) if p.exists() else zero

    for p in frames:
        i = int(p.stem.split("_")[-1])
        cv2.imwrite(str(md / f"m_{i:04d}.png"), cv2.merge([ch("b", i), ch("g", i), ch("r", i)]))  # BGR order
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", a.fps, "-start_number", "0", "-i", str(md / "m_%04d.png"),
                    "-c:v", "ffv1", "-pix_fmt", "bgr0", str(md / "masks.mkv")], check=True)
    if a.check:
        out = md / "kiem-tra"
        out.mkdir(exist_ok=True)
        tiles = []
        for i in [int(x) for x in a.check.split(",")]:
            img = cv2.imread(str(fd / f"f_{i:04d}.png")).astype(np.float32)
            r, g, b = (ch(c, i).astype(np.float32)[..., None] / 255 for c in "rgb")
            img = img * (1 - 0.25 * g) + np.array([0, 255, 0]) * 0.25 * g
            img = img * (1 - 0.8 * r) + np.array([255, 120, 0]) * 0.8 * r
            img = img * (1 - 0.8 * b) + np.array([0, 230, 255]) * 0.8 * b
            t = cv2.resize(img.astype(np.uint8), (W // 3, H // 3))
            cv2.putText(t, str(i), (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 255), 3)
            tiles.append(t)
        cv2.imwrite(str(out / "phu-mask.jpg"), np.hstack(tiles))
        print(out / "phu-mask.jpg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
