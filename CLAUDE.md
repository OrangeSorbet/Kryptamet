# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Homomorphic encryption (CKKS via TenSEAL) pipeline for privacy-preserving ML inference. Encrypted vectors are
transported using an RSA+AES hybrid scheme. Models (logistic regression, small CNN) are trained on plaintext
data, then benchmarked for encrypted-inference cost across datasets (MNIST, SMS spam, symptom-diagnosis,
German Credit, price data, human-vs-AI text). A Flask app (`interface/app.py`) drives a teaching UI at `/live`
that walks through the entire pipeline with real data (feature extraction → keygen → encrypt → compute →
transport → decrypt → result → benchmarks), including a second, independent educational CKKS implementation
(`crypto_teaching/real_ckks.py`) that exposes real polynomial/ciphertext internals TenSEAL hides.

**Read `docs/ARCHITECTURE.md` first** — full reference doc covering every module, the `/live` UI's structure,
and how they fit together. Don't re-derive this from scratch by reading files one at a time; the doc is
current and detailed. `docs/checklist.md` is the roadmap/phase tracker (what's done vs. pending). `docs/rules.md`
holds hard project rules (see below). `docs/logs.md` is an append-only log of setup/build steps — log actions
there per the rules.

The `/live` UI's interaction model (flowchart of chapter boxes → dolly-zoom into a chapter → a Scrubber with
play/pause/step controls and a 4-cell what/why/formal/next explanation grid → draggable step slider) is
deliberately inspired by a separate reference project, `C:\Users\ashvi\Documents\VS_Codes\HTML\Snek` (a Preact
compiler visualizer) — read `Snek/src/components/{Scrubber,ZoomTransition,StepSlider,ExplanationGrid,
PhaseMinimap}.tsx` for the reference behavior if working on this area. Kryptamet is **vanilla JS, no build
step, no npm** (Snek is Preact+Vite — don't confuse the two, don't try to introduce a build pipeline into
Kryptamet). Every explanation string shown in the Scrubber must be real (backend-emitted per real event data,
or computed from the real request) — never decorative/example placeholder text. Always dark theme, no
light/dark toggle.

## Commands

```
uv sync                          # install deps from pyproject.toml + uv.lock (Python >=3.13)
uv run scripts/download.py       # fetch MNIST/SMS-spam/German-Credit/symptom-diagnosis/price data into data/raw/
                                  # human_vs_ai_text must be manually placed at data/raw/human_vs_ai_text/AI_Human.csv (Kaggle)

uv run python -m tests.test_transport_roundtrip    # run a single test file (module invocation required)
uv run python -m tests.test_he_inference
uv run python -m tests.test_he_cnn_inference

uv run python models/train/<dataset>_logreg.py     # train/re-save a given logreg model to models/saved/
uv run python models/train/mnist_cnn.py            # train plaintext-baseline CNN
uv run python models/train/mnist_cnn_he.py         # train HE-compatible CNN (poly activations, avgpool)

uv run python -m benchmarks.metrics                # writes benchmarks/results.json (time/memory/accuracy, plain vs HE)

uv run python -m interface.cli                     # CLI: run inference or show benchmarks for a dataset
uv run python -m interface.app                     # Flask dev server; "/" redirects to "/live" (the teaching UI)
```

Every entry point that imports across top-level packages (`tests/`, `benchmarks/metrics.py`, `interface/app.py`,
`interface/cli.py`) must be run with `python -m <dotted.path>` from the repo root, not `python path/to/file.py`
directly — plain script invocation fails with `ModuleNotFoundError` since these packages import each other via
absolute imports (e.g. `from interface.cli import ...`) with no `sys.path` hack.

Tests are plain `assert`-based scripts with a `run_*()`/`main()` entry point guarded by
`if __name__ == "__main__"` (see `tests/test_transport_roundtrip.py`) — not pytest suites.

## Project rules (docs/rules.md — enforced, not optional)

- Follow `docs/checklist.md` roadmap order; don't skip ahead.
- Strict modularity: `colors.*`, `fonts.*`, and each UI component live in their own file. `interface/app.py`
  only imports and composes — no inline styling/inline component definitions.
- Every crypto operation (keygen, encrypt, decrypt, transport) lives in `hecrypto/` — never inlined elsewhere.
- Every model type gets its own train/infer module — no shared "god" file.
- Benchmarks logged per model per dataset — no ad hoc timing prints.
- Real datasets only, no synthetic stand-ins unless explicitly marked as synthetic.
- Log every action (commands, files touched, results) to `docs/logs.md` immediately, phase-tagged.
- Download/setup scripts must be idempotent (check for existing output before re-fetching).
- Don't present multiple-choice options back to the user — proceed with the most reasonable next step.

## Architecture

Full module-by-module reference lives in **`docs/ARCHITECTURE.md`** — read it instead of re-deriving structure
from scratch. Quick orientation: `hecrypto/` (all crypto, isolated per rule above), `data/loaders/` +
`data/features/` (per-dataset loading + feature extraction), `models/train/` (one script per dataset+model
pair), `inference/` (runs models against encrypted input, records real event traces with why/formal/next
explanation text), `crypto_teaching/real_ckks.py` (from-scratch CKKS implementation for showing real algorithm
internals TenSEAL hides), `interface/` (Flask app + the `/live` teaching UI, see ARCHITECTURE.md's UI
architecture section for every JS file's role), `benchmarks/metrics.py` (plaintext vs. HE cost per model).

## Notes

- `src/kryptamet/__init__.py` is the packaging entry point referenced by `pyproject.toml`
  (`[project.scripts] kryptamet = "kryptamet:main"`); actual application logic lives in the top-level
  `hecrypto/`, `inference/`, `interface/`, `models/`, `data/` packages, not under `src/`.
- `UnProAIO.py` (root) and `tooldata/` are an unrelated standalone PyQt6 desktop tool (project-management
  reader/rewriter/checklist/logs app), not part of the HE pipeline.
