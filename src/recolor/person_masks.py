"""Person and clothing masks with MediaPipe (Apache-2.0 models), for recolouring
clothes and for protecting skin. Run with the seg venv:

    ~/.local/share/frameforge/seg-venv/bin/python person_masks.py FRAMES_DIR OUT_DIR [--range 0-415]
        [--cloth dark|any] [--workers 4]

Writes OUT_DIR/r_XXXX.png (clothes, soft), OUT_DIR/g_XXXX.png (person, widened)
and OUT_DIR/s_XXXX.png (skin + hair as the model sees it).
--cloth dark keeps only dark fabric (black/grey clothes); any = every clothing pixel.
"""
from __future__ import annotations

import argparse
import os
import urllib.request
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np

MODELS = Path.home() / ".cache/frameforge/models"
URLS = {
    "deeplab_v3.tflite":
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/latest/deeplab_v3.tflite",
    "selfie_multiclass_256x256.tflite":
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
}
PERSON = 15  # PASCAL VOC class in DeepLab v3


def model(name: str) -> str:
    MODELS.mkdir(parents=True, exist_ok=True)
    p = MODELS / name
    if not p.exists():
        urllib.request.urlretrieve(URLS[name], p)
    return str(p)


_seg = {}


def _init():
    from mediapipe.tasks.python import BaseOptions, vision
    for key in URLS:
        opts = vision.ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=model(key)),
                                            running_mode=vision.RunningMode.IMAGE,
                                            output_confidence_masks=True, output_category_mask=False)
        _seg[key] = vision.ImageSegmenter.create_from_options(opts)


def _run(key: str, rgb: np.ndarray) -> list[np.ndarray]:
    import mediapipe as mp
    res = _seg[key].segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    out = []
    for m in res.confidence_masks:
        a = m.numpy_view()
        out.append(cv2.resize(a, (rgb.shape[1], rgb.shape[0])) if a.shape[:2] != rgb.shape[:2] else a.copy())
    return out


def person_conf(rgb: np.ndarray) -> np.ndarray:
    """DeepLab on the whole frame plus overlapping squares (one pass on a tall
    frame at 257 px misses people now and then)."""
    H, W = rgb.shape[:2]
    conf = np.zeros((H, W), np.float32)
    conf = np.maximum(conf, _run("deeplab_v3.tflite", rgb)[PERSON])
    side = min(W, H)
    if H > W:
        ys = sorted(set(list(range(0, H - side + 1, max(1, (H - side) // 3))) + [H - side]))
        for y in ys:
            c = _run("deeplab_v3.tflite", rgb[y:y + side])[PERSON]
            conf[y:y + side] = np.maximum(conf[y:y + side], c)
    else:
        xs = sorted(set(list(range(0, W - side + 1, max(1, (W - side) // 3))) + [W - side]))
        for x in xs:
            c = _run("deeplab_v3.tflite", rgb[:, x:x + side])[PERSON]
            conf[:, x:x + side] = np.maximum(conf[:, x:x + side], c)
    return conf


def ell(n: int) -> np.ndarray:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (n, n))


def process(job):
    path, out, cloth_mode = job
    bgr = cv2.imread(path)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    H, W = rgb.shape[:2]
    person = person_conf(rgb)
    cloth = np.zeros((H, W), np.float32)
    skinhair = np.zeros((H, W), np.float32)
    ys, xs = np.where(person > 0.3)
    if len(xs) > 200:
        m = 60
        x0, x1 = max(0, xs.min() - m), min(W, xs.max() + m)
        y0, y1 = max(0, ys.min() - m), min(H, ys.max() + m)
        cls = _run("selfie_multiclass_256x256.tflite", rgb[y0:y1, x0:x1])
        cloth[y0:y1, x0:x1] = np.maximum(cls[4], cls[5])
        skinhair[y0:y1, x0:x1] = np.maximum(np.maximum(cls[1], cls[2]), cls[3])
    body = np.maximum(person, cloth)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    s, v = hsv[..., 1] / 255, hsv[..., 2] / 255
    fabric = (np.clip((0.42 - v) / 0.14, 0, 1) * np.clip((0.45 - s) / 0.2, 0, 1)) if cloth_mode == "dark" else 1.0
    base = cv2.GaussianBlur(cv2.dilate(body, ell(25)), (0, 0), 6)
    r = base * fabric * (1 - np.clip(skinhair * 1.3, 0, 1))
    r = cv2.GaussianBlur(r.astype(np.float32), (0, 0), 1.2)
    # widened person: DeepLab is unsure on arms, so skin there must still be protected
    g = cv2.GaussianBlur(cv2.dilate((body > 0.3).astype(np.float32), ell(121)), (0, 0), 15)
    name = Path(path).stem.split("_")[-1]
    cv2.imwrite(str(Path(out) / f"r_{name}.png"), np.clip(r * 255, 0, 255).astype(np.uint8))
    cv2.imwrite(str(Path(out) / f"g_{name}.png"), np.clip(g * 255, 0, 255).astype(np.uint8))
    # exact skin + hair from the model (slightly grown): for places where colour
    # alone can't tell skin from a similar-coloured object the hand is touching
    s_ = cv2.GaussianBlur(cv2.dilate(skinhair, ell(9)), (0, 0), 3)
    cv2.imwrite(str(Path(out) / f"s_{name}.png"), np.clip(s_ * 255, 0, 255).astype(np.uint8))
    return int(name), float((person > 0.5).mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("frames")
    ap.add_argument("out")
    ap.add_argument("--range", default="")
    ap.add_argument("--cloth", choices=["dark", "any"], default="dark")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 3))
    a = ap.parse_args()
    files = sorted(Path(a.frames).glob("f_*.png"))
    if a.range:
        lo, hi = map(int, a.range.split("-"))
        files = [f for f in files if lo <= int(f.stem.split("_")[-1]) <= hi]
    Path(a.out).mkdir(parents=True, exist_ok=True)
    for k in URLS:
        model(k)  # download once, before the workers start
    jobs = [(str(f), a.out, a.cloth) for f in files]
    with Pool(a.workers, initializer=_init) as pool:
        for n, (i, share) in enumerate(pool.imap(process, jobs, chunksize=4)):
            if n % 25 == 0 or n == len(jobs) - 1:
                print(f"frame {i}: người chiếm {share * 100:.1f}% khung · {n + 1}/{len(jobs)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
