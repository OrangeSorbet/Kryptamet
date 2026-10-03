"""Precomputes the handwriting sample words (real MNIST / EMNIST test images) into data/samples/word_samples.json,
so a deploy without the 190 MB of raw image data (Vercel) still offers them. inference/model_registry.py
falls back to this file when data/raw is missing. Idempotent: skips if the file exists (pass --force to rebuild).

    uv run python -m scripts.build_samples [--force]
"""
import json
import os
import sys

from inference.model_registry import MODELS

OUT = "data/samples/word_samples.json"
IMAGE_MODELS = ["mnist_logreg", "emnist_logreg"]


def main():
    if os.path.exists(OUT) and "--force" not in sys.argv:
        print(f"{OUT} exists; pass --force to rebuild")
        return
    out = {}
    for mid in IMAGE_MODELS:
        s = MODELS[mid]["samples"]()
        if not s.get("rows"):
            raise SystemExit(f"{mid}: {s.get('note', 'no samples')}; run scripts/download.py first")
        out[mid] = s
        print(f"{mid}: {len(s['rows'])} sample words")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT):,} bytes)")


if __name__ == "__main__":
    main()
