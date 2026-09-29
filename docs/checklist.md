Phase 0 — Environment
[x] Python env + requirements.txt (tenseal, cryptography, scikit-learn, torch, pillow, flask)
[x] Verify TenSEAL install: encrypt→add→decrypt round-trip

Phase 1 — Crypto Core
[x] ckks_context.py — context/params setup
[x] keygen.py — key generation
[x] encrypt.py / decrypt.py
[x] transport.py — RSA+AES hybrid wrap/unwrap
[x] Test: encrypted vector round-trip via transport layer

Phase 2 - Data Prep
[x] Datasets acquired (5 scripted, 1 manual)
[x] Load + preprocess each dataset (raw/ → processed/)
[x] Feature extraction: image (Pillow) for MNIST, stylometric for text

Phase 3 — Model Training (plaintext baseline)
[x] Logistic regression modules (sklearn) per tabular dataset
[x] Small CNN (PyTorch) for digits
[x] Save trained models to models/saved/

Phase 4 — HE Inference
[x] he_infer.py — run each model type on encrypted input (logistic regression, 5/6 models)
[x] Validate HE inference output matches plaintext baseline (within tolerance)
[ ] mnist_cnn HE inference:
    [x] Replace ReLU with polynomial approximation (e.g. square activation)
    [x] Replace maxpool with avgpool or polynomial approximation
    [x] Retrain CNN with HE-compatible activations (plaintext baseline)
    [x] Validate HE-compatible CNN accuracy vs original CNN baseline (0.9853 vs 0.9814, PASS)
    [x] Run HE inference on CNN, validate vs plaintext (within tolerance) — 3/3 samples exact match

Phase 5 — Benchmarking
[x] metrics.py — time, memory (tracemalloc), accuracy per model/dataset (5 logreg models done)
[x] Compare plaintext vs HE inference cost
[x] Benchmark mnist_cnn_he (plaintext vs HE inference cost, time + memory, deferred until after Phase 6)

