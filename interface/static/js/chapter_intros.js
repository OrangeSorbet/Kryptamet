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
        io: "CKKS parameters → secret key + public key (+ transport key)",
        sections: [
            ["What this stage does", "Builds the CKKS context -- ring size N, the modulus chain q, the fixed-point scale -- and generates the key pair. Separately, the transport layer gets a key: random RSA+AES by default, or one derived from a passphrase you type."],
            ["Why it comes before encryption", "Every later step depends on these exact keys. The public key encrypts your data, and only this secret key can decrypt the result. A key generated later wouldn't match the ciphertext."],
        ],
    },
    encrypt: {
        title: "Encryption",
        io: "feature vector → one CKKS ciphertext",
        sections: [
            ["What this stage does", "Packs the whole feature vector into the slots of a single CKKS ciphertext using the public key. The result is a few hundred kilobytes of bytes that look random."],
            ["Why the server can't just read it", "Without the secret key, recovering the values means solving a hard lattice problem (Ring-LWE). The ciphertext is safe to send anywhere."],
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
    transport: {
        title: "Transport",
        io: "ciphertext bytes → wrapped payload → the same bytes",
        sections: [
            ["What this stage does", "Wraps the already-encrypted result in a second, independent layer for the network: AES for the bulk bytes, with the AES key protected by RSA (or derived from your passphrase with PBKDF2). Then it unwraps and checks the bytes arrived unchanged."],
            ["Why a second layer", "Defense in depth. The transport layer protects the bytes in transit and proves they weren't tampered with, independent of CKKS."],
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
