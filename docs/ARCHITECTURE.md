# Kryptamet — Architecture

Reference for the codebase as it stands (end of Phase 7). For *why* and *when*, see `docs/logs.md` (build log)
and `docs/checklist.md` (roadmap). Hard project rules are in `docs/rules.md`. What the `/live` UI shows and how
the browser verifies it, chapter by chapter, is in `docs/LIVE_UI_TRUTH.md`.

## What this is

Homomorphic encryption (HE) computes on encrypted data without decrypting it. Kryptamet trains ordinary
models (logistic regression, a small CNN) on plaintext data and runs the same models on CKKS-encrypted input
(TenSEAL). A **server** (data owner) encrypts; a **client** (compute node) holding only public keys computes
`Enc(x)·Wᵀ + b`. The server then decrypts and checks the result against the plaintext model. Ciphertexts
travel between the two sealed with AES-256-GCM, with the AES key locked by RSA-OAEP. A Flask app serves `/live`,
a step-by-step teaching walkthrough of one real run.

## Directory map

```
hecrypto/          all crypto: CKKS context/encrypt/decrypt/evaluate, transport (AES-GCM + RSA-OAEP),
                   step-by-step tracers checked against the real libraries, from-scratch CKKS (ckks_math.py)
data/loaders/      raw data per dataset -> (X, y)
data/features/     featurizers: stylometric, TF-IDF, tabular (scaler), symptoms, MNIST pixels
models/train/      one training script per (dataset, model) -> models/saved/
inference/         model registry, the traced two-party pipeline, the encrypted CNN, event recorder
interface/         Flask app (app.py), CLI (cli.py), /live templates + static JS/CSS
benchmarks/        plaintext vs HE time/memory/agreement per model -> results.json
scripts/           download.py (idempotent dataset fetch)
tests/             plain assert scripts: uv run python -m tests.<name>
```

## Crypto — `hecrypto/`

Every crypto operation lives here (rules.md).

- **`ckks_context.py`** — builds the TenSEAL CKKS context with `create_context(poly_modulus_degree=8192,
  coeff_mod_bit_sizes=[60,40,40,60], global_scale_bits=40)`, which also generates the Galois keys.
  - `serialize_context` / `context_from_bytes` serialize it.
  - `ckks_params_of` reads the real parameters back.
  - The CNN path builds its own N=32768 context.
- **`encrypt.py` / `decrypt.py`** — thin TenSEAL wrappers (encrypt, serialize, deserialize, decrypt).
- **`evaluate.py`** — `encrypted_linear_scores(enc_x, W, b)`: the client's one homomorphic op,
  `enc_x.matmul(Wᵀ) + b`. It serves both binary (k=1) and multiclass (k>1) models.
- **`keygen.py`** — saves a secret-bearing and a public-only context to disk. This is a standalone utility;
  the app makes a fresh context per request.
- **`transport.py`** — RSA-2048 keypairs, AES-256-GCM sealing with a 12-byte nonce, a 16-byte tag and an AAD
  header, and the AES key RSA-OAEP(SHA-256)-wrapped for the recipient.
  - **Wrapping:** `wrap_payload[_traced]` / `unwrap_payload[_traced]`; the traced variants return the full
    base64 payload and SHA-256 hashes.
  - **Keys:** `derive_key_from_passphrase` (PBKDF2-HMAC-SHA256, 200,000 iterations, random 16-byte salt),
    `new_aes_key`, `new_salt`, `new_passphrase`.
  - **`tamper_test`:** flips one ciphertext bit and one tag bit and checks that both are rejected.
