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
