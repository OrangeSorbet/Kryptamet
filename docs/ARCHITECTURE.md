# Kryptamet — Architecture

Reference for the codebase as it stands (end of Phase 7). For *why* and *when*, see `docs/logs.md` (build log)
and `docs/checklist.md` (roadmap). Hard project rules are in `docs/rules.md`. What the `/live` UI shows and how
the browser verifies it, chapter by chapter, is in `docs/LIVE_UI_TRUTH.md`.

## What this is

Homomorphic encryption (HE) computes on encrypted data without decrypting it. Kryptamet trains ordinary
models (logistic regression, a small CNN) on plaintext data and runs the same models on CKKS-encrypted input
(TenSEAL). A **client** (data owner) encrypts; a **server** (compute node) holding only public keys computes
`Enc(x)·Wᵀ + b`. The client then decrypts and checks the result against the plaintext model. Ciphertexts
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
- **`evaluate.py`** — `encrypted_linear_scores(enc_x, W, b)`: the server's one homomorphic op,
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

- **Loaders** (`data/loaders/`: `mnist`, `emnist` (balanced split, 47 classes), `sms_spam`, `german_credit`,
  `symptom_diagnosis`, `price_data`, `human_vs_ai_text`) read `data/raw/<dataset>/`. `scripts/download.py` fetches all of them except
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

- **`model_registry.py`** — the seven live models (`emnist_logreg`: handwriting, digits + letters). Each entry holds:
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
    - **keys:** `ckks_keygen`, `rsa_keygen_client`/`_server`, `passphrase`, `pbkdf2`
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
1. How HE works: the whole scheme on toy numbers (`how_he_steps.js`, `TOY`; q = 10007, Δ = 1000, one
   secret coefficient; every value computed live). It needs no run.
2. Feature Extraction
3. Key Setup
4. Encryption, then "Up close": encode, keys, c0, c1 at N=256
5. Transport → server: the client seals (AES-GCM, RSA-OAEP), the wire, then the server opens it (RSA private
   key → AES key → AES-GCM → the CKKS ciphertext), then the tamper test.
6. Computation, then "Up close": × w, chunk sum, 7 rotate-and-add rounds, + b
7. Transport ← client (same shape, reversed)
8. Result: the real CKKS decryption and sigmoid/softmax, "Up close" decrypt and decode, then the comparison
   with the plaintext run.
9. Benchmarks

The from-scratch CKKS (`deep_dive_steps.js`, `buildDeepDiveSteps(dd, result, stage)`) has no chapter of its own:
each step carries `stage` ("encrypt" / "compute" / "result") and `chapter_registry.js` appends each stage to its
chapter with `joinSteps`, which re-points the last step's "next" text at the part that follows.

One component per file (`interface/static/js/`, with CSS of the same name where it has its own styles):

- **App state and navigation**
  - `pipeline_api.js`: `runPipeline(model, input, passphrase)`, `fetchCkksDeepDive`, `fetchModels`,
    `inputSummary`, the global `pipelineResult`.
  - `chapter_state.js`: views, per-chapter step memory, done chapters, `goToNextChapter`, proof tallies.
  - `chapter_registry.js`: `CHAPTERS` (id, label, `buildSteps`, `summary`, `stepBands`), `joinSteps`.
  - `var_label.js`: every number tied to a variable shows the variable in small type underneath.
    `vn(value, label)` → a token in step text; `vnHtml` for scene HTML; `richText` renders both token kinds;
    plain `name = number` is labelled automatically (`VN_AUTO`).
  - `source_links.js`: "where did this number come from" links.
    - A step declares `facts: [{id, label, value}]`; `registerFacts` records each fact's chapter and step after
      every run.
    - Text points at a fact with `srcRef(id, text)` (explanations, rendered by `linkExplanation`) or
      `srcLinkHtml(id, text)` (scene HTML). The source element carries `data-fact-src`.
    - Hover previews the value and its step; click calls `chapter_state.js` `jumpToFact` (jump + pulse). The
      navbar pill `#srcBackBtn` (and Esc) walks the jump stack back.
  - `flowchart.js`, `zoom_transition.js`, `minimap.js`, `intro_card.js` + `chapter_intros.js` (the per-chapter
    theory primers).
  - `scene_fit.js`: `fitSceneContent` zooms each step's content (`--fit`) to fill ~90% of the free height
    (≤1.6×, scale-up only); called by `chapter_state.js` on every step and again when it settles.
