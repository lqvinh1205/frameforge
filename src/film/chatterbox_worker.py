"""Chatterbox Turbo (MIT) TTS worker for frameforge, run by its own venv's Python (it pins torch 2.6,
which the app's environment does not use). Standalone: imports nothing from
the package.

    python chatterbox_worker.py jobs.json
    jobs.json = {"jobs": [{"text": ..., "out": ..., "prompt": "" | "ref.wav"}, ...]}
    prompt "" = the model's built-in voice.

Prints "done <i>" after each line so the caller can show progress.
"""
from __future__ import annotations

import json
import os
import sys


def main() -> int:
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    import torch
    import torchaudio as ta
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))
    model = ChatterboxTurboTTS.from_pretrained(device="cpu")
    builtin = model.conds          # generate() keeps the last prompt's voice otherwise
    current = None
    print("ready", flush=True)
    for i, job in enumerate(spec["jobs"]):
        prompt = job.get("prompt") or None
        if prompt != current:
            if prompt:
                model.prepare_conditionals(prompt)
            else:
                model.conds = builtin
            current = prompt
        wav = model.generate(job["text"])
        ta.save(job["out"], wav, model.sr)
        print(f"done {i}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
