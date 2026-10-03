# /live: what is real and how it is checked

Phase 7 rebuilt the `/live` teaching UI around one rule: every number on screen is computed for your request,
and wherever possible your browser re-computes it independently. This file lists, chapter by chapter, where
each value comes from and what the browser checks. It also lists the honest limits.

For module structure see `ARCHITECTURE.md`; for the build history see `logs.md` (Phase 6I/7).

## The flow

Two parties are simulated in one Flask process, so every step can be shown:

```
CLIENT (data owner)                                   SERVER (compute node)
 1. Feature extraction: input -> x
 2. Key setup: CKKS keys, 2 RSA-2048 pairs,
    passphrase -> PBKDF2 -> AES key
 3. CKKS-encrypt x -> Enc(x)
 4. Seal: AES-256-GCM + RSA-OAEP (server key) ---->  5. Unseal (GCM tag checked)
                                                     6. Enc(score) = Enc(x)·Wᵀ + b on a context
                                                        rebuilt from public-only bytes
 8. Unseal (client key)                       <----  7. Seal with a fresh random AES key
 9. CKKS-decrypt -> score -> prediction
10. Compare with the plaintext model
```

CKKS is the inner layer and AES/RSA the outer layer, because the server must compute on the CKKS ciphertext;
nothing can be computed on AES or RSA bytes.

## Where the data comes from

- `POST /api/infer` (`interface/app.py`) runs `inference/he_infer.py::run_two_party_pipeline`, which records
  one event per real operation (`inference/pipeline_events.py`). Each event carries `description`, `why`,
  `formal`, `next_step`, the acting `party` and its real data.