- **Scrubber**
  - `scrubber.js`, `step_slider.js`, `speed_dial.js`, `glossary.js`.
  - `explain_level.js`: the navbar ELI1 / ELI5 / Advanced switch.
    - `window.explainLevel`, default `eli5`, remembered as `kryptamet.level`.
    - `levelTwin(obj)` picks the plain twin: `eli1` (toy numbers) falls back to `eli5`, which falls back to the
      advanced text. `levelText(obj, key)` picks the text; an `explainlevel` event makes the Scrubber and an
      open primer redraw.
    - Every step carries `eli5: {what, why, formal, next}` beside its advanced text ("formal" is titled
      "Significance" at ELI1/ELI5); hard steps also carry `eli1` with a toy-number calculation computed in code
      (toys reuse `TOY` from `how_he_steps.js` where they can).
    - Primers in `chapter_intros.js` carry `eli5: {io, sections}`.
    - All ELI5 text is built from the run's values: `featureEli5` / `featureEli1` (stylometric/tabular),
      `computeEli5` / `computeEli1` (per compute event), and inline twins in every other step builder.
  - Two speeds: `window.stepSpeed` (Scrubber and step animations) and `window.gridSpeed` (poly grids), each
    saved to localStorage.
- **Overview and input panels**
  - `overview_form.js`.
  - Panels: `text_input.js`, `tabular_input.js` (case picker, German code meanings, ±1 steppers),
    `symptom_input.js` ("My own case" default), `digit_canvas.js` (drawing strip: vector strokes,
    `groupStrokes` splits characters, `renderGlyph` re-renders each like its dataset at 4×, "Read as" switch; also `digitGridSvg`; one complete traced
    run per character: `/api/infer` returns run 1 + `char_runs`; `char_switch.js` chips pick the character
    every chapter shows, and `chapter_state.js` keeps per-character progress, proofs and deep-dive), `price_chart.js` (`priceChartSvg`: 20 real closes before a
    Price direction case + that day's range).
  - Layout: every `.scene` starts at `--nav-clear` (below the navbar). The overview fits one screen: only the
    panel's list (fields / symptom chips / chart) shrinks and scrolls.
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
  - Every matrix shares two modules:
    - `reveal_controller.js` (`createRevealController`: play / pause / step / restart / done, pace
      `window.gridSpeed`), drawn by `grid_controls.js`
    - `cell_formula.js` (formula popups fixed on `<body>`, never clipped; `attachFormulaHover`;
      `clearFormulaPops` on every step change)
  - Users: `poly_grid.js` (256-cell CKKS grids), `byte_matrix.js` (hex bytes and words; still returns a
    Promise), the Encryption slot grid, the deep-dive slot tables, the digit pixels, the U-chain and the
    symptom flags.
  - No native `title` tooltips except glossary terms; buttons use `aria-label`.
  - `pbkdf2_graph.js`: generic node graph. Several focus nodes; hover a box for its full value, an edge for
    what it does.
  - `split_view.js` (`subStep`): every step about a node of a chapter's graph is drawn split screen.
    - left: the node's content; right: the graph with that node highlighted
    - graphs: PBKDF2 (Key Setup 7 → 7.1–7.9), the CKKS pipeline (Encryption 2 → 2.1–2.7), AES-GCM counter
      mode (Transport 2 → 2.1–2.7)
    - steps marked `sub` are numbered by the graph (`scrubber.js stepNumbers`; the counter shows
      "Step 7.3 · 10/17")
  - The nested dolly zoom (`sub_zoom.js`) was removed. `escape_html.js`.
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
