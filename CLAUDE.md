# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Homomorphic encryption (CKKS via TenSEAL) pipeline for privacy-preserving ML inference. Encrypted vectors are
transported using an RSA+AES hybrid scheme. Models (logistic regression, small CNN) are trained on plaintext
data, then benchmarked for encrypted-inference cost across datasets (MNIST, SMS spam, symptom-diagnosis,
German Credit, price data, human-vs-AI text). A Flask app (`interface/app.py`) drives a full-screen scene-based
teaching UI that walks through the entire pipeline (feature extraction → keygen → encrypt → compute →
transport → decrypt → result → benchmarks), including a second, independent educational CKKS implementation
(`crypto_teaching/real_ckks.py`) that exposes real polynomial/ciphertext internals TenSEAL hides.

Read `docs/checklist.md` before starting work — it is the authoritative roadmap/phase tracker (Phase 0–7) and
shows exactly what's done vs. pending, including the current UX rework (Phase 6F) with the intended scene
order. `docs/rules.md` holds hard project rules (see below). `docs/logs.md` is an append-only log of
setup/build steps — log actions there per the rules.

## Commands

```
uv sync                          # install deps from pyproject.toml + uv.lock (Python >=3.13)
uv run scripts/download.py       # fetch MNIST/SMS-spam/German-Credit/symptom-diagnosis/price data into data/raw/
                                  # human_vs_ai_text must be manually placed at data/raw/human_vs_ai_text/AI_Human.csv (Kaggle)

uv run python tests/test_transport_roundtrip.py    # run a single test file directly
uv run python tests/test_he_inference.py
uv run python tests/test_he_cnn_inference.py

uv run python models/train/<dataset>_logreg.py     # train/re-save a given logreg model to models/saved/
uv run python models/train/mnist_cnn.py            # train plaintext-baseline CNN
uv run python models/train/mnist_cnn_he.py         # train HE-compatible CNN (poly activations, avgpool)

uv run python benchmarks/metrics.py                # writes benchmarks/results.json (time/memory/accuracy, plain vs HE)

uv run python interface/cli.py                     # CLI: run inference or show benchmarks for a dataset
uv run python interface/app.py                     # Flask dev server (index at "/", scene UI at "/live")
```

Tests are plain `assert`-based scripts with a `run_*()` entry point guarded by `if __name__ == "__main__"`
(see `tests/test_transport_roundtrip.py`) — not pytest suites; run each file directly with `uv run python`.

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

**`hecrypto/`** — all CKKS + transport crypto, isolated per rule above:
- `ckks_context.py` — builds/saves/loads the TenSEAL CKKS context (poly_modulus_degree=8192 by default).
- `keygen.py`, `encrypt.py`, `decrypt.py` — vector encrypt/decrypt + serialize/deserialize helpers.
- `transport.py` — RSA+AES hybrid wrap/unwrap of serialized ciphertext bytes (AES-CBC + RSA-OAEP for the
  session key; also has a passphrase-derived variant and a `_traced` variant that exposes intermediate
  hex/size values for the teaching UI — never do that in a real deployment).

**`data/loaders/` + `data/features/`** — per-dataset raw-data loading and feature extraction (e.g.
`text_stylometric` for human_vs_ai_text/sms_spam). Raw files under `data/raw/<dataset>/`, processed under
`data/processed/`.

**`models/train/<dataset>_<modeltype>.py`** — one training script per (dataset, model) pair, saving to
`models/saved/*.pkl` (sklearn logreg) or `*.pt` (PyTorch CNN). `mnist_cnn_he.py` is the HE-compatible variant:
polynomial/square activation instead of ReLU, avgpool instead of maxpool, needed because HE can't evaluate
non-polynomial functions on ciphertexts.

**`inference/`** — runs trained models against encrypted input:
- `he_infer.py` — core encrypted-inference math (`encrypted_linear_score`: dot(x, weights)+bias homomorphically)
  plus `run_traced_inference`/`run_full_traced_pipeline(_with_events)`, which capture every intermediate
  artifact (ciphertext bytes/hex previews, transport wrap/unwrap results, decrypted score) for UI display.
  Multiclass models run one encrypted pass per class and take argmax over decrypted scores.
- `he_cnn_infer.py` — encrypted inference for the CNN path.
- `pipeline_events.py` — `PipelineRecorder`, emits a per-feature event stream consumed by the frontend's
  "smoke-feed" animation (real events, not simulated — see checklist Phase 6).

**`crypto_teaching/real_ckks.py`** — a from-scratch, non-TenSEAL CKKS implementation (real canonical
embedding via Vandermonde matrix, real ternary secret key, real negacyclic ciphertext polynomial math,
N=256/4096 single-modulus, no RNS) built purely so the UI can show real encode/keygen/encrypt/decrypt
internals that TenSEAL's opaque wrapper (over Microsoft SEAL) hides. This runs *alongside* the production
TenSEAL pipeline, never replaces it. `run_full_deep_dive()` is the entry point, wired to
`/api/ckks_deep_dive` in `interface/app.py`.

**`interface/`**:
- `cli.py` — terminal entry point (`_get_sample`, `_run_inference`, `_show_benchmarks`); considered
  historical/stable, not user-facing UI, no rebuild planned.
- `app.py` — Flask app. `/` serves the older tab-based `index.html`; `/live` serves the current full-screen
  scene UI (`scenes.html`) that is under active rework — see Phase 6D/6E/6F in `docs/checklist.md` for the
  intended scene order and in-flight fixes before touching this file. `/api/infer_text` returns real event
  JSON from `run_full_traced_pipeline_with_events`; `/api/ckks_deep_dive` returns real_ckks output.

**`benchmarks/metrics.py`** — times + tracemalloc-profiles plaintext vs. encrypted inference per
model/dataset, plus prediction agreement; writes `benchmarks/results.json`, which both `docs/checklist.md`
Phase 5 and `interface/app.py`'s benchmarks scene read from.

## Notes

- `src/kryptamet/__init__.py` is the packaging entry point referenced by `pyproject.toml`
  (`[project.scripts] kryptamet = "kryptamet:main"`); actual application logic lives in the top-level
  `hecrypto/`, `inference/`, `interface/`, `models/`, `data/` packages, not under `src/`.
- `UnProAIO.py` (root) and `tooldata/` are an unrelated standalone PyQt6 desktop tool (project-management
  reader/rewriter/checklist/logs app), not part of the HE pipeline.