- Every tracer in `hecrypto/` recomputes an operation step by step **and asserts it equals the real
  library**, raising on a mismatch:
  - `pbkdf2_trace.py` (hashlib, `cryptography`)
  - `aes_trace.py` (AES-GCM from `cryptography`)
  - `rsa_trace.py` (the key's own private numbers)
  - `ckks_encode_trace.py` (SEAL's encoder and primes)
- `POST /api/ckks_deep_dive` runs `hecrypto/ckks_math.py`, a from-scratch CKKS (N=256, q=2⁶⁰), on the same
  input and weights.
- Ciphertexts are sent in full (base64), never truncated. The CKKS public context with Galois keys (~35 MB)
  is the one exception: only its size and SHA-256 are sent.
- Private keys and the passphrase **are sent to the browser on purpose**: both parties are simulated, and the
  browser needs them to re-check the crypto. A real deployment would never do this.

## What the browser re-checks, per chapter

Every check renders as a ✓/✕ chip. The flowchart box of each chapter you watched shows the count
("✓ N browser checks" or "✕ k of N failed"). The counter covers only checks that finished while the step was
on screen; a check still running is not counted.

| Chapter | Browser checks (all computed in JS, BigInt or WebCrypto) |
|---|---|
| Feature Extraction | MNIST: every x_i = float32(pixel_i / 255), exactly, all 784. Other models show the backend's traced computation. |
| Key Setup | **Both RSA keys:** Fermat tests on p and q, p·q = n, λ(n) = lcm(p−1, q−1), gcd(e, λ) = 1, e·d ≡ 1 (mod λ), the CRT values. **HMAC/SHA-256:** the ipad/opad blocks, the SHA-256 message schedule and rounds (`sha256_check.js`). **PBKDF2:** the chain and XOR accumulator, then WebCrypto re-derives the AES key from the passphrase and salt. |
| Encryption | **Packing and scaling:** the slot packing rule; Δ-rounding. **Polynomial:** m(X) evaluated at all 4096 slot roots gives x back (re-embedding). **RNS:** Miller–Rabin and q ≡ 1 (mod 2N) for each prime; all residues with BigInt. **Bytes:** the TenSEAL/SEAL/zstd header bytes, field by field; WebCrypto SHA-256 of the full ciphertext = the leg-1 payload (`encrypt_check.js`). **Sanity check** (a ✓ on step 2.7, not a protocol step): the client's one-off decryption of its fresh ciphertext. Noise and decoded slots are re-checked. |
| "Up close" parts (Encryption, Computation, Result) | **Exact mod 2⁶⁰:** b ≡ −a·s + e, c0 ≡ b·u + e1 + m, c1 ≡ a·u + e2, c·ŵ, the bias add, m′ ≡ c0 + c1·s. **Decryption:** decoding gives x and w back; after the multiply, the chunk sum and every rotation, the decrypted slots equal sums computed from plaintext x and w. **Rotations:** each Galois element = 5ᵏ mod 2N. **Final score:** equals the client's decode, the plaintext score and TenSEAL's score (`deep_dive_check.js`). |
| Transport → server / ← client | **AES-256-GCM, recomputed** (`aes_check.js`): the S-box, the key schedule, every stage of all 14 rounds, counters, keystream, the GHASH steps (GF(2¹²⁸) with BigInt), and the tag. **RSA-OAEP:** c^d mod n, then MGF1 unmasking (lHash, zero padding, 01 separator, key). **WebCrypto:** imports the private key, decrypts the AES key, AES-GCM-decrypts the full payload, and checks its SHA-256 = the ciphertext sent. **Tamper test:** the client's exact flipped ciphertext bit and flipped tag bit are both rejected. **Keys:** the leg-1 key = PBKDF2 output; the leg-2 key ≠ the leg-1 key. |
| Computation | **Op:** input SHA-256 = the leg-1 unwrap; the server context holds no secret key. **Output:** WebCrypto SHA-256 of the full output ciphertext = the leg-2 payload. **Terms:** each term's x = the encrypted value, product and running sum recomputed; the smaller terms re-summed; zero count; bias sum = the plaintext score ≈ the decrypted HE score (`computation_steps.js`). |
| Result | The decrypted HE score vs the plaintext score and prediction (computed by the client, shown with the difference). |
| How HE works | No checks: toy numbers computed live from the toy formulas (q = 10007, Δ = 1000, s = 3), labelled as toy. |
| Benchmarks | Saved measurements from `benchmarks/results.json` (`uv run python -m benchmarks.metrics`), not measured per request. |

## Explanation text

Each step's what/why/formal/next text is one of two kinds:
- **Backend text:** emitted with the real event, with real values and rank-based reasoning for each weight.
- **Frontend text:** built from the real response (counts, sizes, errors, check results).

There is no placeholder or example text. Fixed text exists only where the fact itself is fixed: glossary
definitions, chapter intros, and the "why" of a mathematical step.

**ELI1 toy numbers** are labelled as toys and computed in JS from small fixed inputs (e.g. RSA with p = 5,
q = 11; the `TOY` CKKS with q = 10007). Where a toy can use a real value (the first byte of K, the first
pixel, the S-box lookup of this run's state byte), it does. **Source links** point only at values a step
declared in `step.facts`, so a link always lands on the step that produced the value.

## Limits, stated honestly

- **One process, two roles.** Client and server run in the same Flask process. The separation is real in
  data (the server context is rebuilt from public bytes and asserted `is_private() == False`), not in
  deployment.
- **Teaching mirror.** The per-term Computation steps replay the traced row in plaintext; the server itself
  ran only the single encrypted operation `Enc(x)·Wᵀ + b`. The steps are labelled "[plaintext mirror]".
- **Hidden encryption randomness.** TenSEAL does not expose u and e for the production ciphertext. The
  Encryption chapter shows c0/c1 and the equation, and the Deep-Dive shows u and e on the N=256 scheme.
- **Toy deep-dive parameters.** The Deep-Dive uses N=256 and one modulus q = 2⁶⁰ (no RNS, no rescaling). The
  production path uses N=8192 and three primes.
- **Multiclass deep-dive.** The deep-dive traces only the row of the predicted class.
- **WebCrypto needs a secure context.** It is available on `127.0.0.1`/`localhost` or HTTPS. Elsewhere those
  checks show ✕ with the reason.
- **No live CNN.** The HE CNN (`mnist_cnn_he`) is benchmarked but not offered live (~256 s per image in `benchmarks/results.json`, and it
  decrypts between layers). Phase 8 targets a GPU backend for it.
- **Handwriting is re-drawn in the browser.** The drawing strip (`digit_canvas.js`) keeps vector strokes.
  Strokes whose horizontal extents overlap form one character (`groupStrokes`).
  - Each character is re-rendered the way its dataset framed images (`renderGlyph`), with settings from the
    registry:
    - drawn at 4× with an even pen of a fixed share of the box
    - softened
    - averaged down to 28×28
  - MNIST: box 20, centred by centre of mass, pen 0.10, blur 0.3.
  - EMNIST: box 24, centred on the bounding box, pen 0.12, no blur.
  - The settings were calibrated on re-drawn real test characters. The "sends" row shows exactly the
    784-pixel images that are sent and checked. Sample words are real test images sent unchanged.
- **Every drawn character is traced in full.** `/api/infer` runs the whole two-party pipeline once per
  character. Each run has its own keys, ciphertexts, transport legs, events and browser checks; a typed
  passphrase is shared, otherwise every run draws its own. Chips at the top left (`char_switch.js`) switch
  every chapter, the deep-dive (fetched per character) and the proof badges to the chosen character. The
  Result chapter shows every character's decrypted class against the plaintext class.
- **EMNIST merges look-alike cases.** The balanced split has 47 classes. c, i, j, k, l, m, o, p, s, u, v, w,
  x, y and z are one class with their capitals, so "hello" can read as "heLLO". A logistic regression on
  EMNIST is much weaker than on MNIST: about 67-68% on real and on drawn-style test characters. It is
  trained on the real images plus copies re-drawn the way the strip draws (`data/features/glyph_redraw.py`;
  augmentation derived from real data). There are no symbols.
- **"Read as" restricts classes after decryption.** It lets the client pick only digits or only letters.
  All 47 scores are still computed and decrypted; the argmax and softmax run over the allowed classes. The
  Result cards show each character's top-3 from its decrypted scores.
- **German Credit code meanings** shown in the input panel come from the dataset's documentation (UCI Statlog
  `german.doc`, `data/loaders/german_credit.py` `CODE_MEANINGS`). The model receives only the A-codes.
