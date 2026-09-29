# Kryptamet — Architecture

Reference documentation for the codebase as it stands. For *why* decisions were made and in what order,
see `docs/logs.md` (chronological build log) and `docs/checklist.md` (roadmap/phase tracker). For hard
project rules, see `docs/rules.md`. This file documents *what exists and how it fits together*.

## What this is

Homomorphic encryption (HE) lets you compute on encrypted data without ever decrypting it. Kryptamet trains
ordinary ML models (logistic regression, a small CNN) on plaintext data, then runs inference on the *same*
models against CKKS-encrypted input, decrypts only the final result, and checks it matches the plaintext
prediction. A server performing the computation never sees the real input or the real output — only
ciphertext. Ciphertext in transit is additionally wrapped in an RSA+AES hybrid scheme. A Flask web UI walks
through every stage of this pipeline with real data, for teaching.

## Directory map

```
hecrypto/           CKKS context + keygen + encrypt/decrypt + RSA+AES transport (all crypto, isolated here)
data/loaders/        raw-data loading per dataset -> (X, y)
data/features/       feature extraction (text stylometry, image normalization)
models/train/        one training script per (dataset, model) pair -> models/saved/*.pkl|*.pt
inference/            runs trained models against encrypted input; records step-by-step event traces
crypto_teaching/      from-scratch (non-TenSEAL) CKKS implementation, for showing real algorithm internals
interface/            CLI + Flask app + static/templates for the web UI
benchmarks/           plaintext vs. HE timing/memory/accuracy, per model
tests/                plain assert-based scripts (not pytest), run with `uv run python -m tests.<name>`
```

## Crypto core — `hecrypto/`

Every HE and transport-layer operation lives here; nothing elsewhere touches raw crypto primitives.

- **`ckks_context.py`** — `create_context(poly_modulus_degree=8192, coeff_mod_bit_sizes=[60,40,40,60],
  global_scale_bits=40)` builds a TenSEAL CKKS context (generates Galois keys, sets the global scale).
  `save_context`/`load_context` serialize a context to/from disk, optionally including the secret key.
  The CNN path needs a much larger ring (`poly_modulus_degree=32768`) because im2col-encoded convolutions
  don't fit in the default context — every CNN-related call site builds its own context with these larger
  params instead of using the default.
- **`keygen.py`** — `generate_keys(secret_key_path, public_key_path, ...)`: builds a context, saves the full
  (secret-key-bearing) context to one file and a public-only copy (`context.copy()` +
  `make_context_public()`) to another. Used for persisting keys to disk; most of the app instead just
  calls `create_context()` fresh per request (no persistence needed for a stateless demo).
- **`encrypt.py`** / **`decrypt.py`** — thin wrappers over TenSEAL: `encrypt_vector`/`decrypt_vector`,
  `serialize_encrypted`/`deserialize_encrypted`, and the combined `encrypt_and_serialize`/
  `deserialize_and_decrypt` convenience functions.
- **`transport.py`** — RSA+AES hybrid wrap/unwrap of already-encrypted ciphertext bytes, used to move a
  CKKS ciphertext between "client" and "server" the way a real deployment would send it over a network:
  `generate_rsa_keypair`, `wrap_payload`/`unwrap_payload` (AES-256-CBC with a random session key, that key
  itself RSA-OAEP-encrypted), plus a passphrase-derived variant (`wrap_with_passphrase`/
  `unwrap_with_passphrase`, PBKDF2-HMAC-SHA256, 200,000 iterations) for when a user wants to supply their
  own key instead of a random one. `wrap_payload_traced` is the same as `wrap_payload` but also returns
  hex previews/sizes of the AES ciphertext and the RSA-wrapped key, purely for UI display — never do this
  in a real deployment (rule: transport internals should normally be opaque).

## Data — `data/loaders/`, `data/features/`

