# Kryptamet checklist

Roadmap, in order (rules.md #1). Each phase ends with a working, testable checkpoint (rules.md #8).
Detail for each step lives in `docs/logs.md`, which is phase-tagged.

**Status:** Phases 0–7 and 7B done. Phase 7C (the course rewrite, from the user's issues.md) is in progress. Phase 8 stays gated on the second PC's config.

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

## Phase 7 — Truthful `/live`: real, verifiable content + two-party flow ✅
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
- [x] 7.4 Encryption chapter: 10 steps (plaintext, pipeline graph, 4096-slot packing grid, Δ-scaling, σ⁻¹ to all 8192 coefficients of m(X), RNS primes + residues, the encryption equation with c0/c1, serialization header, full ciphertext + SHA-256, decryption round trip). TenSEAL replicates x cyclically across all 4096 slots (not zero-padded). The browser re-checks every stage (`encrypt_check.js`): packing rule, Δ-rounding, m(X) evaluated at all 4096 slot roots gives x back, Miller–Rabin + q ≡ 1 mod 2N, BigInt residues, the TenSEAL/SEAL/zstd header bytes, WebCrypto SHA-256 == the leg-1 payload, round-trip noise
- [x] 7.5 CKKS deep-dive: 18 steps (17 when x fits one chunk) in pipeline order: encode x, s, (a, b), c0, c1, encode w, × ŵ, chunk sum, 7 rotate-and-add rounds (one step each), + bias, decrypt, decode vs plaintext and TenSEAL. Coefficients are sent as decimal strings; the browser (`deep_dive_check.js`) re-checks every relation exactly with BigInt mod 2⁶⁰ and decrypts after every evaluation step, comparing the slots with sums it computes from x and w. The chunk shown is the one with the most non-zero inputs. Per-grid controls (`grid_controls.js`: ▶/❚❚, ‹ › cell, ↺, own speed `kryptamet.gridSpeed`, exact-value readout); the Scrubber's speed is `window.stepSpeed`. "Real CKKS" → "CKKS"
- [x] 7.6 Computation: overview (what the client has / never has), the real Enc(x)·Wᵀ + b first, then the non-zero terms largest first (top 20 one step each with faded value captions under w, x and w·x; the rest summed in one `smaller_terms` step), zero terms collapsed, bias. A waterfall SVG shows how every term moves the score. The browser re-checks each term against the encrypted x, the running sums, the zero count, the bias sum, plaintext and decrypted scores, and SHA-256 of the full output ciphertext = the leg-2 payload (`computation_steps.js`)
- [x] 7.7 Inline styles, Next → next chapter, proof badges, all six models
    - [x] No `style=""` attributes left in scenes.html or JS templates (rules.md #2): `hidden` attribute + `[hidden]` rule, classes, geometry applied by JS after render
    - [x] Next on a chapter's last step (button or →) zooms out and into the next available chapter; autoplay waits for a running step animation before advancing
    - [x] 10-line scrollable full ciphertext boxes (done in 7.2)
    - [x] Proof badges: each flowchart box shows "✓ N browser checks" (or "✕ k of N failed"), counted from the checks that ran while you watched
    - [x] Input panels for every registry model (`/api/models`): text, tabular (real test rows, editable fields), symptoms (filterable chips, real test cases), MNIST (28×28 drawing canvas, real test images); Feature chapter covers tabular, symptom and pixel inputs
- [x] 7.8 Docs: new `LIVE_UI_TRUTH.md` (flow, data sources, per-chapter browser checks, limits); `ARCHITECTURE.md` rewritten for the current code (incl. the old 6.5 file-list item); `CLAUDE.md` pointer + flow order; README claims re-checked: Benchmarks now really shows peak memory, proof badges added. Dead code removed (`run_traced_inference`, `run_full_traced_pipeline`)
- [x] 7.9 Verify: all 9 test files pass (incl. the encrypted CNN, 3/3); headless Chrome for all 6 models at 1440×900 and 390×844, every chapter's every step, chapters chained by Next, every proof badge ✓ (792 browser checks per viewport, 0 failed), no console errors

## Phase 7B — Clarity pass (user review, 2026-10-03) ✅
Every model (7), every chapter. One milestone at a time; ask before each.
- [x] 7.10 **Matrices everywhere behave the same.** Every matrix or grid (byte rows, AES 4×4 states, SHA-256 rounds, ipad/opad, poly grids, slot grid, residues, …):
    - hover a cell → its formula popup, drawn in a layer that is never clipped
    - animated ones get the same ▶/❚❚ ‹ › ↺ speed controls as the CKKS grids
    - containers show the whole matrix instead of a small inner scroll box
    - the public-key grids are aligned (centred, under their labels)
    - native `title` tooltips are removed everywhere except the underlined glossary words
- [x] 7.11 **Split screen for every graph inside a chapter** (PBKDF2, the Encryption pipeline, AES-GCM CTR, …). This replaces the nested dolly zoom (`sub_zoom.js`).
    - right: the graph with the current node highlighted
    - left: that node's inner content
    - steps are numbered by the graph's flow: the graph step is N, its nodes N.1, N.2, … (e.g. Key Setup 7 → 7.1 passphrase, 7.2 bytes + salt, …)
    - the Encryption chapter's "decryption round trip" stops being a step (it is a sanity check, not part of the protocol) and becomes a ✓ on the ciphertext step
- [x] 7.12 **ELI5 / Advanced explanations.** A navbar switch, changeable any time and remembered. Every explanation (Scrubber what/why/formal/next, intro cards, captions) has both levels, built from the real run's values.
- [x] 7.13 **Character switcher (MNIST / EMNIST).**
    - Every drawn character gets its own full traced run.
    - Chips in the chapter bar pick which character every chapter shows.
    - Proof badges count per character; the deep-dive is fetched per character on demand.
- [x] 7.15 **Roles + send/receive chart** (asked during 7.14).
    - The client is the end user (input, CKKS secret key, final decryption) and the server is the compute node. That is the standard naming; it was swapped before.
    - Swapped in the backend events, every chapter's text (ELI5 + Advanced), the primers, the docs and the tests. "Transport → server" / "Transport ← client".
    - New `sequence_chart.js`: two lifelines, one arrow per network message with its real size, what each side holds. It replaces Key Setup's "Who holds which key" (key exchange highlighted) and sits in Transport step 1 (that leg highlighted).
- [x] 7.14 Verify all 7 models × desktop/phone (every chapter, every step, both explanation levels, every character); update ARCHITECTURE / LIVE_UI_TRUTH / README.

## Phase 7C — `/live` as a course on HE (user's issues.md, 2026-10-03)
Goal: a reader with zero background understands every step, and why it happens, without ever getting stuck. ELI5:
- plain words and analogies; every symbol labelled; every acronym and jargon word explained via dotted-underline hover definitions, used freely, even redundantly
- each step says what / why / how (real values, every number traced to its source) / significance
- no "browser did X" narration; checks stay as ✓ badges
Three levels (navbar switch):
- **ELI1:** toy numbers. Every hard idea is worked by hand with tiny values (e.g. RSA with p=5, q=11), then "the real run does exactly this with huge numbers".
- **ELI5:** plain words, analogies, the real values.
- **Advanced:** exact maths for practitioners.

**Source links:** any number made in an earlier step is underlined and glowing.
- Hover: a preview card (value, which step made it, how).
- Click: jumps there and pulses the number.
- A "↩ Back to step N.M" pill in the navbar returns, with a stack for chained jumps; Esc also works.
- Backed by a per-run facts registry (value → chapter/step).

Standard kept in memory: eli5-course-standard.
- [x] 7C.1 **Fixes:**
    - popups show the value as plain text with its meaning underneath
    - the split-view graph has a fixed size (only the left half scales)
    - "In one line" → "Significance"
    - the 14 AES rounds get the shared ▶ ❚❚ ‹ › ↺ controls
    - no needless inner scroll boxes (e.g. RSA-OAEP EM/DB)
    - the S-box comes before the rounds
    - the m(X) grid vs "all 8192 coefficients" mismatch is investigated and fixed
- [x] 7C.2 **Restructure:**
    - new chapter 0 "How HE works" (theory with toy numbers: locks, noise, why the same input encrypts differently, how maths survives encryption)
    - each transport chapter in two halves: the sender seals (AES, then RSA) → wire → the receiver opens (RSA decrypt → AES key, AES-GCM decrypt → CKKS ciphertext)
    - Decryption merged into Result, which starts with the real CKKS decryption
    - must-say facts (from the walkthrough with the user):
      - Key Setup: why a CKKS public key exists, and that symmetric encryption would also work here; that the server needs only the helper keys
      - Result: the server's output stays locked; the server never sees the score; you decrypt once, at the end; softmax runs after decryption because e^x isn't add/multiply
      - Encryption: why 2⁴⁰; m(X) = m₀ + m₁X + … + m₈₁₉₁X⁸¹⁹¹ (mod X⁸¹⁹² + 1); how the noise cancels (c0 + c1·s = m + small); why u and e exist
    - the Deep-Dive is split into the chapters it explains: encode/keys/encrypt → Encryption, multiply/rotate/bias → Computation, decrypt/decode → Result. No separate chapter remains.
    - third level ELI1 in the navbar switch (`eli1` twins; falls back to ELI5 until each chapter's rewrite adds them)
    - source-link machinery: facts registry, glowing links, hover preview, jump + pulse, the back-pill stack
- [x] 7C.3 Rewrite Feature Extraction + Key Setup as course text (ELI1 + ELI5 + Advanced): CKKS parameters, RSA p/q/λ/e/d with a toy example, ipad/opad, SHA-256 blocks/schedule/rounds, where every value comes from
- [x] 7C.4 Rewrite Encryption: slots, scale, m(X), RNS, c0/c1 with every variable defined, the serialization fields
- [x] 7C.5 Rewrite both Transport chapters: AES key schedule, counter mode, rounds, S-box, keystream, GHASH/tag, RSA-OAEP (EM, DB, MGF1)
- [x] 7C.6 Rewrite Computation, Result, Benchmarks and the "Up close" parts (the former appendix, now split into Encryption/Computation/Result)
- [x] 7C.7 Verify all 7 models × both levels × desktop/phone; docs

## Phase 7D — Deploy on Vercel (user request, 2026-10-03)
- [x] Runtime-only `requirements.txt`; `index.py` entry point; `vercel.json` (maxDuration 300, build step, excludeFiles); `.vercelignore` (hides pyproject.toml/uv.lock and the large datasets)
- [x] Static files to `public/static` at build time (`scripts/vercel_build.py`)
- [x] Runtime data in git (small CSVs); handwriting samples precomputed (`scripts/build_samples.py` → `data/samples/word_samples.json`, registry fallback)
- [x] 4.5 MB response limit: `/api/infer` traces one character per request (`char`); summary from untraced HE `encrypted_scores`; the frontend fetches other characters when their chip is picked
- [x] First real deploy by the user (Vercel account), 2026-10-03

## Phase 8 — GPU-accelerated encrypted CNN (after Phase 7) — FUTURE SCOPE (user decision, 2026-10-03; not part of the delivered project)
Target machine: the user's second PC with an RTX 5060 Ti (CUDA). TenSEAL/SEAL is CPU-only, so this needs a CUDA CKKS library.
**Gate:** do not start any Phase 8 step on a bare "go". It starts only after the user sends that PC's actual config (GPU, driver/CUDA version, OS, Python, RAM).
- [ ] 8.1 Evaluate CUDA CKKS libraries (e.g. Phantom, HEonGPU) for Python bindings, CKKS conv/matmul support, and Windows/RTX 50-series support
- [ ] 8.2 GPU backend for the HE-CNN only, in `hecrypto/`, alongside TenSEAL (the logreg models stay on TenSEAL)
- [ ] 8.3 Verify the GPU CNN matches plaintext predictions; benchmark against the CPU path (~767 s for 3 images today)
- [ ] 8.4 Optional: expose the MNIST CNN in `/live` if a run drops to a few seconds
