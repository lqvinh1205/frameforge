"""Inside decor masks, keep skin protection only where the model saw skin:
g = g * (1 - b * (1 - s)). Needed when a hand touches an object whose colour
matches skin (a sunlit red pouf).

    python refine_person.py MASK_DIR FIRST LAST
"""
import sys
from pathlib import Path

import cv2
import numpy as np

d, lo, hi = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
for i in range(lo, hi + 1):
    g = cv2.imread(str(d / f"g_{i:04d}.png"), 0).astype(np.float32) / 255
    b = cv2.imread(str(d / f"b_{i:04d}.png"), 0).astype(np.float32) / 255
    s = cv2.imread(str(d / f"s_{i:04d}.png"), 0).astype(np.float32) / 255
    cv2.imwrite(str(d / f"g_{i:04d}.png"), np.clip(g * (1 - b * (1 - s)) * 255, 0, 255).astype(np.uint8))
print(f"xong frame {lo}-{hi}")
