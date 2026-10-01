# Kryptamet

Run a machine-learning model on data it is never allowed to see.

Kryptamet encrypts your input with **homomorphic encryption (CKKS)**, sends it to a separate compute party,
lets that party run a trained model **directly on the encrypted numbers**, and sends back an encrypted answer
that only you can decrypt. It comes with a live, step-by-step teaching interface that shows every key,
polynomial, ciphertext and tag as it is really computed, and proves in your browser that the values are real.

## Real use case

A clinic wants a diagnosis model hosted by an outside provider, but may not hand patient symptoms to a third
party. With Kryptamet's flow:

1. The clinic (data owner) turns the patient's symptoms into numbers and encrypts them with its own CKKS key.
2. The encrypted record is sealed for transport and sent to the provider (compute node).
3. The provider runs its diagnosis model on the ciphertext. It never sees the symptoms, and it never sees the
   result either: the output is still encrypted.
4. The encrypted result is sealed and sent back; only the clinic's secret key can open it.

The same pattern fits credit scoring by an outside bureau, spam filtering as a service, fraud checks, and
any "my data, your model" situation. Both parties are simulated on one machine here so every step can be shown.

## End-to-end flow

```
SERVER (data owner)                                   CLIENT (compute node)
 1. Feature extraction: input -> number vector x
 2. Key setup: CKKS keys, RSA key pairs,
    passphrase -> PBKDF2 -> AES key
 3. CKKS-encrypt x -> Enc(x)
 4. Seal Enc(x): AES-256-GCM, AES key locked
    with the client's RSA public key        ------>  5. Unseal with its RSA private key
                                                        (tag checked: any tampering is rejected)
                                                     6. Compute on ciphertext only:
                                                        Enc(score) = Enc(x) · Wᵀ + b
                                                     7. Seal Enc(score) with a fresh AES key,
 8. Unseal with its RSA private key         <------     locked with the server's RSA public key
 9. CKKS-decrypt -> score -> prediction
10. Compare with the plaintext model: must match
```

- **CKKS (homomorphic encryption)** keeps the data private *during computation*. The compute node only ever
  holds the public key, so it can calculate but cannot decrypt.
- **AES-256-GCM + RSA-OAEP** protects the ciphertext *in transit*. AES locks the large payload fast, RSA locks
  the small AES key so only the intended party can open it, and the GCM tag acts as a tamper seal: flip a
  single bit on the way and decryption fails.

## Features

- **Six live models** on real datasets:
  - SMS spam (TF-IDF)
  - Human vs AI text (stylometric)
  - German Credit risk
  - Stock price direction
  - Symptom diagnosis (41 conditions)
  - Handwritten digits (MNIST, 784 pixels)

  Each works with the model's real preprocessing, for both binary and multiclass models. An HE-compatible CNN
  for MNIST is included and benchmarked.
- **Encrypted inference that matches plaintext.** Every run compares the decrypted score to the plain model's
  score and prediction.
- **Two-party separation for real.** The compute side is rebuilt from public-key-only bytes and verified to
  hold no secret key.
- **`/live` teaching walkthrough.** A flowchart of chapters, a dolly-zoom into each one, and a scrubber
  (play/pause/step/speed) with a what/why/formal/next explanation for every step:
  - **Feature extraction:** how your text, table row, symptoms or drawing becomes numbers.
  - **Key setup:** how the RSA primes, the PBKDF2 key-stretching (as a node graph) and the SHA-256 rounds (as a
    matrix) produce every key.
  - **Encryption:** how the vector is packed into slots, scaled, turned into a polynomial matched coefficient
    for coefficient against SEAL's own encoder, and encrypted. The full ciphertext is shown, never truncated.
  - **CKKS deep-dive:** encode, keys, encrypt, homomorphic multiply, rotations and decrypt, on a from-scratch
    CKKS implementation whose final score is checked against the production result.
  - **Transport, both ways:** AES-GCM counter blocks, the AES round matrix, the GHASH tag, the RSA key wrap,
    and a live tamper test.
  - **Computation, decryption and result:** what each weight means, the real encrypted operation, and the
    final comparison.
  - **Benchmarks:** plaintext vs encrypted time, memory and agreement per model.
- **Proof, not decoration.** Every tracer is checked against a real library (hashlib, `cryptography`, SEAL)
  and fails loudly on a mismatch. The browser independently re-checks key values: WebCrypto re-derives the
  PBKDF2 key, SHA-256 hashes are recomputed, and RSA's n = p·q and e·d ≡ 1 are checked with BigInt. AES-GCM,
  the RSA-OAEP envelope, the CKKS encoding and every deep-dive polynomial are recomputed too. Each check shows as
  ✓/✕, and every chapter box on the flowchart counts the checks that ran (see `docs/LIVE_UI_TRUTH.md`).
- **Your passphrase or a random one.** Lock the transport key with your own passphrase, or let Kryptamet
  generate one; either way you see exactly how the key was derived.

## Setup

Requires Python 3.13+ and [uv](https://docs.astral.sh/uv/getting-started/installation/).

```
uv sync
uv run scripts/download.py
```

The download script fetches MNIST, SMS spam, German Credit, symptom diagnosis and price data. The human-vs-AI
dataset must be added by hand: download it from
https://www.kaggle.com/datasets/shanegerami/ai-vs-human-text and place `AI_Human.csv` in
`data/raw/human_vs_ai_text/`.

## Run

```
uv run python -m interface.app          # open http://127.0.0.1:5000/live
uv run python -m interface.cli          # command-line inference / benchmarks
uv run python -m benchmarks.metrics     # re-measure plaintext vs encrypted cost
```

Tests are plain scripts, e.g. `uv run python -m tests.test_two_party_pipeline`.
