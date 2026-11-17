"""Kokoro-82M (Apache-2.0) text-to-speech for frameforge. Standalone script, run
with any Python that has `kokoro` installed (render-video's venv works).

    python tts_worker.py jobs.json
    jobs.json = {"jobs": [{"text": ..., "voice": "af_heart", "speed": 1.0, "out": "x.wav"}]}

Writes 24 kHz mono 16-bit wavs and prints "done <i>" after each one.
"""
from __future__ import annotations

import json
import sys
import wave


def main() -> int:
    import numpy as np
    from kokoro import KPipeline

    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    pipes: dict[str, KPipeline] = {}
    for i, job in enumerate(spec["jobs"]):
        voice = job["voice"]
        lang = voice[0]  # a = American English, b = British, ...
        if lang not in pipes:
            pipes[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
        parts = [r.audio.numpy() for r in pipes[lang](job["text"], voice=voice, speed=job.get("speed", 1.0))
                 if r.audio is not None]
        audio = np.concatenate(parts) if parts else np.zeros(2400, np.float32)
        with wave.open(job["out"], "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
        print(f"done {i}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