Phase 6 — Interface (RETIRED APPROACHES)
Old CLI + old tab-dashboard build (index.html, sections/*, tabs) are scrapped in favor of full-screen scene UI below. Kept only as history: colors.css/fonts.css/components.css base tokens survive and are reused; CLI (cli.py) stays as-is (not user-facing UI, no rebuild needed); backend (inference/he_infer.py incl. run_full_traced_pipeline_with_events, /api/infer_text) survives untouched — only the frontend is being rebuilt.

Confirmed reusable pieces from prior work:
[x] colors.css / fonts.css / components.css (base tokens)
[x] Backend: run_full_traced_pipeline_with_events() emits real per-feature event list (507 events verified for sms_spam)
[x] Flask /api/infer_text endpoint returns real event JSON
[x] Smoke-fade text transition CSS/JS (smoke_feed.css/js) — approved timing, reusable component
[x] Minimap SVG/CSS/JS (minimap.css/js) — loop path + traveling dot, mechanics verified working

To delete (dead weight from scrapped tab approach):
[ ] Delete interface/templates/index.html, interface/templates/sections/*, interface/templates/components/dataset_selector.html + result_card.html (superseded)
[ ] Delete interface/static/js/pipeline_animations.js (GSAP scroll-reveal, no longer used)
[ ] Remove tab CSS/JS from live_pipeline.css/js once full-screen rebuild replaces it

Phase 6D — Full-Screen Scene Rebuild (current direction)
Style target: 3Blue1Brown-like — one full-screen scene at a time, minimal chrome, large centered visuals, navigate scene-to-scene (not tabs, not scroll-dashboard).

Scenes (in order):
[x] Scene 0 — Overview: what is HE (short), model picker + real text input
[x] Scene 1 — Feature extraction: input text -> extracted numbers, full-screen display
[x] Scene 2 — Key setup: user-provided/generated key, shown full-screen
[x] Scene 3 — Encryption: numbers -> ciphertext, key usage shown
[x] Scene 4 — Computation: full-screen smoke-feed of real per-feature steps, speed slider, minimap visible
[x] Scene 5 — Transport: RSA+AES wrap/unwrap shown full-screen
[x] Scene 6 — Decryption: smoke-feed of decrypt steps, key usage shown again
[x] Scene 7 — Result: decrypted answer vs plaintext-run answer, match confirmation
[x] Scene 8 — Benchmarks: existing table, full-screen

Shared mechanics across scenes:
[x] Next/Prev scene navigation (full-screen transitions between scenes)
[x] Minimap (bottom-right, persistent across all scenes) — already built, needs wiring to real scene transitions instead of test timers
[x] Speed slider (persists across scenes that use smoke-feed: Computation, Decryption)
[ ] Instant mode toggle: skip all scene animations, jump straight to Scene 7 result -- NOT built (out of Phase 6F's problem list, flagged not silently added)
[ ] Live running_sum line chart in Computation scene (optional, alongside smoke-feed) -- optional, not built

[ ] Build order: scene navigation shell (empty scenes + next/prev) -> wire real data into each scene -> wire minimap to real transitions -> wire smoke-feed to real events -> instant mode -> polish

[ ] Test end to end: enter a real sentence for human_vs_ai_text, navigate all 9 scenes, verify decrypted result matches plaintext prediction, minimap dot tracks correctly, speed slider affects smoke-feed pace

Phase 6E — Real CKKS Algorithm Deep-Dive (CrypTool-style, real math not toy)
Problem: TenSEAL hides all polynomial/ciphertext internals (opaque wrapper over Microsoft SEAL), so nothing about the actual CKKS algorithm can be shown from it. User wants a CrypTool-AES-animation-style walkthrough, but for the real CKKS scheme.

Decision: implement a real, independent CKKS core in Python purely for visualization (encode/keygen/encrypt/decrypt math), running alongside (not replacing) the TenSEAL-based production pipeline. Real single-modulus arithmetic, N=4096 (a real production-grade polynomial degree), no RNS chain (RNS is a performance optimization detail, not different math) and no toy/simplified numbers. Grid values are genuinely computed, not illustrative placeholders.

[x] Build crypto_teaching/real_ckks.py (N=256 single-modulus, real canonical embedding via Vandermonde matrix, real ternary secret key, real error polynomials, real negacyclic ciphertext math)
    [x] Verify round-trip accuracy — tested [0.5,-0.3,0.8,0.1] -> recovered [0.4997,-0.3008,0.8006,0.1002], 0.16s runtime — PASS

[x] Backend endpoint /api/ckks_deep_dive: runs real_ckks.run_full_deep_dive() on the user's real 8-dim feature vector, returns full 256-length coefficient arrays for encode/keygen/encrypt/decrypt — verified 200 OK, real data returned

[ ] Frontend: new scene set styled after CrypTool's AES animation (grid-of-cells layout, highlight transitions between transformation steps, one grid per polynomial/stage):
    [ ] Encoding grid: real vector -> polynomial coefficients
    [ ] Keygen grids: secret key s, error e, public key (b, a)
    [ ] Encryption grids: (c0, c1) construction shown step by step
    [ ] Decryption grids: recovery of m' from (c0, c1, s)
    [ ] Note displayed: real math, N=4096 single-modulus (production TenSEAL uses N=8192 multi-modulus RNS for speed — same algorithm, faster engineering)

[ ] Test: round-trip through real_ckks.py matches original vector within tolerance, grids render with real computed values

Phase 6F — UX/Flow Overhaul (fixing confusing scene order and unclear content)
Problems identified from user walkthrough:
- Equation popup box too small, text overflowing
- No restart-animation control anywhere
- Speed slider overflows navbar, wrong color (blue, not theme olive)
- Scene order is confusing: CKKS deep-dive (encode/keygen/encrypt/decrypt) is interleaved directly into the main pipeline BEFORE the real Key Setup / Encryption / Computation scenes, so the user sees "Decrypting" before any real computation happens, and "Key setup" appears to regenerate keys that seem already made in the deep-dive. Deep-dive must be clearly separated as its own illustrative sub-chapter, not interleaved.
- No explanation of WHY secret/public keys are generated (once, up front, before any data touches them)
- Secure Transport scene has no visual of the ciphertext actually traveling client<->server
- Computation scene isn't full-screen and has its own local speed slider instead of using the universal navbar speed control; doesn't respect restart
- Result scene shows bare numbers ("1", "0", "True") with zero explanation of what they mean for the chosen model
- Benchmarks scene has no explanatory text

Fix plan:
[x] Reorder chapters: Overview -> Feature Extraction -> Key Setup (real keygen, explain why up front) -> Encryption (real) -> "How CKKS Works Internally" (deep-dive, clearly labeled as a separate illustrative walkthrough using the same data) -> Computation (full-screen, universal speed+restart) -> Secure Transport (animated client<->server packet travel) -> Decryption (real) -> Result (plain-language, model-specific label mapping) -> Benchmarks (explained)
[x] Fix equation popup: bigger box, proper text containment/wrapping, no overflow
[x] Add a small, unobtrusive universal "Restart animation" button (re-plays current scene's animation from scratch)
[x] Single universal speed control in navbar (olive-themed, properly contained) drives BOTH poly-grid reveal speed AND smoke-feed compute speed -- remove the separate local Computation-scene slider
[x] Make Computation scene fill the entire screen (not constrained to a centered card)
[x] Add animated ciphertext packet travel visual to Secure Transport scene (client -> server -> client, matching minimap direction)
[x] Rewrite Result scene: plain-language explanation of what the prediction number means for the selected model (e.g. "0 = written by a human, 1 = written by AI" for human_vs_ai_text; "0 = not spam, 1 = spam" for sms_spam), explain what "match" proves
[x] Add explanatory intro text to Benchmarks scene (what slowdown/agreement columns mean, why HE is slower)
[x] Add why-explanations to Key Setup, Secret Key, Public Key scenes (why generated once, why before any data is touched)

Phase 6G — Snek-inspired chapter flowchart + scrubber redesign
Inspiration: C:\Users\ashvi\Documents\VS_Codes\HTML\Snek (Preact compiler visualizer) -- overview flowchart of
phase boxes, dolly-zoom into a clicked phase, per-phase Scrubber (play/pause/step/step-counter/speed +
fixed-height what/why/next explanation strip + draggable step-slider with chapter ticks). Always dark, no
light/dark toggle. Every explanation must be real, driven by actual pipeline data.

[x] Part A: backend real per-step explanations -- PipelineRecorder.emit() gains why/next_step params;
    run_full_traced_pipeline_with_events()'s emit() calls filled with real why/next text per operation type
[x] Part B: shared components -- zoom_transition.js, step_slider.js, scrubber.js, scrubber.css
[x] Part C: chapter-dot minimap (rewrite minimap.js, replaces L-path SVG)
[x] Part D: chapter data model -- chapter_registry.js (replaces scene_registry.js), renderVisual adapters
    per chapter (Feature/Key/Encryption/Deep-Dive/Computation/Transport/Decryption/Result/Benchmarks)
[x] Part E: navigation/state -- chapter_state.js (replaces timeline.js), enterChapter/exitToFlowchart zoom
    orchestration, chapter-unlock gating
[x] Part F: shell rework -- scenes.html flowchart container + scrubber dock, drop top-tick-row/edge-nav,
    drop smoke_feed.js (Computation moves to scrubber step-through)
[x] Verify: existing tests still pass; manual /live walkthrough (flowchart, zoom, scrubber, minimap, both
    human_vs_ai_text and sms_spam paths) -- verified via real HTTP calls to a running dev server (all
    static assets 200, /api/infer_text returns why/next_step on all 507 events for a real sms_spam sample,
    /api/ckks_deep_dive returns real 256-coeff arrays) plus full code read-through; actual browser
    click-through (drag the step slider, watch the zoom animation, etc.) not done -- no browser in this
    environment, flagged to user

Phase 7 — Packaging
[ ] Tauri wrap around Flask/HTML frontend (decided over PyQt6+PyInstaller for animation/UI quality; keeps existing colors.css/fonts.css/component work)
Phase 6H — /live polish (docs/LIVE_UI_POLISH.md)
[x] Fix navbar overflow, poly-grid column blowup/phone, minimap placement
[x] Snake flowchart + connectors + box states + real summaries
[x] Speed dial in scrubber; restart replay
[x] Intro cards; glossary tooltips; 4-cell explanation grid
[x] Transition polish; Run spinner + inline errors; example chips; New input
[x] Split 1-step chapters using real data
[x] Phone layout (column flowchart, tabbed explanations)
[x] Verified in headless Chrome
[ ] Update ARCHITECTURE.md /live file list to match (LIVE_UI_POLISH.md authoritative meanwhile)