- **Tracers** recompute an operation step by step and assert it equals the real library, raising on mismatch:
  - `pbkdf2_trace.py`: SHA-256 compression traced; PBKDF2 = hashlib.
  - `rsa_trace.py`: p, q, n, e, d, λ, and the CRT values.
  - `aes_trace.py`: AES-256 rounds, GCM counters, keystream, GHASH, tag = `cryptography`.
  - `ckks_encode_trace.py`: slot packing, Δ-scaling, σ⁻¹ to 8192 coefficients (= SEAL's encoder), the RNS
    primes and residues, the serialized header, and a decrypt round trip.
- **`ckks_math.py`** — from-scratch CKKS on numpy uint64.
  - **Scheme:** N=256, Q=2⁶⁰, Δ=2²⁵. Slot roots are ζ^(5ʲ), so rotations are cyclic.
  - **Operations:** encode/decode, keygen, encrypt/decrypt, `add`, `add_plain`, `mul_plain`, the Galois
    automorphism, BV key switching (base 2¹⁵, 4 digits) and `rotate`.
  - **`run_full_deep_dive(x, w, b)`** computes `w·x + b` encrypted:
    1. encode
    2. keys
    3. encrypt per 128-slot chunk
    4. × ŵ
    5. add the chunks
    6. 7 rotate-and-add rounds
    7. + b
    8. decrypt
    9. decode

    Polynomials are returned as decimal strings, since they exceed JS's 2⁵³. `shown_chunk` is the chunk with
    the most non-zero inputs.
- `verify_tenseal.py` — a five-line TenSEAL install check. `keys/` is an empty output folder for `keygen.py`.

## Data and models

- **Loaders** (`data/loaders/`: `mnist`, `sms_spam`, `german_credit`, `symptom_diagnosis`, `price_data`,
  `human_vs_ai_text`) read `data/raw/<dataset>/`. `scripts/download.py` fetches all of them except
  `human_vs_ai_text`, which comes from a manual Kaggle download (README).
- **Featurizers** (`data/features/`). Each `featurize` returns `{x, feature_names, x_captions, feature_trace,
  input_echo}`, the trace being the step-by-step computation the Feature chapter shows:
  - `text_stylometric`: 8 statistics; `extract_traced` equals `extract`.
  - `tfidf`: the saved vectorizer's 500-word vocabulary.
  - `tabular`: one-hot for categories, then the saved scaler's (v−μ)/σ.
  - `symptoms`: 132 0/1 flags.
  - `mnist`: pixels / 255 in float32, as in training.
- **Training** (`models/train/`): one script per pair, each saving a pickle bundle `{model, vectorizer|scaler}`.
  - Logistic regressions for sms_spam, human_vs_ai_text, german_credit, price_data, symptom_diagnosis (41
    classes) and mnist (10 classes).
  - `mnist_cnn.py`: the plaintext CNN baseline.
  - `mnist_cnn_he.py`: `HECompatibleCNN`, with x² activations and average pooling, because CKKS evaluates only
    polynomials. Saved as a `state_dict`.

## Inference — `inference/`

- **`model_registry.py`** — the six live models. Each entry holds:
  - `label`, `input_kind` (`text` / `tabular` / `symptoms` / `image`), `task`, `class_names`
  - `featurize`, which validates its input at the trust boundary
  - `weights()`, `plain_predict`, `plain_scores`
  - `samples()`: real test-set rows, cases and images for the input panels

  `public_models()` feeds `GET /api/models`.
- **`he_infer.py`**
  - `encrypted_linear_score`: the plain encrypt → score → decrypt path, used by the CLI, the benchmarks and
    `test_he_inference`.
  - `run_two_party_pipeline(...)`: the `/live` pipeline. It records ordered events (operation, party,
    description, why, formal, next, data):
    - **keys:** `ckks_keygen`, `rsa_keygen_server`/`_client`, `passphrase`, `pbkdf2`
    - **encrypt:** `load_plaintext`, `ckks_encrypt`
    - **leg 1:** `leg1_wrap`/`_unwrap`
    - **compute:** `compute_overview`, `compute_general_form` (the real op on a context rebuilt from public
      bytes, asserted public-only), then a plaintext mirror of the traced row: `weight_multiply` for the 20
      largest |w·x| terms, `smaller_terms`, `zero_terms`, `add_bias`
    - **leg 2:** `leg2_session_key`, `leg2_wrap`/`_unwrap`
    - **result:** `ckks_decrypt`
  - A random passphrase is generated when none is given.
- **`he_cnn_infer.py`** — encrypted CNN forward pass: im2col convolutions, decrypting between layers. Used by
  the benchmarks and `test_he_cnn_inference`; not live.
- **`pipeline_events.py`** — `PipelineRecorder.emit(...)` / `as_list()`.

## Web — `interface/`

### `app.py`
Only imports and composes.

| Route | What it does |
|---|---|
| `GET /` | redirects to `/live` |
| `GET /live` | `scenes.html`, with `benchmarks/results.json` injected as `window.BENCHMARKS` |
| `GET /api/models` | the registry's public view |
| `POST /api/infer` (alias `/api/infer_text`) | takes `{model, input, passphrase}`, where `input` is `{text}` / `{row}` / `{symptoms}` / `{pixels}` (a bare `text` also works); runs the two-party pipeline and returns the events, x, captions, traces and scores |
| `POST /api/ckks_deep_dive` | takes `{model, input}` and returns `run_full_deep_dive` on the predicted class's row |

`cli.py` is a terminal menu for plaintext vs HE inference on samples and for saved benchmarks.

### `/live` UI
Vanilla JS, no build step. The interaction model is modelled on the separate Snek project:
1. **Overview:** a model picker and an input panel.
2. **Flowchart:** 10 chapter boxes in a snake layout.
3. **Dolly zoom** into a chapter.
4. **Inside a chapter:** a Scrubber with play/pause/step/speed, a what/why/formal/next grid with glossary
   links, and a step slider. Next on a chapter's last step zooms out and into the next chapter.

Each box shows a proof badge: the browser checks that passed while you watched that chapter. Always dark.

**Chapters** (`chapter_registry.js`):
1. Feature Extraction
2. Key Setup
3. Encryption
4. CKKS Deep-Dive
5. Transport → client
6. Computation
7. Transport ← server
8. Decryption
9. Result
10. Benchmarks

One component per file (`interface/static/js/`, with CSS of the same name where it has its own styles):

- **App state and navigation**
  - `pipeline_api.js`: `runPipeline(model, input, passphrase)`, `fetchCkksDeepDive`, `fetchModels`,
    `inputSummary`, the global `pipelineResult`.
  - `chapter_state.js`: views, per-chapter step memory, done chapters, `goToNextChapter`, proof tallies.
  - `chapter_registry.js`: `CHAPTERS` (id, label, `buildSteps`, `summary`, `stepBands`).
  - `flowchart.js`, `zoom_transition.js`, `minimap.js`, `intro_card.js` + `chapter_intros.js` (the per-chapter
    theory primers).
- **Scrubber**
  - `scrubber.js`, `step_slider.js`, `speed_dial.js`, `glossary.js`.
  - Two speeds: `window.stepSpeed` (Scrubber and step animations) and `window.gridSpeed` (poly grids), each
    saved to localStorage.
- **Overview and input panels**
  - `overview_form.js`.
  - Panels: `text_input.js`, `tabular_input.js`, `symptom_input.js`, `digit_canvas.js` (also
    `digitGridSvg`).
- **Chapter step builders**: each returns `[{what, why, formal, next, renderVisual(el)}]`.
  - `scene_renderers.js`: Feature Extraction, Decryption, Result, Benchmarks, plus shared helpers (`fmt`,
    `findEv`, `inputVector`).
  - `key_setup_steps.js`, `encryption_steps.js`, `deep_dive_steps.js`, `transport_steps.js` (both legs),
    `computation_steps.js`.
- **Browser verification** (see LIVE_UI_TRUTH.md)
  - `sha256_check.js` (SHA-256 rounds), `aes_check.js` (AES-GCM, RSA-OAEP, WebCrypto unwrap and tamper),
    `encrypt_check.js` (CKKS encoding, RNS, header, SHA-256), `deep_dive_check.js` (BigInt polynomial
    relations and slot decoding).
  - The ✓/✕ chips are `renderChecks` / `tpCheck` / `tpSetCheck`.
- **Visual components**
  - `poly_grid.js` (256-cell grid; returns a controller {play, pause, stepCell, restart, done}) with
    `grid_controls.js`.
  - `byte_matrix.js`, `pbkdf2_graph.js` (generic node graph), `sub_zoom.js` (nested dolly zoom),
    `escape_html.js`.
- **CSS**
  - Design tokens in `colors.css` / `fonts.css`; shared components in `components.css` (including the global
    `[hidden]` rule).
  - One file per component or chapter (`flowchart.css`, `scrubber.css`, `poly_grid.css`, `transport.css`, …).
  - No inline `style=""` attributes. Geometry computed per layout is applied by JS after render.

## Benchmarks — `benchmarks/metrics.py`

Times each of the 6 logistic regressions on 5 test samples, plaintext vs `encrypted_linear_score`, and the HE
CNN on 3. Records peak memory (tracemalloc) and plain-vs-HE agreement, writing `benchmarks/results.json`
(7 rows). The data is read by the Benchmarks chapter and the CLI.

## Tests

Plain assert scripts with a `main()`, run as `uv run python -m tests.<name>`:

| Test | What it checks |
|---|---|
| `test_transport_roundtrip` | the transport wrap/unwrap round trip |
| `test_pbkdf2_rsa_trace` | the PBKDF2 and RSA tracers |
| `test_aes_trace` | the AES-GCM tracer |
| `test_ckks_encode_trace` | the CKKS encoding tracer |
| `test_ckks_math` | negacyclic exactness, rotations, the deep-dive vs plaintext on real models |
| `test_model_registry` | the registry, invalid inputs, `public_models` |
| `test_two_party_pipeline` | event order and parties, scores vs sklearn, both legs, the term order |
| `test_he_inference` | encrypted vs plaintext scores for the logistic regressions |
| `test_he_cnn_inference` | the encrypted CNN, slow |

Browser checks of `/live` were run as one-off Playwright scripts during each phase; see logs.md.

## Running it

```
uv sync
uv run scripts/download.py                         # idempotent
uv run python -m interface.app                     # http://127.0.0.1:5000/live
uv run python -m interface.cli
uv run python -m benchmarks.metrics
uv run python -m tests.test_two_party_pipeline     # any test, same pattern
```