- **Loaders** (`mnist`, `sms_spam`, `german_credit`, `symptom_diagnosis`, `price_data`, `human_vs_ai_text`):
  each exposes `load(...)` returning `(X, y)` from `data/raw/<dataset>/`. `mnist.py` reads IDX-format files
  directly (no external dependency). `symptom_diagnosis.py` label-encodes the `prognosis` column (41
  classes) via pandas categoricals. All raw data is real, downloaded by `scripts/download.py`
  (idempotent — skips re-fetching if already present) except `human_vs_ai_text`, which requires a manual
  Kaggle download per `README.md`.
- **Features**: `data/features/text_stylometric.py` computes 8 stylometric features (word/char/sentence
  counts, average lengths, lexical diversity, punctuation/uppercase ratios) for `human_vs_ai_text` and
  `sms_spam`-adjacent text tasks. `extract(texts)` returns the raw feature matrix; `extract_traced(text)`
  returns the *same* computation as a step-by-step trace — `[{name, raw_computation, value, why, next}, ...]`
  — and is the template the rest of the app's explanation text (Part A below) follows. `data/features/`
  also has an MNIST image-normalization module (Pillow-based resize/normalize).

## Models — `models/train/`, `models/saved/`

One training script per (dataset, model-type) pair — no shared "god" training file, per project rules.
Tabular datasets get an `sklearn` logistic regression, saved as a pickle bundle (`{"model":...,
"vectorizer"|"scaler": ...}` as applicable). MNIST gets two CNNs:

- **`mnist_cnn.py`** — a standard `SmallCNN` (ReLU + maxpool), the plaintext-only baseline.
- **`mnist_cnn_he.py`** — `HECompatibleCNN`: same shape (2 conv + 2 pool + 2 fc), but ReLU replaced with a
  `SquareActivation` (`x*x`) and maxpool replaced with `AvgPool2d`, because CKKS can only evaluate
  polynomial functions on ciphertext — max and ReLU aren't expressible. Trained separately; accuracy is
  comparable to (in this case slightly better than) the original CNN. Saved as a bare `state_dict`
  (`models/saved/mnist_cnn_he.pt`) — loading it requires instantiating `HECompatibleCNN()` first, then
  `load_state_dict(...)`.

## Inference — `inference/`

- **`he_infer.py`** — the core logistic-regression HE math:
  - `encrypted_linear_score(context, x, weights, bias)`: encrypts `x`, computes `dot(x, weights) + bias`
    homomorphically, decrypts, returns the raw score. Used by `benchmarks/metrics.py` and `interface/cli.py`.
  - `run_traced_inference` / `run_full_traced_pipeline`: same computation, but returning every intermediate
    artifact (plaintext input, ciphertext bytes + hex preview + size at each stage, transport wrap/unwrap
    results with integrity checks, final decrypted score) for UI display. `run_full_traced_pipeline` chains
    CKKS encrypt → RSA+AES wrap → unwrap → CKKS decrypt end to end.
  - `run_full_traced_pipeline_with_events`: the version the web UI actually calls. Emits a real,
    granular `PipelineEvent` per discrete operation via `PipelineRecorder` (see below) — one event per
    feature's weight-multiply (even though CKKS actually performs the whole weighted sum as a single
    vectorized/SIMD ciphertext operation; the per-feature breakdown is the real mathematical decomposition
    of that one operation, shown incrementally for teaching), plus `add_bias`, the real vectorized compute
    event, transport wrap/unwrap, and final decrypt. Every emitted event carries `description` (the
    per-instance real value/formula), `why` (why this operation happens, static text per operation type),
    and `next_step` (what happens to this result next) — see "Explanation data" below.
- **`he_cnn_infer.py`** — encrypted CNN forward pass: `encrypted_conv2d` (TenSEAL `im2col_encoding` +
  `conv2d_im2col`, decrypting between conv layers — a "leveled" round-trip pattern to avoid excessive
  multiplicative depth on a single ciphertext), `square`/`avgpool2d` (plaintext, applied post-decrypt per
  layer), `encrypted_linear_layer` (per-output-neuron encrypt/decrypt). `run_encrypted_cnn(context,
  image_28x28, state_dict)` chains conv1 → square → avgpool → conv2 → square → avgpool → fc1 → square → fc2,
  returning raw (unencrypted, since each layer decrypts before the next) logits.
