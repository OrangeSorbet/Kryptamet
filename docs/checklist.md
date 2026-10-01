# Kryptamet checklist

Roadmap, in order (rules.md #1). Each phase ends with a working, testable checkpoint (rules.md #8).
Detail for each step lives in `docs/logs.md`, which is phase-tagged.

**Status:** Phases 0–6 done. **Phase 7 in progress** (7.1–7.3 done; next milestone: 7.4, waiting for user go).

---

## Phase 0 — Environment ✅
- [x] 0.1 Python env via `uv` (tenseal, cryptography, scikit-learn, torch, pillow, flask)
- [x] 0.2 TenSEAL round-trip check: encrypt → add → decrypt

## Phase 1 — Crypto core (`hecrypto/`) ✅
- [x] 1.1 `ckks_context.py` — CKKS context and parameters
- [x] 1.2 `keygen.py` — key generation
- [x] 1.3 `encrypt.py` / `decrypt.py`
- [x] 1.4 `transport.py` — RSA+AES hybrid wrap/unwrap
- [x] 1.5 Test: encrypted vector survives a transport round-trip (`tests.test_transport_roundtrip`)

## Phase 2 — Data prep ✅
- [x] 2.1 Datasets acquired: 5 scripted (`scripts/download.py`), 1 manual (human_vs_ai_text)
- [x] 2.2 Per-dataset loaders (`data/loaders/`)
- [x] 2.3 Feature extraction: image (MNIST), stylometric (text), TF-IDF (SMS)

## Phase 3 — Model training (plaintext baselines) ✅
- [x] 3.1 Logistic regression, one module per dataset (5 datasets)
- [x] 3.2 Small CNN for MNIST (PyTorch)
- [x] 3.3 Trained models saved to `models/saved/`

## Phase 4 — HE inference ✅
- [x] 4.1 `he_infer.py` — encrypted logistic regression (5 models)
- [x] 4.2 HE output matches the plaintext baseline, within tolerance
- [x] 4.3 HE-compatible CNN: square activation, avgpool, retrained (0.9853 vs 0.9814 baseline)
- [x] 4.4 `he_cnn_infer.py` — encrypted CNN inference, 3/3 samples match plaintext

## Phase 5 — Benchmarking ✅
- [x] 5.1 `benchmarks/metrics.py` — time, memory, accuracy per model/dataset → `results.json`
- [x] 5.2 Plaintext vs HE cost for all 5 logreg models + `mnist_cnn_he`

## Phase 6 — `/live` teaching UI ✅
History of the earlier tabbed dashboard and full-screen scene builds; both were superseded.
Current design: `docs/LIVE_UI_POLISH.md`.
- [x] 6.1 Backend event trace: `run_full_traced_pipeline_with_events` + `/api/infer_text`, with real per-step why/next/formal text
- [x] 6.2 From-scratch CKKS for internals TenSEAL hides (`crypto_teaching/real_ckks.py`, N=256) + `/api/ckks_deep_dive`
- [x] 6.3 Chapter order fixed (deep-dive no longer interleaved); result/benchmark explanations added
- [x] 6.4 Snek-style shell: flowchart → dolly-zoom → Scrubber → step slider → chapter minimap
- [x] 6.5 Polish: snake flowchart, speed dial, intro cards, glossary, transitions, phone layout, multi-step chapters
- [x] 6.6 Dead code from earlier builds removed (index.html, sections/, pipeline_animations.js, smoke_feed, timeline)
- [x] 6.7 Verified in headless Chrome: both models, desktop and phone, no console errors

## Phase 7 — Truthful `/live`: real, verifiable content + two-party flow ⏳
Plan: `~/.claude/plans/serene-dazzling-spindle.md`. Doc on completion: `docs/LIVE_UI_TRUTH.md`.
Flow: server features → keys → CKKS encrypt → wrap (client RSA pub) → transport → client unwrap →
HE compute → wrap (server RSA pub) → transport → server unwrap → CKKS decrypt → result.

- [x] 7.1 **Tracers + asserts** (`hecrypto/`). Each tracer checks itself against the real library:
    - [x] `pbkdf2_trace.py` — random salt, ipad/opad, U-chain samples, traced SHA-256 compression; == `hashlib`
    - [x] `rsa_trace.py` — p, q, n, e, d, λ for both parties; n = p·q, e·d ≡ 1 (mod λ)
    - [x] `aes_trace.py` — AES-256 block-1 rounds (4×4 state), CBC chain, PKCS7; == `cryptography`
    - [x] `ckks_encode_trace.py` — N=8192 slot packing, Δ-scaling, σ⁻¹ coefficients, RNS primes, size breakdown
    - [x] `ckks_math.py` (moved from `crypto_teaching/real_ckks.py`) — mul_plain, add_plain, rotate (key-switching), full w·x+b
    - [x] `transport.py` — optional AES key, random salt, full payloads, SHA-256 before/after
    - [x] Tests pass: `test_pbkdf2_rsa_trace`, `test_aes_trace`, `test_ckks_math`, `test_ckks_encode_trace`, `test_transport_roundtrip`
- [x] 7.2 Pipeline rebuild: two-party events, model registry (6 models incl. new `mnist_logreg`), `/api/models`, full ciphertexts, per-term why + captions, random passphrase default
    - [x] `inference/model_registry.py` + featurizers (`data/features/{tfidf,tabular,symptoms}.py`), stylometric trace == model input
    - [x] `models/train/mnist_logreg.py` (test acc 0.9267) + benchmark row
    - [x] `run_two_party_pipeline` (client computes on a public-only context) + `hecrypto/evaluate.py`
    - [x] `app.py`: `/api/models`, `/api/infer` (`/api/infer_text` alias), generic deep-dive
    - [x] Frontend kept working on the new response (full ciphertexts in 10-line scroll boxes, both transport legs); new-model input panels are 7.7
- [x] 7.3 Key Setup + Transport chapters + AES-GCM
    - [x] Transport switches AES-256-CBC → AES-256-GCM (16-byte tag = tamper seal); GCM tracer (counter blocks, keystream, GHASH, tag) checked against `cryptography`; live tamper test (1 flipped bit → rejected)
    - [x] Key Setup: 17 steps (browser re-checks RSA, ipad/opad, SHA-256 schedule + rounds, PBKDF2 via WebCrypto), "Use random passphrase" next to "Lock with my passphrase", PBKDF2 node graph, nested dolly zoom into the SHA-256 round matrix
    - [x] Transport split into "Transport → client" and "Transport ← server": 14 steps each, including a nested zoom into AES_K, all 14 rounds as 4×4 matrices, the S-box, GHASH/tag, the opened RSA-OAEP envelope and the tamper test. The browser recomputes all of it (`aes_check.js`) and WebCrypto-decrypts the full wire payload. The flowchart has 10 chapters.
    - [x] README rewritten: features, end-to-end flow, real use case (no folder structure); describes the Phase 7 target, re-verified in 7.8
- [ ] 7.4 Encryption chapter (~9 algorithm steps to the full ciphertext). Note: TenSEAL replicates x cyclically across all 4096 slots (not zero-padded); m(X) matches SEAL's encoder exactly
- [ ] 7.5 CKKS deep-dive: evaluation before decrypt, per-matrix grid controls, "Real CKKS" → "CKKS"; send Q=2⁶⁰ coefficients as strings (they exceed JS safe-int 2⁵³) and display with BigInt
- [ ] 7.6 Computation: general form first, non-zero terms with faded value captions, zero terms collapsed
- [ ] 7.7 Remove the remaining inline `style=""` attributes in scenes.html and older chapter builders (rules.md #2); Next → next phase (zoom out/in), 10-line scrollable full ciphertext boxes, in-browser proof badges, new model inputs
- [ ] 7.8 Docs: `LIVE_UI_TRUTH.md`, `ARCHITECTURE.md` refresh (incl. the old 6.5 file-list item), `CLAUDE.md` pointer; re-check every README feature claim against the finished app
- [ ] 7.9 Verify: all tests + headless Chrome for every model, desktop + phone, every proof badge ✓

## Phase 8 — GPU-accelerated encrypted CNN (after Phase 7)
Target machine: the user's second PC with an RTX 5060 Ti (CUDA). TenSEAL/SEAL is CPU-only, so this needs a CUDA CKKS library.
- [ ] 8.1 Evaluate CUDA CKKS libraries (e.g. Phantom, HEonGPU) for Python bindings, CKKS conv/matmul support, and Windows/RTX 50-series support
- [ ] 8.2 GPU backend for the HE-CNN only, in `hecrypto/`, alongside TenSEAL (the logreg models stay on TenSEAL)
- [ ] 8.3 Verify the GPU CNN matches plaintext predictions; benchmark against the CPU path (~767 s for 3 images today)
- [ ] 8.4 Optional: expose the MNIST CNN in `/live` if a run drops to a few seconds
