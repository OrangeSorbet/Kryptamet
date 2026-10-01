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
