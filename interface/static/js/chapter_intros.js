// Theory primer for each chapter (and one for the flowchart itself), shown
// by intro_card.js the first time a chapter is opened. Same shape as Snek's
// messages/intro.ts INTRO_CARDS. Each entry is a fixed, factual description
// of what that pipeline stage does -- per-run values live in the Scrubber
// steps, not here.
const CHAPTER_INTROS = {
    flowchart: {
        title: "How to use this walkthrough",
        sections: [
            ["What you're looking at", "Each box is one real stage of the pipeline that just ran on your input, in order. Everything inside is taken from that run -- real feature values, real ciphertext bytes, real scores."],
            ["Navigating", "Click a box to zoom into it. Inside, the bottom bar steps through what happened: ▶ plays, ‹ › step, drag the track to scrub, ⚡ sets the speed. Keyboard: Space play/pause, ← → step, Esc back to this overview."],
            ["Progress", "A box turns green with a ✓ once you've seen its last step. Dotted-underlined words in the explanations have a definition on hover."],
        ],
    },
    feature: {
        title: "Feature Extraction",
        io: "your text → a vector of numbers",
        sections: [
            ["What this stage does", "Turns your sentence into a fixed-length list of numbers the model was trained on: 8 stylometric statistics (word counts, average lengths, punctuation ratio, ...) for Human vs AI, or a TF-IDF vector over the training vocabulary for SMS Spam."],
            ["Why it comes first", "A model can only multiply and add numbers. Encryption also works on numbers, so the text has to become a vector before anything can be encrypted."],
        ],
    },
    key: {
        title: "Key Setup",
        io: "random numbers + a passphrase → CKKS keys, 2 RSA keypairs, 1 AES key",
        sections: [
            ["What this stage does", "Creates every key the pipeline uses, step by step. The server makes the CKKS keys (it keeps the secret one) and an RSA keypair; the client makes its own RSA keypair. Then a passphrase -- yours, or a random one -- is stretched by PBKDF2 into the AES-256 key that protects the first network trip."],
            ["What you will see", "The real primes and exponents of both RSA keys, re-checked in your browser. PBKDF2 as a graph of nodes, with the key flowing through it. A zoom into one node shows the SHA-256 compression inside HMAC as matrices, round by round. At the end your browser re-derives the same AES key on its own."],
            ["Why it comes first", "Every later step depends on these exact keys. A key generated later wouldn't match the ciphertext or the wrapped envelopes."],
        ],
    },
    encrypt: {
        title: "Encryption",
        io: "feature vector → one CKKS ciphertext",
        sections: [
            ["What this stage does", "The server packs the whole feature vector into the slots of a single CKKS ciphertext using the public key. The result is a few hundred kilobytes of bytes that look random."],
            ["What you will see", "Every stage of the real encryption: the vector repeated across all slots, scaling to integers, the polynomial m(X) (all of its coefficients), its residues modulo three primes, the two ciphertext polynomials, the serialized bytes, and a decryption round trip. Your browser re-checks each stage, including evaluating m(X) at every slot root to get your values back."],
            ["Why nobody can just read it", "Without the secret key, recovering the values means solving a hard lattice problem (Ring-LWE). The ciphertext is safe to send anywhere."],
        ],
    },
    deepdive: {
        title: "CKKS Deep-Dive",
        io: "your first 8 features → real polynomials → recovered values",
        sections: [
            ["What this chapter is", "TenSEAL hides CKKS's internals, so this chapter re-runs the same scheme with a small from-scratch implementation (N=256, one modulus) on your real feature values and shows every polynomial it creates: encoding, secret key, public key, both ciphertext halves, and decryption."],
            ["How it relates to the real pipeline", "It's the same math at toy size. The production path uses N=8192 and an RNS modulus chain for speed, and the steps are identical."],
        ],
    },
    compute: {
        title: "Computation",
        io: "Enc(x) → Enc(w·x + b)",
        sections: [
            ["What this stage does", "The server evaluates the model on ciphertext: it multiplies by the weights, sums, and adds the bias, without ever decrypting. The per-feature steps unpack that math term by term. The last step is the single SIMD ciphertext operation that actually ran."],
            ["Why only linear math here", "CKKS can only add and multiply. Logistic regression's score (w·x + b) is exactly that; the sigmoid is applied after decryption, on your side."],
        ],
    },
    transport_out: {
        title: "Transport → client",
        io: "Enc(x) on the server → sealed packet → Enc(x) on the client",
        sections: [
            ["What this stage does", "The server seals the CKKS ciphertext for the network: AES-256-GCM (with the PBKDF2 key) encrypts the bytes and adds a 16-byte tag, and RSA-OAEP locks the AES key with the client's public key. The client opens the envelope with its private key, checks the tag, and gets the CKKS ciphertext back -- still encrypted, so it can compute on it but not read it."],
            ["Why HE goes on first", "The client has to compute on the CKKS ciphertext. Nothing can be computed on AES or RSA bytes, so CKKS is the inner layer and transport encryption wraps it only for the trip."],
            ["What you will see", "The AES key schedule, a zoom into one AES block with all 14 rounds as 4×4 matrices, the S-box, counter-mode XOR, the GHASH tag, the opened RSA-OAEP envelope, the packet, and a tamper test. Your browser recomputes every one of them, and decrypts the real payload itself."],
        ],
    },
    transport_back: {
        title: "Transport ← server",
        io: "Enc(score) on the client → sealed packet → Enc(score) on the server",
        sections: [
            ["What this stage does", "The client sends the encrypted result back. It does not know the passphrase, so it draws a fresh random AES-256 key, seals the result with AES-256-GCM, and locks the key with the server's RSA public key. The server opens it with its private key and checks the tag."],
            ["Why seal it again", "The result is still CKKS-encrypted, so nobody on the route can read it -- but they could change it. The GCM tag guarantees the server decrypts exactly what the client computed."],
        ],
    },
    decrypt: {
        title: "Decryption",
        io: "Enc(score) → score → probability",
        sections: [
            ["What this stage does", "Your secret key turns the returned ciphertext back into the model's raw score, and the sigmoid turns that score into a probability."],
            ["Why only you can do this", "The secret key was generated on your side and never sent anywhere. The server computed on data it could not read and produced a result it cannot read."],
        ],
    },
    result: {
        title: "Result",
        io: "HE score vs plaintext score → prediction",
        sections: [
            ["What this stage does", "Compares the decrypted HE result with the same model run on your unencrypted features. CKKS is approximate, so the scores differ by a tiny amount of noise; the predictions should be identical."],
            ["Why this check matters", "A match shows that encryption changed nothing about the answer. You get privacy without losing correctness."],
        ],
    },
    benchmarks: {
        title: "Benchmarks",
        io: "plaintext cost vs encrypted cost, per model",
        sections: [
            ["What this stage shows", "Saved measurements (benchmarks/results.json) of every trained model run on plaintext and under HE: time, slowdown factor, and how often the two predictions agreed."],
            ["Why it's slower", "Each ciphertext operation works on polynomials with thousands of large coefficients instead of single numbers. Privacy costs orders of magnitude in compute. Deeper models like the CNN cost far more than a single linear layer."],
        ],
    },
};
