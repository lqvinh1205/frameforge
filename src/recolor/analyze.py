"""Per-frame analysis for a recolour project: scene cuts, brightness curve,
static-camera spans. Reads the extracted PNG frames.

    python analyze.py FRAMES_DIR OUT_DIR

Writes OUT_DIR/frames.csv (frame, diff, brightness), cuts.json and a short report.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np


def main() -> int:
    frames = sorted(Path(sys.argv[1]).glob("f_*.png"))
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    prev = None
    rows = []
    for i, f in enumerate(frames):
        small = cv2.resize(cv2.imread(str(f)), (270, 480), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
        diff = float(np.abs(gray - prev).mean()) if prev is not None else 0.0
        rows.append((i, diff, float(gray.mean())))
        prev = gray
    with open(out / "frames.csv", "w") as fh:
        fh.write("frame,diff,brightness\n")
        for i, d, b in rows:
            fh.write(f"{i},{d:.2f},{b:.1f}\n")
    cuts = [i for i, d, _ in rows if d > 12]
    # static camera: long runs of tiny differences
    static, start = [], None
    for i, d, _ in rows:
        if d < 1.5:
            start = i if start is None else start
        else:
            if start is not None and i - start >= 24:
                static.append([start, i - 1])
            start = None
    if start is not None and len(rows) - start >= 24:
        static.append([start, len(rows) - 1])
    # the lights going down: biggest sustained brightness drop
    b = np.array([r[2] for r in rows])
    smooth = np.convolve(b, np.ones(5) / 5, mode="same")
    drop = [i for i in range(5, len(b) - 5) if smooth[i - 4] - smooth[i + 4] > 12]
    info = {"frames": len(rows), "cuts": cuts, "static": static,
            "dark_start": drop[0] if drop else None, "dark_end": drop[-1] if drop else None}
    json.dump(info, open(out / "cuts.json", "w"), indent=1)
    print(json.dumps(info))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