- **`pipeline_events.py`** — `PipelineRecorder`: `emit(stage, operation_name, description, data_before=None,
  data_after=None, why="", next_step="")` appends an ordered event dict (`index`, `stage`, `operation_name`,
  `description`, `why`, `next_step`, `data_before`, `data_after`, `elapsed_sec`). `as_list()` returns the
  full ordered event log. This is what the web UI's Computation/Transport/Decryption chapters are built
  from — every event is a real thing that really happened during that specific request, not a canned
  animation script.

### Explanation data (what/why/next)

Every step shown in the web UI's Scrubber (see below) needs a `what` (what happened), `why` (why, in plain
language), and `next` (what happens to this result next). Two sources feed this:

1. `data/features/text_stylometric.py::extract_traced()` — per-feature `{raw_computation, why, next}`,
   the original template for this pattern.
2. `inference/he_infer.py::run_full_traced_pipeline_with_events()`'s `PipelineRecorder.emit(...)` calls —
   each operation type (`load_plaintext`, `ckks_encrypt`, `weight_multiply`, `add_bias`,
   `ckks_vectorized_compute`, `passphrase_aes_wrap`/`rsa_aes_wrap`, `rsa_aes_unwrap`, `ckks_decrypt`) has
   `why`/`next_step` text authored once, applied to every instance of that operation type. The *what*
   (`description`) is always fully per-instance and real (actual weight/input/product values, actual
   ciphertext sizes); the *why*/*next* text is static per operation type — same pattern Snek (the UI's
   structural inspiration, see below) uses for its own repeated-step explanations.

CKKS deep-dive steps (below) don't pull from the backend at all — their `what`/`why` paragraphs are
authored directly in `interface/static/js/scene_renderers.js`, since each is a whole-scene explanation
of a mathematical step rather than a per-item event.

## CKKS deep-dive — `crypto_teaching/real_ckks.py`

TenSEAL is an opaque wrapper over Microsoft SEAL — it never exposes polynomial/ciphertext internals. This
module is a from-scratch, independent CKKS implementation that exists *purely* so the UI can show the real
algorithm running on the user's real data, alongside (never replacing) the production TenSEAL pipeline.
Single-modulus, N=256, no RNS chain (RNS is a performance optimization, not different math — skipped since
this path is for visualization, not production):

- `encode`/`decode` — canonical embedding via the inverse/forward Vandermonde matrix (`_V_inv`/`_V`,
  precomputed once at import time from primitive `2N`-th roots of unity).
- `negacyclic_mul(a, b)` — schoolbook polynomial multiplication mod `X^N + 1` (wrap-around terms flip
  sign, since `X^N = -1` in this ring) and mod `Q`.
- `ternary_poly()` / `error_poly(sigma=3.2)` — real ternary secret-key sampling, real discrete-Gaussian
  error sampling.
- `keygen()` → `(s, (b, a), e)`: `b = -a*s + e (mod q)`.
- `encrypt(m_coeffs, pk)` → `(c0, c1, u, e1, e2)`: `c0 = b*u + e1 + m`, `c1 = a*u + e2`.
- `decrypt(c0, c1, s)` → `m'`: `m' = c0 + c1*s (mod q)` — only `s` can cancel the masking term buried in
  `c0`.
- `run_full_deep_dive(vector)` — runs the whole chain on a real 8-dim feature vector (taken from whatever
  the user typed), returns every intermediate polynomial as a full 256-coefficient array. Wired to
  `POST /api/ckks_deep_dive` in `interface/app.py`.

## Web interface — `interface/`

### `cli.py`
Menu-driven terminal client: pick a dataset, run plaintext vs. HE inference on a sample (`_run_inference`,
`_get_sample`), or view saved benchmark results (`_show_benchmarks`). Considered stable/historical — not
user-facing UI, not part of the redesign below.

### `app.py` (Flask)
- `GET /` — old tab-based `index.html` (kept, not actively developed).
- `GET /live` — the current teaching UI, `scenes.html`.
- `POST /api/infer_text` — accepts `{model, text, passphrase}`, runs real feature extraction + the full
  traced HE pipeline (`run_full_traced_pipeline_with_events`), returns plaintext/HE predictions, match
  status, and the full event list (with `why`/`next_step` on every event).
- `POST /api/ckks_deep_dive` — accepts `{model, text}`, runs `real_ckks.run_full_deep_dive()` on the same
  user input's first 8 feature values, returns all intermediate polynomials.
- `POST /infer` — legacy form-post path feeding the old `index.html`.

### `/live` UI architecture

Structural model ported from a separate project, `Snek` (a Preact compiler-visualizer): an overview
**flowchart** of chapter boxes you click into, a **dolly-zoom transition** into the clicked chapter, and
inside each chapter a **Scrubber** (play/pause/step/step-counter + a fixed-height what/why/next explanation
strip + a draggable step-slider). Re-implemented in vanilla JS (no framework) since Kryptamet has none;
Snek's glossary-term-linking and 4th "formal notation" explanation cell were dropped as not applicable to
most Kryptamet steps (the CKKS deep-dive already shows real math via its own poly-grid equations instead).
Always dark, no light/dark toggle.

Flow: **Overview** (model picker + text input, `renderOverviewScene`) → Run → **flowchart** of 9 chapter
boxes (Feature Extraction, Key Setup, Encryption, CKKS Deep-Dive, Computation, Transport, Decryption,
Result, Benchmarks) → click a box → zoom in → that chapter's Scrubber-driven detail view → back button
zooms back out to the flowchart.

Files, each one concern (per project rule — no god files):

- **`static/js/chapter_registry.js`** — `CHAPTERS`: the 9-entry metadata array, each
  `{ id, label, requiresResult, buildSteps(result, deepDiveResult) }`. `buildSteps` returns an array of
  `{ what, why, next, renderVisual(el) }` — one entry per step in that chapter.
- **`static/js/scene_renderers.js`** — `renderOverviewScene` (the entry form) plus every chapter's
  `buildXSteps` function (`buildFeatureSteps`, `buildKeySteps`, `buildEncryptionSteps`,
  `buildDeepDiveSteps`, `buildComputationSteps` + `buildComputationBands`, `buildTransportSteps`,
  `buildDecryptionSteps`, `buildResultSteps`, `buildBenchmarksSteps`). `renderVisual` in each step is the
  actual DOM-building code (poly-grid calls, ciphertext-box markup, the transport packet animation, the
  result compare-grid, the benchmarks table). `RESULT_LABELS` maps a model's raw 0/1 prediction to a
  plain-language label (`sms_spam`, `human_vs_ai_text` — the only two models reachable from the UI's model
  picker).
- **`static/js/chapter_state.js`** — app-level state machine: `currentView` (`"overview" | "flowchart" |
  chapterIndex`), `chapterSteps` (resolved per-chapter step arrays, built once via `buildAllChapterSteps()`
  right after a run completes), `stepIndices` (per-chapter last-seen step, restored on re-entry),
  `doneChapters`. `enterChapter(index, originEl)` / `exitToFlowchart(originEl)` compute the clicked
  element's screen position as the zoom origin and drive `zoomTransition`; `mountChapter(index)` builds the
  real interactive Scrubber for a chapter. A chapter is only clickable once inference has run
  (`chapterEnabled`).
- **`static/js/zoom_transition.js`** — `zoomTransition({ container, origin, direction, renderFrom, renderTo,
  onDone })`: mounts both the "from" and "to" views as absolutely-positioned layers, double-`requestAnimationFrame`-delays
  before starting the CSS transition (so heavy DOM like poly-grids settles first), then a ~650ms
  `transform: scale()` + `opacity` animation with `transform-origin` at the click point. `"in"`: the
  flowchart box recedes/fades while the chapter view rushes in from near-zero. `"out"`: reverse.
- **`static/js/scrubber.js`** — `createScrubber(containerEl, { steps, chapters, onStepChange })`:
  play/pause/prev/next, step counter, the 3-cell what/why/next explanation strip, and the step slider.
  Autoplay pace reads the single navbar speed slider (`window.gridRevealSpeed`) — there is deliberately no
  separate per-scrubber speed control.
- **`static/js/step_slider.js`** — `createStepSlider(containerEl, { total, current, chapters, onSeek })`:
  draggable/click-to-seek track with optional chapter tick marks (used by Computation to mark
  weight-multiply / bias / vectorized-compute bands) and a hover tooltip.
- **`static/js/minimap.js`** — `initMinimap(containerEl, chapterLabels)`: a horizontal pill of one dot per
  chapter (current glows, completed ones colored, connected by `→`) — replaces an earlier L-path SVG
  design. `update(activeIndex, doneIndices)` redraws state.
- **`static/js/poly_grid.js`** — `renderPolyGrid(containerEl, coeffs, equations, options)`: the 256-cell
  grid used by every CKKS deep-dive step, with an animated per-cell "equation reveal" phase (KaTeX-rendered)
  before settling to the numeric value; `options.skipAnimation` shows the final state instantly (used when
  re-visiting a step that's already been seen).
- **`templates/scenes.html`** — the shell: navbar (brand, restart button, speed slider), `#sceneContent`
  (mounts Overview or a chapter's visual area), `#flowchartContainer`, `#backToFlowchartBtn`,
  `#minimapContainer`, `#scrubberDock`. Also holds `pipelineResult` (global, set by `runPipeline()` after
  a successful `/api/infer_text` call) and the inline glue wiring the speed slider, restart button, and
  back button.
- **`static/css/scrubber.css`** — flowchart box grid, zoom-layer keyframes, chapter-dot minimap, and all
  Scrubber/step-slider/explanation-strip styling. Colors pull from `colors.css` tokens only (`--color-primary`
  etc.) — no separate palette was introduced for this redesign.
- **`static/css/{colors,fonts,components,scenes,poly_grid,live_pipeline_input}.css`** — base design tokens
  and shared component styling (buttons, cards, ciphertext boxes, compare grids), reused across both the
  old `index.html` and the current `/live` UI.

## Benchmarks — `benchmarks/metrics.py`

`_time_and_memory(fn, *args)` wraps a call with `time.perf_counter()` timing and `tracemalloc` peak-memory
tracking. `_benchmark_model(name, X_encoded, model)` runs `N_SAMPLES=5` predictions both plaintext and via
`encrypted_linear_score`, computing agreement between the two. `_benchmark_mnist_cnn()` does the same for
the CNN path (`N_SAMPLES_CNN=3` — encrypted CNN inference is far more expensive per-sample: two conv layers
with per-channel im2col encrypt/decrypt plus two linear layers over a `poly_modulus_degree=32768` ring,
vs. a single vectorized op for the linear models). `run_all()` builds all 6 results (5 logreg models + the
CNN) as a flat list, writes `benchmarks/results.json`, and prints a summary line per model. Read by both
`interface/cli.py`'s `_show_benchmarks()` and the web UI's Benchmarks chapter (via
`interface/templates/components/benchmark_table.html`).

## Running it

```
uv sync                                          # install deps
uv run scripts/download.py                       # fetch datasets (idempotent)
uv run python -m tests.test_transport_roundtrip   # tests are plain scripts, run with -m
uv run python -m benchmarks.metrics               # writes benchmarks/results.json
uv run python -m interface.app                    # Flask dev server; index at "/", teaching UI at "/live"
uv run python -m interface.cli                    # terminal client
```
