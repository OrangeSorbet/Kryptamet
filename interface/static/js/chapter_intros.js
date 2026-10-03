// Theory primer for each chapter (and one for the flowchart itself), shown
// by intro_card.js the first time a chapter is opened. Same shape as Snek's
// messages/intro.ts INTRO_CARDS. Each entry is a fixed, factual description
// of what that pipeline stage does -- per-run values live in the Scrubber
// steps, not here. `eli5` is the plain-words twin (explain_level.js): same
// facts, everyday words; it replaces io and sections at the ELI5 level.
// Roles: the client owns the data and the CKKS secret key; the server is
// the compute node and only ever holds ciphertexts and public keys.
const CHAPTER_INTROS = {
    how_he: {
        title: "How HE works",
        io: "toy numbers: lock → compute while locked → unlock",
        sections: [
            ["What this chapter is", "The whole scheme on numbers small enough to check by hand: one secret coefficient, q = 10007, Δ = 1000. Keys, encryption, decryption, homomorphic addition and plaintext multiplication, and a linear score w·x + b evaluated on ciphertexts."],
            ["What it leaves out", "Polynomials (N = 8192 coefficients), slot packing, RNS primes, rescaling and rotations. Those appear in the real chapters, each with an \"up close\" part at N = 256."],
        ],
        eli5: {
            io: "tiny numbers: lock, compute while locked, unlock",
            sections: [
                ["What happens here", "Before your real run, the whole idea with tiny numbers you could check on paper: make a key, lock two numbers, let someone add and multiply them while locked, then unlock the answer."],
                ["Why start here", "The real run does exactly the same maths, just with huge numbers. Once the small version makes sense, the rest is the same story at scale."],
            ],
        },
    },
    flowchart: {
        title: "How to use this walkthrough",
        sections: [
            ["What you're looking at", "Each box is one real stage of the pipeline that just ran on your input, in order. Everything inside is taken from that run -- real feature values, real ciphertext bytes, real scores."],
            ["Navigating", "Click a box to zoom into it. Inside, the bottom bar steps through what happened: ▶ plays, ‹ › step, drag the track to scrub, ⚡ sets the speed. Keyboard: Space play/pause, ← → step, Esc back to this overview. Every animated matrix has its own ▶ ‹ › ↺ controls; hover any cell for its formula."],
            ["Progress", "A box turns green with a ✓ once you've seen its last step. Dotted-underlined words have a definition on hover. The ELI5 / Advanced switch in the top bar changes every explanation's level at any time."],
        ],
        eli5: {
            sections: [
                ["What you're looking at", "Each box is one stage of what just happened to your input, in order: turned into numbers, locked, sent away, worked on while still locked, sent back, unlocked. Everything shown is from your real run."],
                ["Getting around", "Click a box to go inside. The bar at the bottom plays the steps (▶), or step with ‹ ›. Hover any number in a grid to see where it came from. Esc brings you back here."],
                ["Two levels", "ELI5 (this) explains in plain words; Advanced shows the exact maths. Switch any time in the top bar."],
            ],
        },
    },
    feature: {
        title: "Feature Extraction",
        io: "your input → a vector of numbers",
        sections: [
            ["What this stage does", "Turns your input into the fixed-length list of numbers the model was trained on: 8 stylometric statistics for Human vs AI, a TF-IDF vector over a 500-word vocabulary for SMS Spam, standardized columns (categories one-hot first) for German Credit and price data, one 0/1 flag per symptom for diagnosis, and 784 pixels scaled to 0..1 per drawn character for MNIST and EMNIST."],
            ["Why it comes first", "A model can only multiply and add numbers. Encryption also works on numbers, so the input has to become a vector before anything can be encrypted."],
        ],
        eli5: {
            io: "your input → a list of numbers",
            sections: [
                ["What happens here", "Your text, form, symptoms or drawing is turned into a list of numbers, always the same length and order, because that is all a model (and the lock) can work with."],
                ["Why first", "You can only lock and compute on numbers, so this has to happen before anything else."],
            ],
        },
    },
    key: {
        title: "Key Setup",
        io: "random numbers + a passphrase → CKKS keys, 2 RSA keypairs, 1 AES key",
        sections: [
            ["What this stage does", "Creates every key the pipeline uses, step by step. The client makes the CKKS keys (it keeps the secret one) and an RSA keypair; the server makes its own RSA keypair. Then a passphrase -- yours, or a random one -- is stretched by PBKDF2 into the AES-256 key that protects the first network trip."],
            ["What you will see", "The real primes and exponents of both RSA keys, re-checked in your browser. PBKDF2 as a graph (step 7); its boxes follow as 7.1-7.9, each in split screen with the graph on the right, including the SHA-256 compression inside HMAC as matrices, round by round. At the end your browser re-derives the same AES key on its own."],
            ["Why it comes first", "Every later step depends on these exact keys. A key generated later wouldn't match the ciphertext or the wrapped envelopes."],
        ],
        eli5: {
            io: "randomness + a passphrase → all the keys",
            sections: [
                ["What happens here", "All the keys get made. The client makes the main lock's keys and keeps the one that opens it. Each side makes an RSA lock for the trip over the network. A passphrase is stirred 200,000 times into the key for the first trip."],
                ["What you'll see", "The real numbers behind each key, re-checked by your browser, and the stirring machine (PBKDF2) box by box."],
                ["Why first", "Everything later is locked with these exact keys."],
            ],
        },
    },
    encrypt: {
        title: "Encryption",
        io: "feature vector → one CKKS ciphertext",
        sections: [
            ["What this stage does", "The client packs the whole feature vector into the slots of a single CKKS ciphertext using the public key. The result is a few hundred kilobytes of bytes that look random."],
            ["What you will see", "The encryption pipeline as a graph (step 2), then each stage as 2.1-2.7 in split screen: the vector repeated across all slots, scaling to integers, the polynomial m(X) (all of its coefficients), its residues modulo three primes, the two ciphertext polynomials, the serialized bytes and the full ciphertext. Your browser re-checks each stage, including evaluating m(X) at every slot root to get your values back. The client's one-off decryption of its fresh ciphertext is shown as a sanity check on 2.7, not as a protocol step."],
            ["Why nobody can just read it", "Without the secret key, recovering the values means solving a hard lattice problem (Ring-LWE). The ciphertext is safe to send anywhere."],
        ],
        eli5: {
            io: "your numbers → one locked package",
            sections: [
                ["What happens here", "All your numbers are locked into one package with CKKS. The package looks like random noise, a few hundred kilobytes of it."],
                ["What's special", "This lock lets someone add and multiply the numbers inside without ever opening it. That's what makes the rest possible."],
                ["Why it's safe", "Without the secret key, getting your numbers out is a problem nobody knows how to solve, not even with future quantum computers."],
            ],
        },
    },
    transport_out: {
        title: "Transport → server",
        io: "Enc(x) on the client → sealed packet → Enc(x) on the server",
        sections: [
            ["What this stage does", "The client seals the CKKS ciphertext for the network: AES-256-GCM (with the PBKDF2 key) encrypts the bytes and adds a 16-byte tag, and RSA-OAEP locks the AES key with the server's public key. The server opens the envelope with its private key, checks the tag, and gets the CKKS ciphertext back -- still encrypted, so it can compute on it but not read it."],
            ["Why HE goes on first", "The server has to compute on the CKKS ciphertext. Nothing can be computed on AES or RSA bytes, so CKKS is the inner layer and transport encryption wraps it only for the trip."],
            ["What you will see", "AES-256-GCM counter mode as a graph (step 2), then its boxes as 2.1-2.7 in split screen: the key, the key schedule, nonce and counters, one AES block with all 14 rounds as 4×4 matrices, the S-box, and keystream ⊕ payload. Then the GHASH tag, the opened RSA-OAEP envelope, the packet and a tamper test. Your browser recomputes every one of them, and decrypts the real payload itself."],
        ],
        eli5: {
            io: "locked package → sealed envelope → the server",
            sections: [
                ["What happens here", "The locked package travels to the server inside an envelope: AES scrambles the bytes and adds a seal, RSA locks the AES key so only the server can open the envelope."],
                ["Why two layers", "The main lock (CKKS) hides your numbers but doesn't notice tampering. The envelope makes any change on the way obvious, and only the right computer can open it. Inside, the package is still locked, so the server still can't read it."],
                ["What you'll see", "How AES scrambles, box by box, and a test where one flipped bit gets caught."],
            ],
        },
    },
    compute: {
        title: "Computation",
        io: "Enc(x) → Enc(w·x + b)",
        sections: [
            ["What this stage does", "The server evaluates the model on the ciphertext in one homomorphic operation, Enc(x)·Wᵀ + b, without ever decrypting: it holds the model and the public context, never x or the secret key. The term-by-term steps that follow are a plaintext teaching mirror of the same sum."],
            ["Why only linear math here", "CKKS can only add and multiply. Logistic regression's score (w·x + b) is exactly that; the sigmoid or softmax is applied after decryption, by the client."],
        ],
        eli5: {
            io: "locked numbers → locked score",
            sections: [
                ["What happens here", "The server runs the model on your locked numbers: multiply each by its weight, add them up, add an offset. It never unlocks anything and never sees your numbers or the answer."],
                ["What you'll see", "The one real locked calculation, then a plain-numbers replay of the same sum, biggest contributions first, so you can see what happened inside the lock."],
            ],
        },
    },
    transport_back: {
        title: "Transport ← client",
        io: "Enc(score) on the server → sealed packet → Enc(score) on the client",
        sections: [
            ["What this stage does", "The server sends the encrypted result back. It does not know the passphrase, so it draws a fresh random AES-256 key, seals the result with AES-256-GCM, and locks the key with the client's RSA public key. The client opens it with its private key and checks the tag."],
            ["Why seal it again", "The result is still CKKS-encrypted, so nobody on the route can read it -- but they could change it. The GCM tag guarantees the client decrypts exactly what the server computed."],
        ],
        eli5: {
            io: "locked score → sealed envelope → the client",
            sections: [
                ["What happens here", "The locked result goes back the same way, in a new envelope with a brand-new key that only the client can open."],
                ["Why seal it again", "Nobody can read the locked result, but someone could change it. The seal makes sure the client gets exactly what the server computed."],
            ],
        },
    },
    result: {
        title: "Result",
        io: "Enc(score) → score → probability → prediction, vs plaintext",
        sections: [
            ["What this stage does", "The server's output is still a CKKS ciphertext: it never saw the score. The client decrypts it once with its secret key (c0 + c1·s, then decode), applies the sigmoid or softmax (not polynomial, so it can't run under encryption), and compares the result with the same model run on the unencrypted features."],
            ["Up close", "The decryption is then repeated with the N=256 from-scratch CKKS, every coefficient visible."],
            ["Why this check matters", "CKKS is approximate, so the scores differ by a tiny amount of noise; the predictions should be identical. A match shows that encryption changed nothing about the answer. (In a real deployment the client has no plaintext model to compare with; this simulation runs both sides.)"],
        ],
        eli5: {
            io: "locked answer → unlocked → percentage → compared",
            sections: [
                ["What happens here", "The answer arrives still locked: the server never saw it. You unlock it with your secret key, the only time anything gets unlocked, then turn the score into a percentage."],
                ["Why the percentage only now", "Turning a score into a percentage needs maths the lock can't do (eˣ), so it happens after unlocking, on your side."],
                ["Why compare", "The answer is put next to the same model run on your plain numbers. If they match, locking cost you nothing in correctness."],
            ],
        },
    },
    benchmarks: {
        title: "Benchmarks",
        io: "plaintext cost vs encrypted cost, per model",
        sections: [
            ["What this stage shows", "Saved measurements (benchmarks/results.json) of every trained model run on plaintext and under HE: time, peak memory, slowdown factor, and how often the two predictions agreed."],
            ["Why it's slower", "Each ciphertext operation works on polynomials with thousands of large coefficients instead of single numbers. Privacy costs orders of magnitude in compute. Deeper models like the CNN cost far more than a single linear layer."],
        ],
        eli5: {
            io: "how much slower locked maths is",
            sections: [
                ["What this shows", "For every model: how long it takes on plain numbers versus locked numbers, and whether the answers agreed."],
                ["Why slower", "Every locked number is a huge formula, not one number, so each multiply and add costs far more. That's the price of privacy."],
            ],
        },
    },
};
