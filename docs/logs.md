# Logs

## Phase 0 — Environment
- Ran `uv venv`
- Ran `uv pip install -r requirements.txt`
- Ran `uv run crypto/verify_tenseal.py` — verify TenSEAL encrypt→add→decrypt round-trip
  - Result: Original [1.0, 2.0, 3.0, 4.0] -> Decrypted [1.999999999704971, 3.999999999617939, 6.0000000019267, 8.00000000248559] (CKKS approximation, within tolerance) — PASS
- Phase 0 complete

## Phase 1 — Crypto Core
- Created crypto/ckks_context.py (create_context, save_context, load_context)
- Created crypto/keygen.py (generate_keys — secret + public context split)
- Created crypto/keys/.gitkeep
- Created crypto/encrypt.py (encrypt_vector, serialize_encrypted, encrypt_and_serialize)
- Created crypto/decrypt.py (deserialize_encrypted, decrypt_vector, deserialize_and_decrypt)
- Created crypto/transport.py (RSA keygen/save/load, AES-CBC wrap_payload/unwrap_payload hybrid scheme)
- Created tests/test_transport_roundtrip.py — CKKS encrypt -> RSA+AES wrap -> unwrap -> decrypt
- Renamed crypto/ -> hecrypto/ (avoided stdlib/package name collision); updated imports in keygen.py, test_transport_roundtrip.py, docs/rules.md
- Added hecrypto/__init__.py and tests/__init__.py (package recognition fix)
  - Result: Original [10.0, 20.0, 30.0] -> Decrypted [9.999999999506102, 20.00000000055316, 29.999999998438987] — PASS (ciphertext bytes preserved through RSA+AES transport)
- Phase 1 complete

## Phase 2 — Data Prep
- Created scripts/download.py (mnist via torchvision, sms_spam + german_credit + symptom_diagnosis via direct URLs, price_data via yfinance)
- Installed torchvision (was missing)
- Switched to uv project mode: ran `uv init`, `uv add tenseal cryptography scikit-learn torch pillow flask numpy yfinance torchvision` — generated pyproject.toml + uv.lock, reused existing .venv
- Removed requirements.txt (superseded by pyproject.toml)
- Added .env / .env.example / .gitignore entries for Kaggle credentials
- Added README.md (project info + first-time setup)
- Downloaded mnist, sms_spam, german_credit, symptom_diagnosis, price_data — PASS
- Attempted download_human_vs_ai_text() via kagglehub, failed (malformed CSV, encoding/tokenizing errors in source file). Reverted: removed kagglehub, python-dotenv from deps and download.py. human_vs_ai_text now manual download per README.
- Phase 2 complete (5/6 datasets scripted, 1 manual)
- Confirmed AI_Human.csv placed at data/raw/human_vs_ai_text/AI_Human.csv
- Fixed download_price_data(): yfinance multi-index columns flattened, Date reset to column
- Added idempotency checks (skip if already downloaded) to all download.py functions
- Confirmed human_vs_ai_text/AI_Human.csv placed correctly
- Created data/loaders/ (mnist, sms_spam, german_credit, symptom_diagnosis, price_data, human_vs_ai_text) — each exposes load() returning (X, y)
- Verified all loaders: mnist (60000,784), sms_spam (5572,), german_credit (1000,20), symptom_diagnosis (4920,132), price_data (1254,4), human_vs_ai_text (1000,) — PASS
- Phase 2 complete
- Created data/features/ (mnist.py: normalize/resize via Pillow, text_stylometric.py: 8 stylometric features) — verified: mnist (60000,784), text (100,8) — PASS

## Phase 3 — Model Training (plaintext baseline)
- Created models/train/ (sms_spam, german_credit, symptom_diagnosis, price_data, human_vs_ai_text logreg modules)
- Fixed german_credit loader: categorical column detection was matching dtype==object but pandas inferred mixed types differently, so raw string codes (e.g. 'A11') leaked into scaler. Fixed via regex match on 'A\d+' pattern.
- Results: sms_spam train=0.9796 test=0.9812 | german_credit train=0.7750 test=0.8000 | symptom_diagnosis train=1.0000 test=1.0000 | price_data train=0.7049 test=0.7211 | human_vs_ai_text train=0.9362 test=0.9333 — PASS
- Note: symptom_diagnosis 100% acc likely dataset is near-linearly-separable (132 binary symptom flags -> distinct diagnosis), not a bug
- Created models/train/mnist_cnn.py (SmallCNN: 2 conv + 2 pool + 2 fc layers) — 3 epochs, train_acc=0.9845 test_acc=0.9814 — PASS
- Phase 3 complete

