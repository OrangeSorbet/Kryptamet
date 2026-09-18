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
[ ] Benchmark mnist_cnn_he (plaintext vs HE inference cost, time + memory, deferred until after Phase 6)

Phase 6 — Interface
[x] colors.*, fonts.* global sheets
[x] Reusable components (no inline in app.py)
[x] CLI (cli.py) first
[x] Flask page (app.py) composing components only — functional baseline (superseded by Phase 6B below)

Phase 6B — Educational Pipeline Visualization (full rebuild of result display)
Goal: every stage of the HE pipeline is visible, explained, and animated — teacher must understand HOW homomorphic encryption works, not just see a pass/fail.

[ ] Expose intermediate pipeline data (not just final float) from inference layer:
    [x] inference/he_infer.py: return dict with plaintext_input, serialized_ciphertext_input (bytes), ciphertext_size_bytes, serialized_ciphertext_output (bytes), decrypted_result — not just final score
    [ ] Same for inference/he_cnn_infer.py (per-layer: conv output ciphertext, activation, pooled result)

[x] Backend: interface/app.py exposes full pipeline trace per inference call (as JSON to template, one object per stage)

[ ] Frontend: split into modular template files, one per concept (interface/templates/sections/):
    [x] 01_intro.html
    [x] 02_plaintext_input.html
    [x] 03_key_generation.html
    [x] 04_encryption.html
    [x] 05_transport.html
    [x] 06_encrypted_computation.html
    [x] 07_decryption.html
    [x] 08_validation.html
    [x] 09_benchmarks.html
    [ ] 10_cnn_deep_dive.html — optional expandable section: per-layer walkthrough of encrypted CNN (conv2d_im2col, square activation, avgpool) for MNIST

[ ] Each section component includes: (a) short explanation text (what/why/how), (b) a visual/diagram or live data render, (c) animation on reveal/scroll

[x] Add animation library: GSAP (CDN) chosen for scroll-triggered reveals
[x] Add interface/static/js/pipeline_animations.js — staged reveal animation, ciphertext scramble-reveal text-effect
[x] Update components.css: step-connector/flow-diagram styles, ciphertext-display monospace styling

[x] Update interface/templates/index.html to orchestrate all sections in a scrollable step-by-step narrative

[ ] Test: full pipeline trace renders correctly for at least 1 logreg model (sms_spam) and CNN (mnist) end to end

Phase 6C — Interactive Live Pipeline Visualizer (full redesign)
Problem identified: scroll-based 10-section static page is unreadable, uses fake sample-index input instead of real data entry, and doesn't visually show the model's internal operations on the encrypted data. Needs to become a real interactive tool.

Core requirements:
- Custom data entry per model (real sentence, real symptoms, real loan fields, etc.) — no index picking
- Every internal model operation (each weight multiply, each sum, each activation) visible as it happens on the encrypted data — not just "input -> black box -> output"
- Tab-based navigation (Encryption / Computation / Transport / Decryption / Benchmarks), not one long scroll
- Real-time animated data-flow diagram: object moves through pipeline nodes visually, user can see it happen
- Speed control slider (slow motion educational walkthrough -> fast)
- Step-by-step mode: user clicks "next" to advance one operation at a time, sees the ciphertext/state at each step
- Instant mode: toggle to skip all animation, run full pipeline immediately, show final result only

[ ] Architecture design:
    [ ] Define a PipelineEvent format: {stage, operation_name, description, data_before, data_after, timestamp} — every discrete operation (encrypt, each multiply, each add, activation, decrypt) emits one event
    [x] Backend: instrument inference/he_infer.py to emit a full ordered list of PipelineEvents (507 real events verified for sms_spam) — he_cnn_infer.py pending
    [x] Flask endpoint returns the full event list as JSON (not rendered HTML) — /api/infer_text created

[ ] Custom data entry per dataset (replaces index selector):
    [x] human_vs_ai_text: free-text textarea (backend wired via /api/infer_text)
    [x] sms_spam: free-text textarea (backend wired via /api/infer_text)
    [ ] german_credit: real form fields (amount, duration, purpose, etc.)
    [ ] symptom_diagnosis: checkbox list of actual symptom names
    [ ] price_data: numeric Open/High/Low/Volume inputs
    [ ] Each maps through the same feature-extraction code already in data/features/ and data/loaders/ before encryption

[ ] Frontend rebuild (tab-based, not scroll-based):
    [ ] Tab: Overview — what is HE, one diagram, dataset/model picker + custom input form
    [ ] Tab: Encryption — animated plaintext -> ciphertext transformation for the entered input
    [ ] Tab: Computation — the core visual: animated node graph showing each weight multiply + running sum as it happens on ciphertext, values shown as ciphertext blobs, not plaintext, until decrypt
    [ ] Tab: Transport — animated RSA+AES wrap/unwrap of the ciphertext packet
    [ ] Tab: Decryption — reveal animation, decrypted result shown, compared to plaintext baseline
    [ ] Tab: Benchmarks — existing table, kept as-is

[ ] Playback controls (shared across tabs):
    [ ] Speed slider (0.25x - 4x)
    [ ] Step-by-step mode: "Next Step" / "Previous Step" buttons, freezes animation, shows current PipelineEvent detail panel
    [ ] Instant mode toggle: skips animation entirely, jumps to final state, still shows all data (not hidden, just not animated)
    [ ] Play/Pause for auto-advancing animated mode

[ ] Visualization engine:
    [x] Decision: scrolling log-feed visualization instead of node-graph — real operation lines (e.g. "w[42]=0.0231 x x[42]=1.0 -> 0.0231", "running_sum = -1.842") scroll past vertically, one per actual computation step (all 500+ real steps included, no batching/faking)
    [ ] Speed slider controls scroll velocity of the feed (slow = readable one at a time, fast = blurred rapid scroll), not the number of steps shown — all real steps always present
    [ ] Ciphertext-stage steps (encrypt/decrypt) shown as scrambled hex text in the same feed styling

[ ] Test end to end: enter a real sentence for human_vs_ai_text, watch full animated pipeline in step mode and instant mode, verify decrypted result matches plaintext prediction

Phase 7 — Packaging
[ ] Tauri wrap around Flask/HTML frontend (decided over PyQt6+PyInstaller for animation/UI quality; keeps existing colors.css/fonts.css/component work)