## Phase 4 — HE Inference
- Created inference/he_infer.py (encrypted_linear_score: dot(x,w)+b via CKKS; sigmoid applied in plaintext post-decrypt, standard split-inference pattern)
- Created tests/test_he_inference.py — validates HE linear score vs sklearn decision_function per model
- Fixed multiclass handling (symptom_diagnosis has 41 classes, coef_ per class) vs binary models
- Results: sms_spam max_diff=0.000011 | german_credit max_diff=0.000004 | symptom_diagnosis max_diff=0.000001 | price_data max_diff=0.000001 | human_vs_ai_text max_diff=0.000003 — ALL PASS
- Created models/train/mnist_cnn_he.py (HECompatibleCNN: square activation replaces ReLU, avgpool replaces maxpool) — 5 epochs, lr=0.0005, train_acc=0.9874 test_acc=0.9853 — PASS (comparable/better than original CNN 0.9814)
- Created inference/he_cnn_infer.py: full encrypted CNN forward pass via TenSEAL im2col conv2d, square activation (native CKKS multiply), avgpool (plaintext post-decrypt per layer, leveled-HE round-trip pattern to avoid excessive multiplicative depth)
- Required poly_modulus_degree=32768 (16384 and 8192 insufficient — im2col-encoded 30x30 padded image didn't fit in single ciphertext, conv2d_im2col unsupported on chunked vectors)
- Fixed conv2d_im2col call: kernel must be passed as 2D matrix, not flattened list
- Created tests/test_he_cnn_inference.py — validated 3 samples: plain_pred vs he_pred exact match, 3/3 correct — ALL PASS
- Phase 4 complete

## Phase 6E — Real CKKS Deep-Dive
- Built crypto_teaching/real_ckks.py: real single-modulus CKKS (N=256) with canonical embedding encode/decode, real ternary keygen, real error polynomials, real negacyclic polynomial multiplication mod q, real encrypt/decrypt. TenSEAL hides all internals, so this is a parallel from-scratch implementation purely for transparency/visualization
- Verified round-trip: [0.5,-0.3,0.8,0.1] -> [0.4997,-0.3008,0.8006,0.1002], runtime 0.16s — PASS
- Added /api/ckks_deep_dive Flask endpoint, fixed float32->float JSON serialization bug
- Verified via PowerShell: 200 OK, full 256-length real coefficient arrays for encode/keygen/encrypt/decrypt returned

## Phase 6C — Interactive Live Pipeline Visualizer
- Created inference/pipeline_events.py (PipelineRecorder: emits ordered real event log, not simulated)
- Added run_full_traced_pipeline_with_events() to inference/he_infer.py: emits one real event per weight-multiply (all features, no batching/faking), plus encrypt/vectorized-HE-compute/transport/decrypt events
- Verified sms_spam sample: 507 total events (500 weight-multiplies + input/encrypt/compute/2x transport/decrypt), raw_score=-4.195070 vs plaintext_equivalent_score=-4.195059, scores_match=True — PASS
- Design decision: scrolling log-feed of real operation text lines (speed-slider controlled) instead of node-graph animation, per user preference
- Added /api/infer_text JSON endpoint to interface/app.py: accepts real user-typed text (human_vs_ai_text or sms_spam), runs live feature extraction + full traced HE pipeline, returns event list as JSON
- Verified via PowerShell Invoke-WebRequest: 200 OK, 8-dim stylometric features extracted from typed sentence, full event stream returned — PASS

## Phase 5 — Benchmarking
- Created benchmarks/metrics.py (time via time.perf_counter, memory via tracemalloc, plaintext vs HE per model, results saved to benchmarks/results.json)
- Results (5 samples each): sms_spam slowdown=54.2x | german_credit slowdown=201.7x | symptom_diagnosis slowdown=981.2x (41-class multiclass loop) | price_data slowdown=67.7x | human_vs_ai_text slowdown=11.6x — all plain_vs_he agreement=1.00
- Phase 5 complete (logreg models only; mnist_cnn_he benchmarking pending)

## Phase 6 — Interface
- Created interface/cli.py: menu-driven CLI, select dataset -> run plaintext vs HE inference on a sample, or view saved benchmark results
- Verified: sms_spam sample 0, true=0 plain=0 he=0 match=True — PASS
- Created interface/static/css/colors.css, fonts.css, components.css (global design tokens, strict modularity)
- Created interface/templates/components/ (dataset_selector.html, result_card.html, benchmark_table.html) — reusable Jinja partials
- Created interface/templates/index.html — composes components only
- Created interface/app.py — Flask routes only, imports inference logic, no inline styling/components
- User feedback: current UI only shows plain_pred vs he_pred numbers, reads as an ML comparison demo not a cryptography demo. Ciphertext/intermediate HE steps never surfaced. Decided to rebuild Phase 6 interface entirely as an educational, step-by-step pipeline visualization (Phase 6B added to checklist) — every stage (plaintext, keygen, encrypt, transport wrap, encrypted compute, decrypt, validation, benchmarks) shown, explained, and animated. GSAP chosen for animations.

## Phase 6B — Educational Pipeline Visualization
- Added run_traced_inference() to inference/he_infer.py: returns plaintext_input, ciphertext bytes + hex preview + size (both input and output), raw_score, sigmoid_score — full pipeline artifacts for UI display
- Added wrap_payload_traced() to hecrypto/transport.py: exposes AES ciphertext/key hex previews for transport-layer visualization
- Verified: sms_spam sample 0 -> input_dim=500, ciphertext_input_size=331643 bytes, ciphertext_output_size=235127 bytes, raw_score=-4.195, sigmoid=0.0148 — PASS
- Added run_full_traced_pipeline() to inference/he_infer.py: full chain CKKS encrypt -> RSA+AES wrap -> unwrap -> CKKS decrypt, with transport integrity checks and AES/RSA hex previews at each stage
- Verified: raw_score == final_decrypted_score (-4.195054772758502 both), input/output transport integrity_preserved=True — PASS

## Phase 6F — UX/Flow Overhaul
- scene_registry.js: reordered chapters to Overview -> Feature -> Key Setup -> Encryption -> CKKS Deep-Dive -> Computation -> Transport -> Decryption -> Result -> Benchmarks (was: deep-dive before key/encrypt); split buildRestOfScenes() into buildKeyEncryptScenes()/buildComputeThroughBenchmarkScenes(); updated timeline.js's chapter->minimap-stage map to match new numbering
- poly_grid.css: fixed .equation-phase clipping (min-width 180px, white-space normal, overflow visible) so KaTeX equations no longer get cut off
- scenes.html: added navbar "Restart animation" button (reuses existing visitedScenes skip-replay mechanism via visitedScenes.delete + goToSceneIndex); added accent-color olive theming + flex-wrap/media query to navbar for responsive overflow
- scene_renderers.js: renderComputeScene now reads window.gridRevealSpeed instead of its own local #speedSlider (single unified navbar speed control), and uses new .scene-body-full CSS class (scenes.css) for full-viewport width instead of a centered card
- scene_renderers.js/components.css: renderTransportScene now shows an animated packet traveling client->server->client (CSS keyframes, matches minimap's L-path convention) instead of static text only
- scene_renderers.js: renderResultScene now maps plain_pred/he_pred through a RESULT_LABELS table (sms_spam, human_vs_ai_text -- the only two models reachable from the live UI's model picker) to plain-language labels, plus a sentence explaining what "match" proves
- benchmark_table.html: added explanatory intro paragraph (what slowdown/agreement mean, why HE is slower)
- scene_renderers.js: added a second "why generated once, before data is touched" sentence to Key Setup, Secret Key, and Public Key scenes
- Checklist Phase 6D scene/mechanics checkboxes retroactively ticked (already implemented in scene_registry.js/timeline.js, just never marked); left "instant mode toggle" and "live running_sum chart" unchecked -- genuinely not built, out of Phase 6F's actual problem list, not silently added
- benchmarks/metrics.py: added _benchmark_mnist_cnn() (own CKKS context, poly_modulus_degree=32768, matching tests/test_he_cnn_inference.py's params -- the default linear-model context is too small for im2col-encoded convs), N_SAMPLES_CNN=3, appended to run_all()'s results list
- Verified: tests/test_transport_roundtrip.py, tests/test_he_inference.py (all 5 logreg models, max_diff <= 0.000014), tests/test_he_cnn_inference.py (3/3 samples exact match) all PASS after changes
- Ran benchmarks/metrics.py end-to-end: mnist_cnn_he plain=0.1286s he=466.2247s slowdown=3626.2x agreement=1.00 (3 samples) — results.json updated with 6 model entries total
- Frontend scene changes verified by code-reading only (no headless browser in this environment) — flagged to user for manual browser walkthrough

## Phase 6G — Snek-inspired chapter flowchart + scrubber redesign
- Inspiration ported 1:1 from C:\Users\ashvi\Documents\VS_Codes\HTML\Snek (Preact compiler visualizer):
  ZoomTransition.tsx (dolly-zoom), Scrubber.tsx/ExplanationGrid.tsx (play/pause/step + what/why/next strip,
  minus glossary-term-linking and the 4th "formal notation" cell -- not applicable to most Kryptamet steps),
  StepSlider.tsx (draggable track + chapter ticks), PhaseMinimap.tsx (chapter-dot pill). All re-authored in
  vanilla JS (Kryptamet has no frontend framework) as interface/static/js/{zoom_transition,step_slider,
  scrubber}.js + interface/static/css/scrubber.css
- inference/pipeline_events.py: PipelineRecorder.emit() gained why/next_step params
- inference/he_infer.py: every rec.emit() call in run_full_traced_pipeline_with_events() filled with real
  why/next_step text (load_plaintext, ckks_encrypt, weight_multiply, add_bias, ckks_vectorized_compute,
  passphrase_aes_wrap/rsa_aes_wrap, rsa_aes_unwrap, ckks_decrypt) -- new authored content, not ported
- interface/static/js/minimap.js: rewritten as a 9-dot chapter pill (Feature/Key/Encryption/Deep-Dive/
  Computation/Transport/Decryption/Result/Benchmarks), replacing the old L-path SVG + abstract stageMap
- interface/static/js/scene_registry.js + timeline.js: deleted, replaced by chapter_registry.js (CHAPTERS
  metadata array) + chapter_state.js (flowchart<->chapter zoom orchestration, step-index persistence,
  chapter-unlock gating)
- interface/static/js/scene_renderers.js: rewritten -- kept renderOverviewScene, replaced all per-scene
  innerHTML builders with buildXSteps(result) functions returning {what, why, next, renderVisual} per step;
  reused as-is: transport packet-travel CSS/animation, RESULT_LABELS plain-language mapping, benchmarks
  intro paragraph, key-scene why-text (all from Phase 6F)
- interface/static/js/smoke_feed.js + its CSS: deleted (Computation chapter now steps through real events
  one at a time via the scrubber instead of an auto-scrolling feed -- nothing scrolls past unseen anymore)
- interface/static/css/{minimap,timeline}.css: deleted (fully superseded, confirmed no remaining references)
- interface/templates/scenes.html: rewritten -- dropped top tick-row + edge-nav prev/next arrows, added
  #flowchartContainer + #scrubberDock + #backToFlowchartBtn
- Verified: uv run python -m tests.test_transport_roundtrip, test_he_inference -- both PASS unchanged
- Verified via a real running dev server (uv run python -m interface.app): all 8 new/changed JS files
  syntax-checked clean (node --check); every referenced static JS/CSS asset returns 200; POST
  /api/infer_text (sms_spam, real text) returns why + next_step populated on all 507 events, plain_pred/
  he_pred/match correct (1/1/True); POST /api/ckks_deep_dive returns real 256-coefficient arrays matching
  what buildDeepDiveSteps() expects; GET /live returns 200 with correct script/container markup present
- NOT verified: actual browser interaction (clicking a chapter box, watching the zoom animation, dragging
  the step slider, autoplay pacing) -- no browser available in this environment; flagged to user for a
  manual walkthrough before considering Phase 6G fully done

## Phase 6H — /live Snek-level polish (2026-09-29)
- Full detail: docs/LIVE_UI_POLISH.md. New: flowchart.js/css, speed_dial.js/css, intro_card.js/css, chapter_intros.js, glossary.js, escape_html.js, pipeline_api.js, navbar.css, overview.css, chapter_visuals.css, minimap.css. Rewritten: scrubber.js/css, step_slider.js, poly_grid.js/css, zoom_transition.js, chapter_state.js, chapter_registry.js, scene_renderers.js, minimap.js, scenes.html. app.py: CKKS_PARAMS + ckks_params/plaintext_equivalent_score/scores_match in response. Deleted benchmark_table.html, duplicate components.css half.
- Verified: headless Chrome walkthrough both models desktop+phone, 0 console errors; interaction assertions all pass; tests.test_transport_roundtrip PASS; test_he_inference not re-run (data/raw absent in worktree, he_infer.py unchanged)

## Phase 6I-0 — Hard replace of main dir with live-polish worktree (2026-09-30)
- User directive: no git by Claude (no commit/merge/PR); user commits "savepoint 3" as OrangeSorbet on top of "savepoint 2". Work continues directly in the main dir; plan in ~/.claude/plans/serene-dazzling-spindle.md, pending the user's go.
- robocopy .claude/worktrees/live-polish -> repo root, /E, excluding .git, .venv, .claude, .omc and __pycache__: 96 files copied. Deleted interface/templates/components/benchmark_table.html (removed in 6H). Kept gitignored data/raw.
- Verified: SHA-256 of all 96 files identical in both trees; no extra non-data files in main; tests.test_transport_roundtrip PASS from main.
- User added .claude/settings.json {"worktree": {"bgIsolation": "none"}} so Claude can edit the main dir directly.
- Session moved from the worktree back to the main dir. Deleted .claude/worktrees/live-polish (and the empty .claude/worktrees) with a plain file delete; it held only copies plus .venv/.git pointer/caches. Git's worktree entry and branch worktree-live-polish are left for the user (git worktree prune / git branch -D worktree-live-polish).
- .gitignore: added .claude/worktrees/, .claude/settings.local.json, .omc/ (Claude Code/plugin local state).

## Phase 7.0 — Checklist revamp (2026-09-30)
- docs/checklist.md rewritten: clean sequential phases 0–7 in Markdown. The 6D–6H history is collapsed into Phase 6. Dropped deviated/abandoned items: Tauri packaging, the instant-mode toggle, the running-sum chart, the old build-order line. Dead-code deletions were verified already done (no index.html/sections/pipeline_animations.js remain). New Phase 7 = the truthful /live plan milestones 7.1–7.9.

## Phase 7.1 — Tracers + asserts (2026-09-30)
- 4 parallel subagents, disjoint files; no git.
- NEW hecrypto/pbkdf2_trace.py:
  - `sha256_traced(message)`: pure-Python SHA-256; per block W[0..63] and a..h after each of 64 rounds.
  - `trace_pbkdf2(passphrase, salt, iterations=200_000, dklen=32)`: HMAC ipad/opad, U1 inner/outer digests, traced inner SHA-256 (2 blocks), U-chain samples (1–5, every 20 000th, last) with the XOR accumulator T.
  - Verified against hashlib.pbkdf2_hmac AND cryptography PBKDF2HMAC; raises RuntimeError on mismatch. 0.57 s at 200k iterations.
- NEW hecrypto/rsa_trace.py: `trace_rsa_keypair(private_key, label)` returns p, q, n, e, d, phi, lambda, CRT params (decimal strings) and the DER public key SHA-256. Checks n=p·q, gcd(e,λ)=1, e·d≡1 (mod λ) and the CRT params.
- NEW hecrypto/aes_trace.py:
  - Pure-Python AES-256 with the S-box computed from the GF(2^8) inverse and affine transform, the key expansion with derivation notes, and a traced block (4×4 state after SubBytes/ShiftRows/MixColumns/AddRoundKey for 14 rounds).
  - `trace_aes_cbc(key, iv, plaintext, n_blocks=3)`: PKCS7 plus the CBC chain; block 1 is fully traced. Asserts against cryptography ECB/CBC.
  - Test: FIPS-197 C.3 vector, including intermediate round states. Note: the brief mislabelled 4f63…e705 as round[1]; it is round[2].start.
- EDIT hecrypto/transport.py:
  - `derive_key_from_passphrase(passphrase, salt)`: salt is now required (the fixed "kryptamet-demo-salt" is removed). `wrap_with_passphrase` uses a random 16-byte salt returned in the dict.
  - `wrap_payload(..., aes_key=None)`. `wrap_payload_traced` adds full aes_key_hex/iv_hex/encrypted_aes_key_b64/aes_ciphertext_b64, SHA-256s and padding_len. Preview keys are kept until 7.2.
  - NEW `unwrap_payload_traced`. AES-CBC/PKCS7 is unchanged, factored into helpers with a ponytail note: no integrity tag.
- EDIT inference/he_infer.py (one caller): the passphrase fingerprint is now derived with wrapped["salt"].
- MOVED crypto_teaching/real_ckks.py -> hecrypto/ckks_math.py (crypto_teaching/ deleted; the rules.md #4 violation is fixed; "real" is dropped from the name):
  - Parameters: N=256, Q=2^60, Δ=2^25 (not 2^20: fresh noise·‖w‖ gave ~1e-2 error at 2^20).
  - Slots at ζ^(5^j). Added mul_plain, add_plain, apply_galois, BV key-switching (base 2^15, 4 digits) and rotate.
  - negacyclic_mul uses np.convolve on uint64; it is exact because Q divides 2^64.
  - `run_full_deep_dive(x, w, b)`: encode → keygen → encrypt (⌈d/128⌉ chunks) → ×w → chunk sum → 7 rotate-and-add rounds → +bias (Δ², every slot) → decrypt → decode. Old keys are kept.
  - Real models: human_vs_ai_text err ~6e-5, sms_spam err ~3e-4, ~20 ms.
  - Caveat: coefficients reach 2^59 > JS safe-int 2^53; strings/BigInt are needed in 7.5.
- EDIT interface/app.py: /api/ckks_deep_dive now uses the full real x, model.coef_[0] and intercept_ (it was x[:8]); 400 on empty text or an unknown model.
- NEW hecrypto/ckks_encode_trace.py: `trace_ckks_encryption(context, x, enc_vector=None)`.
  - FINDING: TenSEAL replicates x cyclically over all 4096 slots (CKKSVector::encrypt → pt.replicate), not zero-padding; verified by decrypting all slots.
  - m(X) is computed by Kryptamet (numpy FFT, slot j at ζ^(3^j)) and matches SEAL's CKKSEncoder output on 0/8192 differing coefficients, compared via Kryptamet's inverse NTT (itself checked against SEAL transform_from_ntt).
  - Primes are READ from tenseal.sealapi: q0=1152921504606748673, q1=1099510890497, q2=1099511480321, special=1152921504606830593.
  - The real c0/c1 coefficients are read from the ciphertext. Serialization: SEAL header magic 0xA15E, v4.3, compr_mode=zstd, ~331.6 KB vs 393,216 B uncompressed.
  - Full base64 plus SHA-256. Round-trip error ~5e-9; noise coefficients ~80–100. ~630 ms.
- NEW tests: test_pbkdf2_rsa_trace, test_aes_trace, test_ckks_math, test_ckks_encode_trace.
- Verified (all in main dir): the 4 new tests + test_transport_roundtrip + test_he_inference (5 models ALL PASS) → all PASS; `import interface.app` ok.

## Phase 7.2 — Two-party pipeline + model registry (2026-09-30)
- 2 parallel subagents (registry / pipeline) against a fixed contract; the parent wired app.py and the frontend. No git.
- NEW inference/model_registry.py: MODELS / get_model / public_models for 6 models.
  - Each entry: id, label, input_kind (text/tabular/symptoms/image), task, class_names (in classes_ order, verified per loader), weights() → (W k×d, b k), featurize(inp) → {x, feature_names, x_captions, feature_trace, input_echo}, plain_predict, plain_scores, and samples (lazy real test rows/examples).
  - Inputs are validated at the trust boundary (ValueError → HTTP 400).
- NEW featurizers data/features/{tfidf,tabular,symptoms}.py. Additions to text_stylometric.py and mnist.py; loader helpers in german_credit.py (load() output byte-identical), price_data.py and symptom_diagnosis.py; price_data_logreg.py uses price_data.direction.
- FIX text_stylometric.extract_traced: it now uses extract()'s exact values (avg_word_length previously differed).
- NEW models/train/mnist_logreg.py: multinomial LR, lbfgs, 200 iterations, 259 s; train 0.9385 / test 0.9267. Output: models/saved/mnist_logreg.pkl. Added to benchmarks/metrics.py.
- Ran `uv run python -m benchmarks.metrics` (full suite). New row: mnist_logreg slowdown 1198.4x, agreement 1.00. All 7 rows agree 1.00; mnist_cnn_he he=767 s for 3 samples.
- NEW inference/he_infer.py `run_two_party_pipeline(context, x, W, b, *, feature_names, x_captions, class_names, passphrase=None, ckks_params=None)`. It emits 18 party-tagged event types:
  - keys: ckks_keygen, rsa_keygen_server, rsa_keygen_client, passphrase, pbkdf2
  - encrypt: load_plaintext, ckks_encrypt
  - transport_out: leg1_wrap (the PBKDF2 key wraps Enc(x); the client's RSA key wraps that key), leg1_unwrap
  - compute: compute_overview, compute_general_form (the real Enc(x)·Wᵀ+b on a context rebuilt from public-only bytes, is_private False), weight_multiply (non-zero x_i only; captions + per-term rank-based why; labelled as the plaintext teaching mirror), zero_terms, add_bias
  - transport_back: leg2_session_key, leg2_wrap, leg2_unwrap
  - decrypt: ckks_decrypt (all k scores, argmax, sigmoid/softmax)
  - A random passphrase (secrets.token_urlsafe(12)) is used when none is given.
- NEW hecrypto/evaluate.py (encrypted_linear_scores via matmul). hecrypto/ckks_context.py: serialize_context, context_from_bytes, ckks_params_of. hecrypto/transport.py: new_aes_key, new_salt, new_passphrase. pipeline_events.emit gains `party`.
- REMOVED run_full_traced_pipeline_with_events (no callers) and an unused import in he_infer.py.
- REWROTE interface/app.py:
  - GET /api/models.
  - POST /api/infer, with /api/infer_text as an alias ({model, input} or legacy {model, text}); the response keeps the old keys and adds class_names, task, x, x_captions, scores, probabilities, passphrase, and more.
  - /api/ckks_deep_dive works for any model (multiclass → the plaintext-predicted row).
- Frontend compatibility (scene_renderers.js, chapter_registry.js, components.css):
  - class names come from the response.
  - inputVector reads result.x.
  - The key step shows the real passphrase, salt and PBKDF2 key.
  - Encryption/compute/transport show the FULL base64 ciphertext with SHA-256; .ciphertext-box is 10 lines and scrollable.
  - The transport chapter covers leg 1 + the leg-2 key + leg 2.
  - Decryption handles multiclass (softmax top 5).
  - The TF-IDF bars view is kept for vectors with more than 64 dimensions.
- Verified:
  - All 8 test files PASS (model_registry, two_party_pipeline, ckks_encode_trace, pbkdf2_rsa_trace, aes_trace, ckks_math, transport_roundtrip, he_inference).
  - Flask test_client: all 6 models via /api/infer, plain == HE prediction, scores_match, 1.6–1.9 MB, 6.6–10.9 s; deep-dive score ≈ plaintext for each; legacy /api/infer_text and 400s OK.
  - Headless Chrome: full walkthrough for sms_spam + human_vs_ai_text with no console errors; interaction checks ALL PASS. SMS Computation went from 502 to 18 steps.

## Phase 7.3 — AES-GCM, Key Setup chapter, Transport chapters, README (2026-09-30)
- WHY GCM: AES-CBC hid bytes but could not detect tampering. The user's goal is that the HE ciphertext can't be meddled with in transit.
- hecrypto/transport.py switched to AES-256-GCM:
  - 12-byte random nonce, 16-byte tag stored separately, AAD header. Wrapped dict: {encrypted_key, nonce, ciphertext, tag, aad}.
  - Removed iv/padding/*_hex_preview keys. Added nonce_hex, tag_hex, aad_hex, aad_utf8, tag_size, nonce_size.
  - InvalidTag propagates. wrap_with_passphrase is also GCM.
  - NEW tamper_test(key_or_private_key, wrapped): flips a random ciphertext bit and a tag bit on copies; both must be rejected, otherwise RuntimeError.
- hecrypto/aes_trace.py: trace_aes_gcm replaces the CBC trace. H, J0, counters, keystream (block 1 fully round-traced), and GHASH over the FULL ciphertext using 16×256 tables (~33 ms for 21k multiplications), cross-checked with the bitwise gf128_mul. The tag is asserted == cryptography.
- he_infer: both legs use GCM with headers "kryptamet|leg1|server->client" / "kryptamet|leg2|client->server"; unwrap events carry a real tamper_test on the wire payload. Pipeline time unchanged (~9 s).
- Tests: test_aes_trace adds McGrew-Viega GCM cases 13–16 (AES-256, case 16 with AAD). test_pbkdf2_rsa_trace, test_transport_roundtrip and test_two_party_pipeline updated → all PASS (re-verified by the parent). test_he_cnn_inference was not run to completion by the subagent (>10 min, independent of transport).
- Key Setup chapter rebuilt (subagent): 17 real steps.
  - NEW js/key_setup_steps.js (buildKeySteps moved out of scene_renderers.js) + css/key_setup.css.
  - NEW generic components: js/byte_matrix.js, js/pbkdf2_graph.js (a generic node graph), js/sub_zoom.js (nested dolly zoom via zoomUnits), js/sha256_check.js (browser recomputation of a SHA-256 block), each with its own CSS.
  - Browser checks: RSA (Fermat test, n=p·q, lcm/gcd, e·d mod λ, CRT), ipad/opad bytes, SHA-256 schedule + 64 rounds, WebCrypto PBKDF2 re-derivation. "Use random passphrase" (#randomKeyBtn) sits beside "Lock with my passphrase".
  - chapter_state.onPassphraseRelock lands on the passphrase step.
  - Glossary and intro updated. scrubber.css gets overflow-wrap:anywhere.
  - Verified in headless Chrome for both text models, desktop + phone, no console errors; interaction checks pass (Key Setup step count 17).
- README.md rewritten: purpose, clinic use case, the 10-step two-party flow, features, setup and run. No folder structure. It describes the Phase 7 target; claims are re-checked in 7.8.
- Transport split into two chapters (7.3 finished, 2026-09-30). The flowchart now has 10 chapters: Feature, Key Setup, Encryption, CKKS Deep-Dive, **Transport → client**, Computation, **Transport ← server**, Decryption, Result, Benchmarks.
  - NEW js/transport_steps.js: shared `buildTransportSteps(result, leg)`, 14 real steps per leg:
    1. why two layers (nested RSA/GCM/CKKS diagram)
    2. AES key (leg 1 == Key Setup PBKDF2 key; leg 2 fresh, ≠ leg-1 key)
    3. key schedule (60 words / 15 round keys)
    4. nonce, J₀, counters
    5. counter-mode node graph
    6. nested dolly zoom into the AES_K node (state matrix, K₀)
    7. 14-round player (SubBytes/ShiftRows/MixColumns/AddRoundKey 4×4 matrices with KaTeX per cell)
    8. S-box
    9. P ⊕ keystream = C
    10. GHASH + tag
    11. RSA-OAEP envelope opened
    12. packet on the wire + full ciphertext
    13. unwrap
    14. tamper test with the flipped bits shown
  - NEW js/aes_check.js does the browser re-computation:
    - S-box from GF(2⁸) inverse + affine; key expansion; every stage of all 14 rounds from the browser's own state; counters/keystreams/XOR for blocks 1–3; H and AES_K(J₀)
    - each shown GHASH step with a BigInt GF(2¹²⁸) multiply; the length block and the tag
    - RSA-OAEP: c^d mod n (BigInt) + MGF1-SHA256 unmasking (lHash, zero padding, 01 separator, key)
    - WebCrypto: JWK import of the recipient private key, RSA-OAEP decrypt, AES-GCM decrypt of the FULL wire payload, SHA-256 == the ciphertext from the Encryption/Computation chapter, and the server's exact ciphertext/tag bit flips replayed (both rejected)
  - NEW css/transport.css. The .transport-track/.transport-packet rules moved out of components.css; the endpoint labels now sit under the wire.
  - Removed the old single-chapter transport builder from scene_renderers.js.
  - chapter_registry: transport_out / transport_back with summaries "AES-256-GCM · size · tag ✓ · tamper rejected".
  - chapter_intros: transport_out / transport_back.
  - glossary: GCM, nonce, keystream, GHASH, tag, OAEP, S-box, round key, AAD.
  - scenes.html loads aes_check.js and transport_steps.js.
  - Also fixed: the Feature Extraction summary said "500 stylometric features" for SMS; it is now "500-dim TF-IDF vector".
- Verified:
  - Node run of aes_check.js on a real saved response: every flag true for both legs (OAEP decode ~20 ms; WebCrypto unwrap of 331 KB ~40 ms; both flips rejected).
  - Headless Chrome (sms_spam, 1440×900): 10 boxes in the right order, both chapters 14 steps, every browser check resolved ✓ and none ✕ (first visit and revisit), no overflow, no console errors.
  - Phone 390×844 (human_vs_ai_text): the same, clean.
  - New interaction script: flowchart order, intros for both chapters, minimap jump to Result (nth=8), deep-dive at nth=3: ALL PASS.
  - Backend unchanged in this step, so the Python tests were not re-run (they passed after the GCM switch).

## Phase 7.4 — Encryption chapter, 10 browser-verified steps (2026-10-01)
- Files:
  - NEW interface/static/js/encrypt_check.js: browser re-checks of event ckks_encrypt
    - packing rule (slot[j] = x[j mod d], copies, first 16 slots)
    - Δ-rounding (round-half-even, like Python)
    - re-embedding: m(X) (all 8192 coefficients) evaluated at all 4096 SEAL slot roots ζ^(3^j mod 2N), divided by Δ, must give x back (memoized, ~110 ms; max error 9.2e-11 on the SMS sample)
    - every prime: deterministic Miller–Rabin, q ≡ 1 mod 2N, bit size; RNS residues with BigInt
    - TenSEAL protobuf + SEAL header parse: field 1 = vector size d, field 2 = SEAL blob (magic 0xA15E, header size, version, compr mode zstd, size), zstd frame magic, field 3 = scale 2^40 as float64 in the last 9 bytes
    - WebCrypto SHA-256 of the full ciphertext; round-trip noise
  - NEW interface/static/js/encryption_steps.js (replaces the old 2-step builder in scene_renderers.js):
    1. plaintext input
    2. pipeline node graph
    3. 4096-slot packing grid (sparse x: non-zero slots lit; dense x: copy 1 lit)
    4. Δ-scaling table
    5. σ⁻¹: m(X) byte matrix + full 8192-coefficient list + server and browser re-embedding checks
    6. RNS prime cards + residue table
    7. encryption equation + c0/c1 coefficients (u, e not exposed by TenSEAL; points to the Deep-Dive)
    8. serialization header bytes, parsed
    9. full ciphertext + browser SHA-256 == leg-1 payload_sha256
    10. decryption round trip
  - NEW interface/static/css/encryption.css (slot grid height-capped by vh, phone query).
  - byte_matrix.css: .byte-matrix font-size 11.5px so ch-based column minimums match the cells (fixed a clipped 8th column).
  - scenes.html loads encryption.css, encrypt_check.js, encryption_steps.js; chapter_intros encrypt gained "What you will see"; glossary: RNS, Ring-LWE, Miller–Rabin, zstd.
- Verified:
  - Node run of encrypt_check.js on the saved real SMS response: every flag true.
  - Headless Chrome (tmp/enc74.py) sms_spam 1440×900, first visit + revisit: 10 steps, every check ✓, none ✕/unresolved, no overflow, no console errors.
  - Phone 390×844 (human_vs_ai_text): the same, clean; slot grid and legend fit above the dock.
  - Key Setup regression after the byte_matrix change: all WebCrypto checks ✓, 17 steps, clean.
  - Backend unchanged, so Python tests were not re-run.

## Phase 7.5 — CKKS deep-dive: evaluation, BigInt checks, grid controls (2026-10-01)
- Backend (`hecrypto/ckks_math.py`, `run_full_deep_dive`):
  - every polynomial is sent as decimal strings (centered values reach 2^59, past JS's 2^53); Q as a string
  - the chunk shown is the one with the most non-zero x values (`params.shown_chunk`; SMS no longer shows an all-zero chunk)
  - new: `evaluate.bias_pt`, `galois` per rotation, `params.digits`; `decrypt.recovered_vector` now has all 128 slots
  - `tests/test_ckks_math.py` updated (128 recovered slots, string coefficients). Run `uv run python -m tests.test_ckks_math`: all PASS (score errors 5e-6–8e-5, 11–26 ms).
  - `ckks_encode_trace.py` note: "Real CKKS rounds..." → "CKKS itself rounds...".
- Frontend:
  - NEW js/deep_dive_check.js: BigInt negacyclic products mod 2^60 and decoding at the slot roots ζ^(5^j). Checks:
    - b ≡ −a·s + e, c0 ≡ b·u + e1 + m, c1 ≡ a·u + e2, c·ŵ (both halves), c0 + β with c1 unchanged, m′ ≡ c0 + c1·s: all exact
    - encode(x), encode(w) and the fresh decrypt = x
    - the decrypted slots after the multiply, the chunk sum and every rotation = sums the browser computes from x and w
    - each Galois element = 5^k mod 2N
    - final score = the server's decode ≈ plaintext ≈ TenSEAL
  - NEW js/deep_dive_steps.js (old builder removed from scene_renderers.js): 18 steps (17 for a one-chunk x)
    - encode x, s, public key, c0, c1 (+ fresh decrypt), encode w, × ŵ, chunk sum, 7 rotation steps, + bias, decrypt, decode
    - slot tables put non-zero inputs first and name the feature in each slot
    - titles "CKKS · …" ("Real CKKS" removed)
  - poly_grid.js returns a controller {play, pause, stepCell, restart, done, onChange}
    - cells show a 2-significant-digit short form; the title and readout show the exact BigInt string
  - NEW js/grid_controls.js + css/grid_controls.css: per-grid ▶/❚❚, ‹ › cell, ↺, own speed dial
  - speed_dial.js takes {key, storage, label}. The Scrubber speed is window.stepSpeed (kryptamet.speed); grids use window.gridSpeed (kryptamet.gridSpeed). byte_matrix/key_setup_steps/pbkdf2_graph/scrubber read stepSpeed.
  - scrubber.js: Space on a focused grid button no longer toggles step playback; arrows still step.
  - CSS:
    - .recover-table flex-shrink: 0 (it was squashed to 0 px in the scene's flex column)
    - .grid-pair stacks vertically (side by side, 16 columns were too narrow for "-1.6e17")
    - phone poly grid scrolls at 800 px
  - chapter_registry: deep-dive gets (deepDive, result); summary "N=256 · encrypted w·x+b · off by …"
  - chapter_intros deepdive rewritten; glossary: rotation, key switching
  - scenes.html loads grid_controls.css/js, deep_dive_check.js, deep_dive_steps.js
  - CLAUDE.md: deep-dive path → hecrypto/ckks_math.py (ARCHITECTURE.md left for 7.8)
- Verified:
  - Node run of deep_dive_check.js on saved real responses (SMS 4 chunks, Human vs AI 1 chunk): every exact check true, slot errors ≤ 8e-4, browser score = server score to 1e-15, ~5 ms per product.
  - Headless Chrome (tmp/dd75.py), sms_spam 1440×900, first visit + revisit: 18 steps, every check ✓, no squashed tables, no clipped cells, no overflow, no console errors.
  - Grid controls: pause holds, ‹ › step cells, Scrubber step unchanged by Space on a grid button, restart replays to 256/256, c0 readout shows the exact 18-digit value.
  - Phone 390×844 (human_vs_ai_text): 17 steps, clean.
  - Regressions after the speed split: keysetup, transport73, enc74, interact73: all clean.

## Phase 7.6 — Computation chapter: largest terms first, captions, waterfall, browser checks (2026-10-01)
- Backend (`inference/he_infer.py`):
  - non-zero terms are ordered by |w·x|, largest first
  - `TERM_STEPS = 20` get one `weight_multiply` event each (with captions); the rest go into one new `smaller_terms` event carrying every (index, name, weight, input, product), its sum and the running sum
  - `next_step` texts follow the new order
  - `tests/test_two_party_pipeline.py`: the expected op order includes `smaller_terms` when there are more than 20 terms; terms must be descending by |w·x|; new dense symptom_diagnosis case (132 non-zero → 20 + 1)
  - Run `uv run python -m tests.test_two_party_pipeline`: ALL PASS (sms 13 terms, human 8, symptom 4, symptom dense 132).
- Frontend:
  - NEW js/computation_steps.js (buildComputationSteps/Bands moved out of scene_renderers.js):
    - overview: what the client has and never has, the decision rule
    - the real encrypted op: input SHA = the leg-1 unwrap = the Encryption ciphertext; is_private false; the browser's WebCrypto SHA-256 of the FULL output ciphertext = the reported hash = the leg-2 payload; full ciphertext box
    - each term: w × x = w·x as big values with faded `.value-caption` meanings under each; browser checks x[i] = the encrypted value and recomputes the product and running sum
    - smaller terms: scrollable table; browser re-sums them
    - zero terms: the browser counts the zeros in the encrypted x; the heaviest weights × 0
    - bias: the browser adds the bias = the plaintext model's score ≈ the decrypted HE score
    - a waterfall SVG (current row highlighted, later rows faded) on every term step; drawn at the scene's real width so its text stays readable on phones
  - NEW css/computation.css; chapter_registry summary uses load_plaintext nonzero_count; scenes.html loads both.
- Verified:
  - Headless Chrome (tmp/cmp76.py), sms_spam 1440×900 with a long 30-word message: 25 steps (overview, op, 20 terms, 10 smaller terms, zeros, bias), every check ✓ on first visit and revisit, no squashed blocks, no overflow, no console errors.
  - Phone 390×844 (human_vs_ai_text): 12 steps, clean; the term card stacks vertically, the waterfall text is readable.
  - interact73 regression: ALL PASS.

## Phase 7.7 — Inline styles, Next → next chapter, proof badges, all six models (2026-10-01)
- Inline styles (rules.md #2):
  - scenes.html `style="display:none"` → `hidden`; components.css `[hidden] { display: none !important; }`
  - zoom_transition/chapter_state/step_slider toggle `.hidden`
  - flowchart box/connector geometry and TF-IDF bar widths are applied by JS after render (data-geo / data-w)
  - centred paragraphs use `.step-text.centered`
  - CSS now gives the minimap (flex), chrome buttons (flex) and navbar buttons (inline-flex) the display that JS used to set inline (found by screenshot: the minimap had stacked vertically)
- Next → next chapter:
  - scrubber.js: `onEnd` / `nextLabel`; on the last step Next (button or →) is highlighted (`.scrubber-next-chapter`) and calls onEnd
  - autoplay now waits on the current step's animation (`settledNow`) instead of `scheduleNext(undefined)`
  - chapter_state.js: `goToNextChapter` zooms out to the flowchart, then into the next enabled chapter's box; `exitToFlowchart(originEl, then)`
- Proof badges:
  - chapter_state.js tallies the ✓/✕ `.ks-check` chips per chapter/step: when a step's animation settles, when leaving a step, before a minimap jump or re-lock, on exit
  - flowchart.js shows "✓ N browser checks" or "✕ k of N failed" on each visited box; reset per run
- All six models in /live:
  - NEW js/overview_form.js (moved out of scene_renderers.js): model list from GET /api/models, input help, one panel per input kind
  - NEW js/text_input.js, js/tabular_input.js (real test rows + editable numeric/A-code fields), js/symptom_input.js (132 filterable toggle chips + real test cases), js/digit_canvas.js (28×28 soft-brush canvas, real MNIST test images, `digitGridSvg`)
  - NEW css/tabular_input.css, css/symptom_input.css, css/digit_canvas.css; overview.css help/panel rules
  - pipeline_api.js:
    - `runPipeline(model, input, passphrase)` → POST /api/infer {model, input}
    - `fetchCkksDeepDive(model, input)`
    - `fetchModels()`
    - `inputSummary()` for the navbar
  - chapter_state.js and key_setup_steps.js (re-lock) pass `result.input`
  - Feature chapter:
    - tabular traces with one-hot list values ("k columns"); formulas z = (v − μ)/σ; assemble formula uses the real dimension
    - symptoms: all 132 flags with yours lit
    - MNIST: your 784 pixels, then scaled, with a browser check x_i = float32(pixel/255) exactly. The first run failed this check: the featurizer divides in float32 like training, and the check had compared with float64. Fixed with Math.fround.
  - registry summary and intro text cover all input kinds; "Your text was classified" → "Your input was classified"
- Verified:
  - `uv run python -m tests.test_model_registry`: ALL PASS.
  - Headless Chrome (tmp/all77.py), 1440×900, all six models one after another, each run from its own panel (MNIST from a stroke drawn with the mouse). Every step of all 10 chapters was visited, moving between chapters only with Next; Next chained all 10 every time.
  - Proof badges after each run, 0 failed: sms 138, human 123, german 149, price 115, symptom 116, mnist 151 checks ✓. No overflow, no console errors.
  - Phone 390 px (tmp/panels77.py): every panel without overflow; the symptom filter and toggle work.
  - Regressions: interact73 ALL PASS; keysetup (incl. the random-passphrase re-lock) clean.

## Phase 8 gate (2026-10-01)
- User directive: Phase 8 must not start on a bare "go"; it needs the second PC's real config first (GPU, driver/CUDA, OS, Python, RAM). Recorded in docs/checklist.md (Phase 8 "Gate" line) and in Claude's project memory.

## Phase 7.8 — Docs (2026-10-01)
- NEW docs/LIVE_UI_TRUTH.md: the two-party flow, where every /live value comes from (events, tracers asserted against the libraries, deep-dive), a per-chapter table of every browser check, how proof badges count, and the honest limits (one process, plaintext mirror, TenSEAL hides u/e, toy deep-dive parameters, WebCrypto needs a secure context, no live CNN at ~256 s per image).
- docs/ARCHITECTURE.md rewritten for the current code. The old version described AES-CBC, crypto_teaching/, /api/infer_text with text only, 9 chapters, gridRevealSpeed and old index.html routes. The new one covers the hecrypto tracers, the registry, the two-party events, all routes, every /live JS file by role, CSS rules, benchmarks and tests. This closes the 6.5 file-list item.
- CLAUDE.md: pointer to LIVE_UI_TRUTH.md; the stage order now follows the two-party flow.
- README claims re-checked against the app:
  - "Benchmarks: … time, memory and agreement" was false (no memory column) → scene_renderers Benchmarks table and step text now show plaintext/HE peak memory from results.json
  - the "Proof" paragraph now mentions the AES-GCM/OAEP/CKKS/deep-dive checks and the badges
  - every other claim holds
- Cleanup found while documenting:
  - removed `run_traced_inference` and `run_full_traced_pipeline` from inference/he_infer.py (no callers since 7.2) and the then-unused `unwrap_payload` import
  - hecrypto/keygen.py demo path `crypto/keys` → `hecrypto/keys`
- Verified:
  - `uv run python -m tests.test_he_inference`: ALL PASS; `tests.test_two_party_pipeline`: ALL PASS
  - headless Chrome Benchmarks chapter: 8 columns (memory included), real values, no console errors

## Phase 7.9 — Full verification; Phase 7 complete (2026-10-01)
- Python: all 9 test files run as `uv run python -m tests.<name>`, every one rc=0:
  - test_transport_roundtrip 1 s
  - test_pbkdf2_rsa_trace 1 s
  - test_aes_trace 1 s (FIPS-197 and McGrew-Viega vectors)
  - test_ckks_encode_trace 6 s
  - test_ckks_math 5 s
  - test_model_registry 4 s
  - test_two_party_pipeline 19 s
  - test_he_inference 14 s
  - test_he_cnn_inference 352 s (plain 3/3, HE 3/3)
- Headless Chrome (tmp/all77.py all; PHONE=1 for 390×844), for each of the 6 models (sms_spam, human_vs_ai_text, german_credit, price_data, symptom_diagnosis, mnist_logreg drawn with the mouse):
  - run from its own input panel
  - every step of all 10 chapters visited, chapters reached only through Next on the last step
  - proof badges read from the flowchart
  - Desktop 1440×900: badges sms 138, human 123, german 149, price 115, symptom 116, mnist 151 = 792 checks ✓, 0 failed; no overflow, no console errors.
  - Phone 390×844: identical counts, 0 failed, no overflow, no console errors.
- Phase 7 is complete. Phase 8 (GPU encrypted CNN) is gated on the user sending the second PC's config.

## [Phase 7 polish] 2026-10-03 — styled dropdown, scrollbar, content fills big screens
- User asked: native dropdown → styled, styled scrollbar, and less empty space (content ~50% of the screen; target 15–20% margin).
- `css/components.css`:
  - `.dropdown` uses `appearance: none` with an SVG chevron and hover border.
  - Under `@supports (appearance: base-select)` (Chrome 135+; checked on Chrome 154) the open list is themed too: `::picker(select)` surface, olive hover/checked, gold ✓.
  - Themed thin scrollbars (`::-webkit-scrollbar*`; `scrollbar-color` fallback for Firefox).
- `overview.css` / `tabular_input.css`: dropdown right padding so text clears the arrow.
- New `js/scene_fit.js` (`fitSceneContent`): after every step render, and again once it settles, scales the step's content via `--fit` → `zoom` on `#sceneContent.chapter-scene > *`.
  - Target is 90% of the free height, cap 1.6×, scale-up only.
  - Measured with layout offsets, so it is safe mid dolly-zoom.
  - It backs off if anything overflows, and refits on resize.
  - Hooked in `chapter_state.js` `onStepChange`; script tag in `scenes.html`.
- `flowchart.js` `fit`: the chart now scales to 90% of the pane, up to 1.7× (was capped at 1×).
- Wide screens (≥1500×820): `.scrubber-dock` zoom 1.15 (chapter padding adjusted), `.overview` zoom 1.2. `step_slider.js` tooltip x is mapped through the dock zoom.
- Checked at 1880×920 (tmp/shots10.py, tmp/pick10.py): flowchart fills the pane; short steps (Key Setup bytes) scale ~1.6×; tall steps (Computation waterfall, Deep-Dive grid) stay at ~1× because they are height-bound; no console errors.

## [Phase 7 polish] 2026-10-03 — input panels: German guide, own symptom case, MNIST framing, arrows, steppers
- German Credit:
  - `data/loaders/german_credit.py`: `FIELD_DOCS` + `CODE_MEANINGS`, from UCI Statlog german.doc.
  - `inference/model_registry.py`: fields carry `doc` + `meanings`, codes sorted numerically; longer input_help and note.
  - `tabular_input.js`: options read "A11 · < 0 DM", each field shows its description (+ training range).
- Number fields: native spin buttons hidden. Custom ▲▼ chevron steppers (±1) in `tabular_input.js` / `tabular_input.css`.
- Dropdown arrow moved to the far left in every dropdown. `components.css`: `::picker-icon { order: -1 }`; fallback background chevron on the left; `--dd-arrow-pad` for padding.
- Symptoms (`symptom_input.js`):
  - Case picker gains "My own case" (the default, starting empty).
  - Toggling a chip switches back to it.
  - New "Your symptoms" row of removable pills.
- MNIST — finding (500 real test digits redrawn): the logreg scores 12% drawn big, 7% small in a corner, 20% off-centre. It predicted mostly "3" or "7" no matter the digit.
  - New `mnistFrame` in `digit_canvas.js` (bbox → fit 20×20 bilinear → centre of mass to (14,14)) brings these to 93% / 89% / 93% (originals unchanged at 93%). Checked in Chrome (tmp/mnist_js.py).
  - It is applied on run to hand drawings only; the canvas is redrawn with the framed pixels. A small "7" drawn in the top-left corner now gives 7 (encrypted result matches plaintext).
- Docs: LIVE_UI_TRUTH.md limits section (re-framing, code-meaning source).

## [Phase 7 polish] 2026-10-03 — navbar clearance, one-screen overview, price chart, case labels
- Navbar overlap fixed at the root: `navbar.css` defines `--nav-clear` (76px; 60px on phones), and `.scene` uses `top: var(--nav-clear)`, so content and its scroll start below the bar. Scene paddings were reduced by the same amount (scenes, flowchart, chapter, phone, wide).
- The overview fits one screen (`overview.css`):
  - The overview is capped at the scene height.
  - Only the panel's list (`.tab-grid`, `.sym-chips`, `.tab-chart`) shrinks and scrolls; eyebrow line removed.
  - Overview zoom is 1.1 below 1000px of height (1.2 above).
  - Phones drop the lede; the digit canvas is `min(280px, 34vh)` (`28vh` on phones).
- The open dropdown list gets the themed thin scrollbar (`scrollbar-color` on `::picker(select)`).
- German Credit: the note was folded into a shorter input_help.
- Price direction:
  - `price_data.load_frame()`; registry `_price` returns closes + dates.
  - Each sample case carries `history` (20 previous real closes, dates, the day's real close).
  - New `js/price_chart.js` + `css/price_chart.css`: a line of those closes, the day's Low–High bar + Open tick from the fields (redrawn on edit), and the real close dot (green above / red not above the prev close; labelled "not a model input").
- Pickers read "case N" (Price shows the date), not "row N".
- Checked (tmp/fit12.py), 6 models × 1880×920, 1440×900, 1366×768, 390×844: 24/24 OK, meaning no scene scroll, scene top ≥ navbar bottom, panel never overlaps the run button, no page errors.

## [Phase 7 polish] 2026-10-03 — multi-character handwriting, EMNIST digits + letters
- Data:
  - `scripts/download.py` `download_emnist()` (idempotent) fetches NIST's official `gzip.zip` (562 MB) with a User-Agent header (NIST returns 403 to urllib's default) and keeps only the balanced split's 5 files in `data/raw/emnist/`.
  - New `data/loaders/emnist.py` (transposes EMNIST back to MNIST orientation; `class_names()` from the mapping file).
  - Measured on 3,000 test images: EMNIST characters fit a 24px box and are centred by bounding box (centre std 0.2px vs 1.3px for centre of mass); MNIST digits fit 20px and are centred by mass.
- Model: new `models/train/emnist_logreg.py` (47 classes, 112,800 training images, LogisticRegression max_iter=300) gives train 0.7336, test 0.6882, 531 s; sklearn reports it not fully converged. Saved to `models/saved/emnist_logreg.pkl`.
- Benchmarks: `benchmarks/metrics.py` gained an emnist_logreg row and `python -m benchmarks.metrics <model>` to re-measure one row. emnist_logreg: 5 samples, plaintext 0.027 s vs HE 10.5 s (390×), agreement 1.00.
- Registry:
  - Image input `{"images": [784 ints, ...]}` (1..`MAX_CHARS`=8; `{"pixels"}` still accepted).
  - `_image_featurize` features character 1 fully, plus `extra_x` for the rest.
  - Sample words are made of real test images (`_word_samples`): MNIST "0", "123"; EMNIST "0", "123", "abcd", "hello". Merged letters use their capital's class.
  - Per-model `framing` (MNIST box 20 / mass; EMNIST box 24 / box).
  - New `emnist_logreg` entry; merged help text.
- Pipeline:
  - `run_two_party_pipeline(..., extra_xs=)`: after character 1's traced run, every other character takes the same real path with the same keys, untraced (encrypt, wrap for the client, unwrap + compute on the public-only context, wrap back with a fresh AES key, unwrap + decrypt).
  - The result gains `characters`; `/api/infer` returns them with labels and a match flag.
- Frontend:
  - `digit_canvas.js` rewritten: a drawing strip as wide as the panel, empty at first. `segmentStrip` splits at empty columns and `frameGlyph` frames each piece with the model's framing. A "sends" row shows the exact images; sample words sit in one row under the strip and are sent untouched.
  - Feature chapter: character 1 of n.
  - Result chapter: new first step "Your drawing reads …", one card per character (decrypted vs plaintext, Δ, which one is traced).
  - Flowchart summaries and navbar summary updated.
- Tests:
  - `test_model_registry`: EMNIST mapping order, sample words are real test images of the right classes, invalid image lists rejected. ALL PASS.
  - `test_two_party_pipeline`: "hello" reads "heLLO" (l/L, o/O merged), all 5 match plaintext, extra characters ~1.2 s each. ALL PASS.
- Browser (tmp/hello13.py, fit12.py):
  - EMNIST "hello" sample end to end gives "heLLO", 5/5 match.
  - A hand-drawn "1" and "7" on the MNIST strip read "17", matching.
  - Fit check 28/28 (7 models × 4 sizes), no page errors.

## [Phase 7 polish] 2026-10-03 — drawing accuracy: vector strokes, calibrated rendering, "Read as" switch
- User drew "01ab", which read "DLQb". Diagnosis on 18,800 real EMNIST test images:
  - The model itself gets 0 right 67% of the time (mistakes O 88, D 13), 1 59% (I 75, L 63), a 60% (Q, 2, G), b 81%.
  - My old pixel-brush framing cost 5 points on real images and fell to ~40% on thin strokes.
- `digit_canvas.js` rewritten around vector strokes:
  - Strokes with overlapping x-extents form one character (`groupStrokes`; an i-dot joins its stem).
  - `renderGlyph` re-renders each character at 4× (112×112): pen = share of the box, one blur pass, exact 4×4 average down to 28×28, peak stretched to 255, MNIST centre-of-mass shift.
  - Drawing after loading a sample starts a fresh strip.
- Calibration (tmp/glyph_cal.py):
  - 600 real test characters → skeleton of a 4× upscale (scikit-image, temp script only) → rendered by the browser's `renderGlyph`; best (pen, blur) on that half, reported on 600 held-out.
  - MNIST: pen 0.10, blur 0.3 → 0.955 (real images 0.940).
  - EMNIST: pen 0.12, blur 0 → 0.577 (real 0.703).
  - Stored in the registry `*_FRAMING`.
- "Read as" (EMNIST): digits + letters / digits / letters.
  - Registry `charset` → `allowed` class indices.
  - `run_two_party_pipeline(allowed=)`: all k scores are still computed and decrypted; argmax and softmax run over the allowed classes, server-side after decryption.
  - `app.py` `_plain_pred` and the deep-dive row use the same rule.
  - Effect on the real test set: 0 and 1 go from 67% / 59% to 97% read as digits.
- Result steps 2–3 show the label (and "class #k") for multiclass models and say "Character 1" for multi-character drawings.
- Tests: `test_model_registry` (bad charset rejected) and `test_two_party_pipeline` ("hello" read as digits = "10660", all digits, HE == plaintext) ALL PASS.
- Full regression (before the vector rewrite), 7 models × desktop + phone: every chapter via Next, every proof badge ✓, no problems, no console errors.

## [Phase 7 polish] 2026-10-03 — EMNIST retrained on real + drawn-style images; top-3 per character
- All interface servers were stopped at the user's request. A test server ran only during browser checks and was stopped after.
- `uv add --dev scikit-image` (0.26.0, dev group): centre lines for the re-drawing.
- New `data/features/glyph_redraw.py`: a Python twin of `renderGlyph` (skeleton of a 4× upscale, anti-aliased round pen via distance transform, 4×4 average, peak → 255).
  - Parity with the browser on 200 real test characters: mean |py − js| = 2.2/255, same prediction 92.5%.
- `models/train/emnist_logreg.py`:
  - Re-draws every train/test image once (cached as `data/raw/emnist/emnist-balanced-{train,test}-redrawn.npy`; train 265 s, test 55 s).
  - Fits on real + re-drawn (225,600 images, same labels; augmentation derived from real data, not a synthetic dataset). `--evaluate` scores a saved model.
  - Before (real only): real test 0.6882, re-drawn test 0.5687.
  - After: train 0.7019, real test 0.6728, re-drawn test 0.6824 (fit 1031 s, not fully converged at max_iter=300).
  - Kept, since `/live` input is drawn. The old model is saved at tmp/emnist_logreg_real_only.pkl.
  - The real "hello" sample now reads "he66O" (was "heLLO").
- Benchmarks: emnist_logreg row re-measured: 5 samples, plaintext 0.060 s, HE 28.6 s, agreement 1.00.
  - It is ~4.7× MNIST's HE time (5.6 s now) because the benchmark encrypts once per class (47 vs 10). The first 10.5 s measurement was the outlier.
- Result chapter: each character card shows its top-3 classes (softmax of its decrypted scores over the allowed classes).
- Checked:
  - Registry and pipeline tests ALL PASS.
  - A mouse-drawn "01ab" (tmp/draw14.py) reads "01Qb" with top-3 0 56%/O 15%/D 12%; 1 39%/I 28%/L 26%; Q 56%/B 8%/a 7%; b 92%. Read as letters it gives "OIQb". No console errors.
  - all10.py for mnist_logreg + emnist_logreg, desktop + phone: every chapter via Next, 152 checks ✓ each, no problems, no console errors.

## [Phase 7B] 2026-10-03 — clarity pass planned (user review on human_vs_ai_text)
- Asks:
  - every matrix gets the hover formula (never clipped, no inner scroll box) and, if animated, the CKKS grid controls
  - graphs inside chapters become a split screen (graph right with the current node highlighted, node content left), with steps numbered by the graph flow (N, N.1, N.2…) instead of the nested dolly zoom
  - no native title tooltips except glossary words
  - public-key grid alignment
  - ELI5 / Advanced explanation levels switched in the navbar
  - character switcher for MNIST / EMNIST
- Question answered: the Encryption chapter's decryption round trip is a sanity check (the server decrypts its own fresh ciphertext to prove correctness and measure starting noise), not a protocol step; it becomes a ✓ in 7.11.
- Added to docs/checklist.md as Phase 7B, milestones 7.10–7.14; plan file updated.

## [Phase 7B · 7.10] 2026-10-03 — matrices everywhere behave the same
- New `js/cell_formula.js`: formula popups are fixed-position elements on `<body>`, placed from the cell's screen rectangle, so scroll boxes, CSS zoom and overflow can't clip them.
  - `attachFormulaHover` gives one shared hover popup; `createFormulaPop` gives a per-grid reveal popup.
  - `clearFormulaPops()` runs on every step change and on chapter exit (`chapter_state.js`).
  - Cause of the user's screenshot: the old per-grid overlay sat inside the byte row's scroll box, which grew a scrollbar and clipped it.
- New `js/reveal_controller.js`: the CKKS grid's play / pause / step / restart engine made generic (`createRevealController`, `gridRevealDelay`; pace `window.gridSpeed`).
  - `poly_grid.js` and `byte_matrix.js` rebuilt on it; `byte_matrix` still returns a Promise, so its 25 call sites are unchanged.
  - Every animated matrix now has the same control bar: passphrase/salt bytes, K/ipad/opad, the SHA-256 schedule + 64 rounds (HMAC), the final key, AES key/schedule/J0/states/S-box/XOR, OAEP blocks, m(X) coefficients, c0/c1, the serialization header, the slot grid.
- Hover formulas added where they were missing:
  - CKKS poly grids (equation + exact value)
  - the slot grid (`z_j = x_{j mod d}`)
  - deep-dive slot tables (per-row meaning + exact value)
  - digit pixels (`p_{r,c}` and `x_i = p/255`)
  - U-chain (`U_i = HMAC(P, U_{i-1})`, `T_i = T_{i-1} ⊕ U_i`)
  - symptom flags
  - PBKDF2 graph boxes (full value)
- Native `title` tooltips removed everywhere except glossary terms (23 attributes → `aria-label`; navbar run info, explanation cells, next button, speed dial).
- Public-key grids centred (`.grid-pair` align-items centre, grids max 960 px, `margin: 0 auto`). The 64-row SHA-256 matrices keep their height cap (their popups are no longer clipped).
- Browser check (tmp/m710.py, human_vs_ai_text, 1880×920):
  - passphrase byte popup "P_7 = 0x72 / P[7] = 0x72 = 'r'" in view, no scrollbar
  - slot grid has controls + hover
  - public-key grids centred (centre 940 = scene centre)
  - deep-dive slot hover; 0 non-glossary titles; no console errors

## [Phase 7B · 7.11] 2026-10-03 — split screen for every graph inside a chapter
- New `js/split_view.js` (`subStep(step, {graph, focus, lit, flow, caption})`): a step about one node of a chapter's graph is drawn split screen.
  - left: the node's own content
  - right: the whole graph, the node(s) highlighted (gold), the boxes reached so far lit, the edges into the node animated
  - The step is marked `sub`.
- Numbering follows the graph: `scrubber.js stepNumbers` makes the graph step N and its node steps N.1, N.2, …
  - The counter reads "Step 7.3 · 10/17"; the step-slider tooltip uses the same labels.
  - `data-total` on the counter carries the real step count (tests read it).
- Key Setup:
  - 1–6 keys/CKKS/RSA
  - 7 PBKDF2 graph (moved before its nodes, as the user asked)
  - 7.1 passphrase [P], 7.2 bytes + salt [P, salt], 7.3 K/ipad/opad [K, ipad, opad]
  - 7.4 inner SHA-256 input [inner], 7.5 message schedule [inner], 7.6 64 rounds [inner]
  - 7.7 outer hash → U₁ [outer] (now shows the inner digest and U₁ as matrices with formulas)
  - 7.8 chain [chain, xor], 7.9 AES key [key]
  - 8 every key
  - The nested zoom is gone; the chain step's own small graph is gone (the split view's graph replaces it).
- Encryption:
  - 1 plaintext, 2 pipeline graph
  - 2.1 slots, 2.2 ×Δ, 2.3 m(X), 2.4 RNS, 2.5 Enc_pk, 2.6 serialization, 2.7 ciphertext + SHA-256
  - The decryption round-trip step was removed. It is now a labelled sanity check on 2.7 (two ✓: noise, decoded slots), not a protocol step.
- Transport (both legs):
  - 1 why seal, 2 counter-mode graph
  - 2.1 key, 2.2 key schedule, 2.3 nonce/J₀/counter, 2.4 inside AES (no zoom), 2.5 14 rounds, 2.6 S-box, 2.7 keystream ⊕ payload → C₁
  - 3 tag, 4 RSA-OAEP, 5 wire, 6 unwrap, 7 tamper
  - "the RSA envelope (step 4)" text fixed.
- `pbkdf2_graph.js`:
  - `focus` takes several nodes
  - edge labels are hover popups on a wide invisible hit path (the SVG `<title>` native tooltips are gone)
- `sub_zoom.js` / `sub_zoom.css` deleted; breadcrumbs → `.graph-crumbs` in pbkdf2_graph.css.
- Backend text: the client-RSA event's next_step now points at PBKDF2.
- "Next:" texts carry the new numbers.
- Browser check (tmp/m711.py, human_vs_ai_text, 1880×920):
  - key: 1…7, 7.1[P], 7.2[salt,P], 7.3[K,ipad,opad], 7.4–7.6[inner], 7.7[outer], 7.8[chain,xor], 7.9[key], 8
  - enc: 1, 2, 2.1[slots] … 2.7[sha]
  - transport: 1, 2, 2.1[key], 2.2[key], 2.3[nonce,j0,ctr], 2.4–2.6[aes], 2.7[ks,xor,p,c], 3…7
  - no failed checks, no console errors

## [Phase 7B · 7.12] 2026-10-03 — ELI5 / Advanced explanations
- New `js/explain_level.js`: a navbar switch "Explain: ELI5 | Advanced".
  - Default ELI5 (the user said they didn't understand the Key Setup steps); remembered per browser as `kryptamet.level`.
  - `levelText(step, key)` picks `step.eli5[key]` at ELI5. Switching fires `explainlevel`; the Scrubber re-renders its four cells (formal is titled "In one line" at ELI5, in normal type) and an open primer redraws.
  - The navbar now sits above the primer backdrop (z-index 2100), so the switch works while a primer is open (found by the test).
- Every step got a plain-words twin built from the real run's values:
  - key_setup_steps (17)
  - encryption_steps (9)
  - transport_steps (15 blocks incl. both key-step variants)
  - deep_dive_steps (12 blocks, the rotation one per round)
  - computation_steps (`computeEli5` per event kind)
  - scene_renderers: TF-IDF overview + per word; `featureEli5` for stylometric/tabular features; symptoms; digits; decryption, softmax, sigmoid; the reading step, the score and prediction compare; benchmarks
- `chapter_intros.js` rewritten. Every primer has an `eli5` twin.
  - Advanced text corrected for the two-party flow: Computation runs on the client, not the server; the secret key is the server's.
  - Advanced text corrected for 7.11: split screen and numbered sub-steps instead of zoom; the round trip is a sanity check.
- Check (tmp/m712.py, all 7 models): each chapter's steps rebuilt in the browser.
  - sms 115, human 104, german 129, price 96, symptom 93, mnist 112, emnist 112 steps (761 in all); every step has non-empty eli5 what / why / formal / next: 0 missing.
  - Switching changes the Scrubber text and cell title ("In one line" ↔ "Formal notation") and the primer text; no console errors.

## [Phase 7B · 7.13] 2026-10-03 — character switcher (MNIST / EMNIST)
- Backend (`interface/app.py`):
  - New `_run(spec, feats, passphrase)`: one complete traced run.
  - For image input, `/api/infer` featurizes and runs each drawn character on its own, with its own keys, ciphertexts, transport legs, events and checks. A typed passphrase is shared; otherwise each run draws its own.
  - The response is run 1 + `char_runs` (runs 2..n). Every run carries `char_index`, `char_input` (its single image + charset), the full `input` and the shared `characters` summary.
- The untraced shortcut was removed: `run_two_party_pipeline(extra_xs=)`, the pipeline's `characters` field, the registry's `extra_x`.
- Frontend:
  - New `js/char_switch.js`: chips (framed image + decrypted label) in the chapter chrome at the top left, also shown on the flowchart.
  - `chapter_state.js` `selectCharacter(k)` saves and restores per-character done chapters, step positions, proof tallies, last-visited box and deep-dive (fetched with that character's `char_input` the first time). It rebuilds the flowchart or the open chapter in place.
  - Navbar: "showing character k". Re-lock re-runs every character and returns to character 1.
  - Texts: the Feature chapter says "Character k of n"; Result steps 2–3 say "Character k"; the reading step marks the shown character's card and explains every character has its own run. The Feature summary reads "character k of n · 784 pixels".
- Tests:
  - `test_two_party_pipeline.check_multi_character` now goes through `/api/infer` (Flask test client): "hello" gives 5 complete runs (char_index 0–4, own x, own events, 5 different random passphrases, every decrypted class = plaintext), 18.7 s.
  - The digits-only run with a shared passphrase reads "10660".
  - `test_model_registry` ALL PASS.
- Browser (tmp/m713.py, EMNIST "123"):
  - 3 chips; each character has a distinct run (own leg-1 payload hash, own passphrase) and its own deep-dive score (7.17 / 14.61 / 8.74)
  - switching inside a chapter rebuilds it ("Character 3 of 3"); per-character step positions are restored
  - the Result card marks the shown character; no console errors
- Earlier full regression (7.10–7.12 code, desktop): all 7 models, every chapter via Next incl. the new sub-steps; proof badges sms 140, human 125, german 151, price 117, symptom 116, mnist 154, emnist 154 ✓; no problems, no console errors. The phone half was stopped for the 7.13 restart and is part of 7.14.

## [Phase 7B · 7.14] 2026-10-03 — verification (in progress)
- Python tests: all 9 files PASS.
  - test_transport_roundtrip, test_pbkdf2_rsa_trace, test_aes_trace, test_ckks_encode_trace, test_ckks_math
  - test_model_registry
  - test_two_party_pipeline: "hello" via /api/infer = 5 traced runs in 16.6 s
  - test_he_inference
  - test_he_cnn_inference: HE 3/3 = plain 3/3, 217 s
- README: seven live models, EMNIST + multi-character handwriting, ELI5/Advanced, per-matrix controls + hover formulas, split-screen graphs; the download script now fetches EMNIST.
- New regression script tmp/all14.py:
  - LEVEL=eli5|advanced checks every step's cell title and non-empty explanation at that level
  - EMNIST "123" is walked through every chapter once per character via the chips
- The temporary test server was stopped by Claude Code (system low on memory). The browser regression is pending until the user allows a restart.

## [Phase 7B · 7.15] 2026-10-03 — roles swapped to the standard naming + send/receive chart
- User: the end user is the client (types the input, holds the CKKS secret key, decrypts the answer); the server computes. The app had them the other way round (as named when Phase 7 was planned). User also asked for a TCP-style send/receive chart instead of the 3-column "Who holds which key".
- Answered: CKKS encryption uses the public key (the secret key only decrypts). Both the RSA-wrapped AES key and the AES-encrypted CKKS ciphertext travel in the open, which is safe: the AES key needs the recipient's RSA private key, and the inner layer stays CKKS-locked.
- Role swap (tmp/swap715.py): a two-way word swap server ↔ client (also as `_`-parts of identifiers, event names `rsa_keygen_client/_server`, the leg AAD strings) in every file that shares those names.
  - Files: inference/he_infer.py, 13 JS files, the docs; 328 + 29 words.
  - JS `clientX/clientWidth` and the Flask web-server messages in pipeline_api.js were left alone.
  - The test tables (KEYS_ORDER, PARTY) were swapped the same way.
- Fixed by hand after the swap:
  - two legacy lines that already meant the compute side ("the server that computed it never saw your real data", "the server only ever computed the linear part")
  - the (S)/(C) subscripts in two Key Setup formulas
  - ELI5 phrasing ("The client is you: it owns the data")
  - labels "Client (you, the data owner)" / "Server (compute node)"
- New `js/sequence_chart.js` + `css/sequence_chart.css`: the protocol as a sequence diagram built from the run's events.
  - Client (you) and Server (compute node) lifelines, time running down.
  - Messages: CKKS public context (33.7 MB), client RSA public key, server RSA public key, leg 1 (RSA-OAEP(AES key) 256 B + nonce + AES-GCM(Enc(x)) + tag), leg 2 (… Enc(score) …).
  - What each side holds after each message; label and size above each sloped arrow; text halos.
  - Key Setup step 1 is now "Who sends what, and who keeps what" (key exchange highlighted, secrets listed under the chart).
  - Transport step 1 shows the envelope layers and the chart side by side, that leg highlighted.
  - Dead party-grid code and CSS removed.
- Tests: test_two_party_pipeline ALL PASS (event order + party per event under the new names, "hello" 5 traced runs, digits-only "10660"); test_pbkdf2_rsa_trace PASS.
- Browser (tmp/m715.py):
  - flowchart reads "… Transport → server | Computation | Transport ← client …"
  - titles read "Transport leg 1: Client (you) → Server (compute node)"
  - the charts highlight 3 / 1 / 1 messages; no console errors
- Follow-up (user restated the flow in X / Y / Z terms: X = CKKS(text), Y = AES(X), Z = RSA_server-public(AES key), send Y + Z; the server opens Z → AES key → X, computes, sends Y′ + Z′ back; the client opens Z′ → Y′ → X′ → CKKS secret → result).
  - This is exactly the implemented flow after the swap; the chart and texts now say it in those terms.
  - `sequence_chart.js` rewritten: legend X/Y/Z; arrows "Y + Z" and "Y′ + Z′" with real sizes; every operation listed in order on the side that does it; row heights fit the lists.
  - Transport step 1: ELI5 "what" and the formal line use X/Y/Z.
- Follow-up 2: the user didn't want literal X/Y/Z. The chart and the Transport step-1 text now name things plainly:
  - CKKS ciphertext (your input, homomorphically encrypted)
  - AES-sealed ciphertext / result (AES-256-GCM on top)
  - RSA-wrapped AES key (RSA-OAEP with the receiver's public key)
  - Every operation is listed on the side that does it; the chart widened to 1180 px. Confirmed against inference/he_infer.py that this is the flow the code runs:
    - leg 1: PBKDF2 AES key, wrapped with the server's public key
    - the server computes on a public-only context
    - leg 2: a fresh random AES key, wrapped with the client's public key
    - the client CKKS-decrypts

## [Phase 7B · 7.14] 2026-10-03 — final verification: Phase 7B complete
- Python: all 9 test files PASS (logged above). test_two_party_pipeline re-run after the role swap: PASS.
- Browser (tmp/all14.py), all 7 models; every chapter and every step (incl. graph sub-steps), chapters reached only through Next:
  - Desktop 1440×900 at ELI5 and phone 390×844 at Advanced. Every step's formal-cell title matches the level ("In one line" / "Formal notation") and its explanation is non-empty.
  - EMNIST "123": walked once per character via the chips.
  - Proof badges (both viewports): sms 140, human 125, german 151, price 117, symptom 116, mnist 154, emnist characters 1/2/3 154 each, all ✓, 0 failed.
  - No problems, no console errors.
- One-screen input check (tmp/fit12.py): 28/28 OK (7 models × 4 sizes).
- The temporary test server was stopped. Phase 7B is complete; Phase 8 stays gated on the second PC's config.

## [Phase 7C] 2026-10-03 — planned: /live as a course on HE (user's issues.md)
- User review (issues.md + image.png, image-2/3/4.png):
  - Steps don't teach: CKKS parameters, Galois keys, RSA λ/e/d (the text wrongly said e is made from p and q; e is the fixed 65537), ipad/opad and the 0x36/0x5c choice, the SHA-256 block/schedule/rounds and where the inner result comes from, the c0/c1 variables, the TenSEAL header bytes, EM/DB, Enc(x)·Wᵀ + b.
  - No "how HE works" theory. Numbers appear without an origin.
  - The S-box comes after the rounds. The Deep-Dive is confusingly placed and ends with its own decryption.
  - The split graph's size jumps. Popups should show the value as plain text with its meaning under it.
  - "In one line" should read "Significance". The 14 AES rounds have no controls. The RSA-OAEP grids scroll needlessly.
  - "browser did X" narration everywhere. ELI5 is still jargon-heavy.
  - The Decryption chapter has no real decryption; the receiver-side opening (RSA decrypt → AES key → AES decrypt → CKKS ciphertext) is collapsed into one step.
- Root cause (mine): the chapters were built to prove the values are real, not to teach what they mean.
- Plan in docs/checklist.md, Phase 7C:
  - 7C.1 fixes
  - 7C.2 restructure (new chapter "How HE works", sender/receiver halves in transport, Decryption → Result, Deep-Dive → appendix)
  - 7C.3–7C.6 chapter-by-chapter course rewrite
  - 7C.7 verify
- ELI5 standard saved to memory (eli5-course-standard).

## [Phase 7C · 7C.1] 2026-10-03 — fixes
- Popups (`cell_formula.js`, components.css): the value first, plain text (`.formula-value`); what it is / how it's made just below (`.formula-meaning`). The byte_matrix default popup text is the plain value.
- Split view: only `.split-left` gets the `--fit` zoom, so the graph is the same size on every sub-step (checked: 685×176 on Encryption 2.1, 2.3, 2.5).
- ELI5 formal cell title: "In one line" → "Significance" (scrubber.js, explain_level.js, ARCHITECTURE.md, tmp/all14.py).
- Transport:
  - the S-box is now 2.5, before the 14 rounds (2.6) that use it; "Next" texts renumbered
  - `tpPlayRounds` rebuilt on the shared reveal controller (one unit per round; ▶ ❚❚ ‹ › ↺ + speed; stepping back shows that round's matrices)
- Inner scroll boxes removed:
  - the `.ks-tall` 330 px cap (SHA-256 schedule/rounds, AES schedule, m(X) grid); the classes are gone
  - the AES round list's 150 px cap
  - the RSA-OAEP EM/DB grids
  Tall grids show in full; the page scrolls.
- byte_matrix columns are sized per column (`minmax(<widest in column>ch, auto)`). Before, one 14-digit value widened all 8 columns and clipped the m(X) grid; now scrollWidth = clientWidth (787 px).
- m(X) "mismatch": the data is identical (the grid's first 256 coefficients = coeffs_all[:256], checked on a live run). The likely confusion: only 15 of 8192 coefficients are non-zero, because x (8 values) repeats 512×. To be explained in 7C.4.
- Regression (tmp/all14.py, human_vs_ai_text + sms_spam, desktop, ELI5): every chapter and step; badges 125 / 140 ✓; no problems, no console errors. The temporary server was stopped.
- Note: 7C.1 work began before the user's explicit go (my mistake; flagged to the user). The user then said "go with checklist".

## [Phase 7C · 7C.2] 2026-10-03 — restructure
- **ELI1 level** (explain_level.js `levelTwin`): a third level in the navbar switch. eli1 falls back to eli5, which falls back to the advanced text. scrubber.js and intro_card.js use it.
- **New chapter 1, "How HE works"** (js/how_he_steps.js + css/how_he.css; `TOY`, 11 steps):
  - parameters q = 10007, Δ = 1000, s = 3, a = 4321, e = 2; all values computed live
  - keygen, the noise attack (s found without noise: 3; with noise: 7796), encryption, decryption (0.252), wrong key (−1.114), addition (0.755), ×3 (0.756), w·x+b (0.353 vs 0.35), toy vs real
- **Deep-Dive chapter removed:**
  - `buildDeepDiveSteps(dd, result, stage)` tags each step encrypt / compute / result
  - `chapter_registry.js` `joinSteps` appends "Up close (N=256)" parts to Encryption, Computation and Result
- **Decryption chapter merged into Result:** decryption, sigmoid/softmax, up-close decrypt/decode, comparison, result. There are now 9 chapters.
- **Transport:**
  - the RSA-OAEP step is split: step 4 is the sender sealing the key (n, c); step 6 is the receiver opening it with its private key (EM/DB)
  - step 5 is the wire; step 7 is "AES-GCM → CKKS ciphertext"; step 8 is the tamper test
  - fixed two ELI5 strings that showed a literal `${L.to}`
- **Source links** (js/source_links.js, css/source_links.css):
  - `step.facts` + `registerFacts`; `srcRef` / `srcLinkHtml`; `linkExplanation` in the scrubber
  - hover preview (cell_formula `show(..., plain)`); click → `jumpToFact` + pulse
  - the navbar `#srcBackBtn` pill with a stack; Esc goes back
  - first facts: pbkdf2_key, ckks_ct_sha, result_ct_sha
- **Intros:** how_he added; deepdive/decrypt removed; Result's primer says the server never sees the score, the single decryption happens at the end, and softmax runs after it.
- **Docs:** ARCHITECTURE, LIVE_UI_TRUTH, README updated.
- **Targeted browser check** (tmp/c72.py, symptom_diagnosis):
  - 9 chapters; the 3 levels; How HE 11 steps; Encryption ends with "Up close · c1"
  - transport order correct; source link hover → jump to Key Setup 7.9 + pulse → pill back to 2.1; Result 6 steps in order
  - no console errors
- The full regression was stopped at the user's request ("regression testing is supposed to be at the end"); it runs in 7C.7.

## [Phase 7C · 7C.3] 2026-10-03 — Feature Extraction + Key Setup as course text
- **Key Setup** (key_setup_steps.js, tmp/c73_keys.py): all 16 ELI5 texts rewritten. Every step now says what, why and how, with the real values; the "your browser did X" narration was replaced by ✓/✕ marks.
- **Must-say fact, CKKS keys step:** the public key isn't strictly needed (only you lock and unlock; symmetric CKKS would work); TenSEAL makes one by default; the server really needs the Galois/rotation keys (and the relinearization key, unused by these models); their share of the bundle is given.
- **ELI1 twins, computed in code:**
  - CKKS params: toy q/Δ vs real
  - CKKS keys: TOY s and pk; the noisy-attack result
  - RSA primes: 5 × 11 = 55
  - RSA e/d: λ = 20, e = 3, d = 7; 2³ mod 55 = 8; 8⁷ mod 55 = 2
  - server RSA: 7 × 13 = 91, e = d = 5; 32⁵ mod 91 = 2
  - passphrase byte: the real first character's code
  - ipad/opad: the real first byte of K XORed bit by bit
  - SHA padding: the real sizes
  - schedule: toy digits W16
  - rounds: toy 2-register mix
  - U-chain: 5 ⊕ 3 ⊕ 4 = 2
- **Facts:** pbkdf2_salt, rsa_n_client, rsa_n_server. Transport's seal step links n to Key Setup. The SHA-256 ELI5 text links the salt.
- **Feature Extraction** (scene_renderers.js):
  - symptoms, digits, TF-IDF, stylometric and tabular ELI5 rewritten with reasons. Stylometric shows its real a ÷ b numbers, parsed from the trace, plus why each style number matters.
  - tabular shows the real μ and σ: `data/features/tabular.py` now adds `raw`, `mu` and `sigma` to each numeric trace step.
  - ELI1: symptoms' first 5 positions; one real pixel ÷ 255; a toy TF-IDF corpus; a toy z-score (ages 20/30/40 → 45 gives 1.84).
  - Fact feature_x on the last step (chapter_registry.js).
- **Glossary:** prime, modulus/mod, hexadecimal/hex, byte, register, relinearization, lcm, noise.
- **Checks:**
  - tmp/c73.py on german_credit, human_vs_ai_text and symptom_diagnosis: every Feature and Key step at all 3 levels; no undefined / NaN / `${` / raw tokens; no console errors
  - tests.test_model_registry: ALL PASS
  - the temporary server was stopped

## [Phase 7C · 7C.4] 2026-10-03 — Encryption as course text
- **encryption_steps.js** (tmp/c74_enc.py): all 9 ELI5 texts rewritten with real values and reasons; ✓ marks replace the browser narration.
  - plaintext: links to feature_x
  - pipeline: the 7 stages and why each exists
  - 2.1 slots: slot[j] = x[j mod d]; why repeat (rotations)
  - 2.2 scale: the first real value × 2^40; why 2^40 (≈12 decimals; matches the 40-bit rescale primes); Δ links to ckks_params
  - 2.3 m(X): the full formula, X explained, mod X^N + 1, slots = values at special points; the non-zero coefficient count with positions. This answers the 7C.1 "mismatch": 15 non-zero for d=8, which divides 4096; ~all for sms d=500, explained per case.
  - 2.4 RNS: real m₀ residues and the CRT
  - 2.5 c0/c1: every variable defined (pk₀, pk₁ linked, u, e₀, e₁, mod X^N+1 and each prime); noise shown with real numbers (m₀ …648 decrypted as …652; max noise 99 → ~1e-10)
  - 2.6 bytes: 2×3×8192×8 = 393,216 → zstd size; header magic/version/compression; why compression barely helps
  - 2.7 fingerprint
- **ELI1 twins:** 3 numbers in 8 slots; Δ = 1000; a 2-slot toy m(X) = 3 + 2X from (5, 1); CRT 23 → (3, 2) mod 5/7; TOY c0/c1 + unlock.
- **Up close (deep_dive_steps.js, encrypt stage):** 5 ELI5 texts rewritten; why the secret coefficients are small, b + a·s = e, the full cancellation algebra.
- **Facts:** ckks_params, ckks_pk (Key Setup).
- **Glossary:** coefficient, scale/Δ, Chinese Remainder Theorem.
- **Check:** tmp/c74.py, human_vs_ai_text + sms_spam, every Encryption step at 3 levels. No bad text, no errors. Fixed sms_spam wording ("Only 8191 of 8192"). The test server was stopped.

## [Phase 7C · 7C.5] 2026-10-03 — both Transport chapters as course text
- **transport_steps.js** (tmp/c75_tp.py): 16 ELI5 texts rewritten with real values and reasons; ✓ marks replace the browser narration. Covered:
  - the trip key (links pbkdf2_key and the salt) and the fresh return key (why: nonce reuse, one key per message)
  - the overview: why two layers, why AES + RSA (hybrid)
  - the key schedule: the real w8 derivation (rotate → S-box → Rcon → ⊕ w0)
  - nonce/J0/counters with real values and the block count
  - the counter-mode graph
  - the state + round key 0: real first-byte XOR
  - the S-box: the real byte's row/column lookup; why it's non-linear
  - the 14 rounds: the four moves, round 1's first byte, why each move
  - keystream ⊕ data: real block 1
  - GHASH/tag: H, the running total, real block and multiplication counts, tag = X ⊕ AES(J0)
  - RSA-OAEP seal: DB/seed/MGF1/EM layout; n links to Key Setup
  - the wire: every field and the total
  - RSA open: c^d, unmask, structure checks
  - AES-GCM open: tag first; the fingerprint links to the source chapter
  - the tamper test: the real flipped bit
- **ELI1 twins:**
  - 4-bit key-schedule toy
  - counters 500 + i
  - the real first byte XORed in bits
  - a ShiftRows letter grid
  - S-box lookup by hex digits
  - payload XOR and undo
  - a toy GHASH mod 11 with H = 5 (tag 2; a changed block gives a different tag)
  - toy OAEP: 2 padded as 12/42 → 38/35 under n = 91, e = 5. r = 3 was avoided because 32⁵ mod 91 = 2 and would confuse.
  - toy RSA open: 38⁵ mod 91 = 12 → 2
- **Glossary:** MGF1, SubBytes, ShiftRows, MixColumns, AddRoundKey, hybrid encryption.
- **Check:** tmp/c75.py, german_credit, both Transport chapters, every step at 3 levels. No bad text, no console errors. The test server was stopped.

## [Phase 7C · 7C.6] 2026-10-03 — Computation, Result, Benchmarks as course text
- **computation_steps.js:**
  - overview defines w, x (links feature_x), b and W's shape; says why only + and × run locked and why softmax waits
  - general form: what happens inside Enc(x)·Wᵀ + b (slot multiply, rescale by a 40-bit prime, rotate-and-add with the Galois keys, + bias), why each step is correct and needed; the output fingerprint links result_ct_sha
  - bias: why the bias is scaled
  - new `computeEli1`: TOY score; rescale toy (250 × 3000 → ÷1000); rotate-and-add [2,5,1,4] → [12,12,12,12]; bias added to c₀ only
- **Up close, compute + result** (deep_dive_steps.js): 7 ELI5 texts rewritten; browser narration removed. Covered:
  - why the weights are encoded like x
  - × ŵ keeps the unlock rule; scale becomes Δ²
  - chunk sums
  - rotations: the Galois key's role; halving 64…1
  - the bias at Δ²
  - why decryption still cancels after every server step
  - decode ÷ Δ²
- **Result** (scene_renderers.js):
  - decrypt: the first and only unlock; the server never saw the score; c₀ + c₁·s, then decode. ELI1 uses the TOY unlock.
  - softmax: real top-2 scores → % and why e^x; ELI1 toy (2, 1, 0) → 66.5/24.5/9.0%
  - sigmoid with the formula; ELI1 0 → 50%, ±2 → 88.1%/11.9%
  - comparison: noise ÷ scale; a demo-only note (the client has no plain model in real use); ELI1 toy error 0.003 vs real
  - prediction: privacy costs time, not correctness
- **Benchmarks:** ELI5 adds peak memory and why locked maths is slower.
- **Fixes:** "Decryption chapter" → Result (computation check label, key summary). The decrypt text no longer links "secret key" to the public-bundle fact.
- **Glossary:** softmax, rescaling.
- **Check:** tmp/c76c.py, symptom_diagnosis + sms_spam; Computation, Result and Benchmarks every step at 3 levels. No bad text, no console errors. The test server was stopped.

## [Phase 7D] 2026-10-03 — Deploy on Vercel (user request)
- **Research** (Vercel docs, 2026-08):
  - Python 3.13 supported; the Flask preset loads `app` from root `index.py`/`app.py` or `tool.vercel.entrypoint`
  - Python bundle 500 MB; Hobby 300 s / 2 GB
  - **4.5 MB request/response limit**
  - static files belong in `public/**`
  - which file wins when pyproject.toml and requirements.txt both exist isn't documented, so pyproject.toml/uv.lock are hidden via .vercelignore
  - TenSEAL 0.3.18 ships cp313 manylinux_2_28 x86_64 wheels
- **New files:**
  - `index.py`: entry point, re-exports interface.app:app
  - `requirements.txt`: runtime-only, pinned to the installed versions
  - `vercel.json`: buildCommand `python3 scripts/vercel_build.py`; maxDuration 300; excludeFiles
  - `.vercelignore`
  - `scripts/vercel_build.py`: copies interface/static → public/static; dry run copied 70 files; public/ is gitignored
  - `scripts/build_samples.py` → `data/samples/word_samples.json` (33,454 B; 2 MNIST + 4 EMNIST words from real test images; idempotent)
- **.gitignore:** `data/raw/*` with exceptions for german_credit.data, price_data.csv and symptom_diagnosis/ (1.6 MB the app reads at runtime); public/ added.
- **Code:**
  - `inference/model_registry.py` `_word_samples(..., model_id)`: falls back to SAMPLES_FILE when the raw test set is missing (checked with the raw dirs hidden: 2 and 4 rows)
  - `inference/he_infer.py` `encrypted_scores` (untraced Enc(x)·Wᵀ + b)
  - `interface/app.py`:
    - `/api/infer` takes `char` (0-based; 400 when out of range) and traces only that character
    - the `characters` summary uses the traced run for that character and `encrypted_scores` for the others
    - `_pick` gives the HE class rule
    - `char_runs` is removed
  - `pipeline_api.js` `fetchCharRun`; `chapter_state.js`: charRuns is sparse, and a chip fetches its character's run the first time it is picked (reusing the user's passphrase if one was set)
- **Measured:** /api/infer 1.65–1.75 MB (text/symptoms) and ~2.2–2.3 MB per EMNIST character; deep-dive ~0.15 MB; /api/models 56 KB. Estimated bundle ~273 MB (packages 270 MB + app/data 3 MB).
- **Checks:**
  - tests/test_two_party_pipeline `check_multi_character` rewritten: 5 requests, each < 4.5 MB; summary = traced runs; char 5 → 400; digits mode. PASS ('he66O', '10660').
  - browser (tmp/cv.py): EMNIST "123"; chips 2 and 3 load their runs on click; no console errors
- **Docs:** README "Deploy on Vercel"; CLAUDE.md note; checklist Phase 7D. The first real deploy is the user's (needs a Vercel account).
- The 7C.7 regression was stopped for this patch: desktop had finished 7 models (all badges ✓), and the run was mid EMNIST character 2. It reruns in full after the patch.

## [Phase 7C · 7C.7 extra] 2026-10-03 — every number shows its variable underneath (user request)
- **New:** `js/var_label.js` + `css/var_label.css`.
  - `vn(value, label)` makes a ⟨value|label⟩ token; `vnHtml` renders it directly in scene HTML.
  - `richText` renders labelled-number tokens and source-link tokens together.
  - `VN_AUTO` labels every plain `name = number` (also `"quoted name" = number`). It skips hex and skips a number followed by an operator, so "n = 5 × 11" doesn't put n under the 5.
  - Rendering: inline-flex column, the variable in 0.62em muted type under the number.
- **source_links.js:** `linkExplanation` now calls `richText(..., glossary, auto)`; `srcRef(id, text, label?)` can label a linked value; SRC_TOKEN removed.
- **How HE** (tmp/vn_howhe.py): 283 value interpolations wrapped with their variable (c0 of x₁, pk0, q, Δ, …). `renderToyCalc` renders tokens in every column; numeric values show the row's variable (4th item or row name); notes are rich text.
- **Hand-labelled calculations** (tmp/vn_rest.py):
  - Key Setup: RSA toys, U-chain XOR, SHA padding sums, the toy schedule, the toy CKKS key, ipad/opad bits; the RSA ELI1 Significance lines
  - Encryption: slot rule, Δ scaling (real + toy), toy m(X), CRT toy, TOY c0/c1 + unlock, coefficient and byte totals
  - Transport: key-schedule toy, state XOR (hex + bits), keystream block, payload XOR bits, GHASH toy, OAEP/RSA toys
  - Computation: w·x, bias sum, TOY score, rescale and rotate-and-add toys, bias toy
  - Feature / Result: pixel ÷ 255, TF-IDF toy, z-score toy and the real (value − μ) ÷ σ, TOY unlock, sigmoid toys and the real sigmoid
- **Check:** tmp/vn2.py, german_credit + symptom_diagnosis, all 9 chapters × every step × 3 levels:
  - 1,790 labels rendered; no raw tokens in the explanations or scenes; no console errors
  - fixed along the way: the toy-table row name was escaped (step 7), the label fallback for token-named rows, a quoted-name regex typo
