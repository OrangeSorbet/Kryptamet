// Glossary term-linking for the Scrubber's explanation cells, ported from
// Snek's ExplanationGrid.tsx linkTerms(). Every definition here is a fixed,
// factual description of the term -- not per-run content.
const GLOSSARY = [
    { term: "CKKS", def: "Cheon-Kim-Kim-Song: a homomorphic encryption scheme for approximate arithmetic on real numbers. Results carry tiny noise, which is fine for ML scores." },
    { term: "homomorphic", aliases: ["homomorphically"], def: "Computation performed directly on ciphertext. Decrypting the result gives the same answer as doing the math on the plaintext." },
    { term: "ciphertext", aliases: ["ciphertexts"], def: "Encrypted data. Unreadable without the matching secret key." },
    { term: "plaintext", def: "Unencrypted, readable data." },
    { term: "secret key", def: "The private half of the key pair. Only its holder can decrypt; it never leaves your machine." },
    { term: "public key", def: "The shareable half of the key pair. Anyone can encrypt with it, but it cannot decrypt." },
    { term: "polynomial", aliases: ["polynomials"], def: "In CKKS, data lives as polynomials with N integer coefficients, reduced mod X^N + 1 and mod q." },
    { term: "SIMD", def: "Single Instruction, Multiple Data. CKKS packs many values into one ciphertext's slots and operates on all of them at once." },
    { term: "slots", aliases: ["SIMD slots"], def: "Positions inside one CKKS ciphertext, each holding one packed value (up to N/2 of them)." },
    { term: "bias", def: "A learned constant added to the weighted sum. It shifts the decision boundary away from the origin." },
    { term: "weight", aliases: ["weights"], def: "A learned per-feature multiplier. Its sign and size say how much that feature pushes the prediction." },
    { term: "logistic regression", def: "A linear classifier: score = w·x + b, then sigmoid(score) gives a probability. The prediction is score > 0." },
    { term: "TF-IDF", def: "Term Frequency × Inverse Document Frequency. It weights a word higher when it's frequent in this text but rare across the training texts." },
    { term: "feature vector", def: "The list of numbers extracted from your input. It's what the model actually sees." },
    { term: "sigmoid", def: "σ(z) = 1 / (1 + e^-z). It squashes any real score into a probability between 0 and 1." },
    { term: "AES", def: "Advanced Encryption Standard: fast symmetric encryption. The same key encrypts and decrypts." },
    { term: "RSA", def: "Public-key encryption based on factoring. Slow, so here it only protects one small AES key." },
    { term: "PBKDF2", def: "Password-Based Key Derivation Function 2. It hashes a passphrase many times (200,000 here) into a key, making brute-force guessing slow." },
    { term: "HMAC", def: "Hash-based Message Authentication Code: HMAC(K, m) = H((K ⊕ opad) ‖ H((K ⊕ ipad) ‖ m)), a hash that only someone holding key K can reproduce." },
    { term: "SHA-256", def: "A hash function that turns any input into a fixed 32-byte digest by compressing 64-byte blocks through 64 rounds; it cannot be run backwards." },
    { term: "salt", def: "Random, non-secret bytes mixed into a key derivation so the same passphrase gives a different key every time and pre-computed guess tables are useless." },
    { term: "ipad", def: "HMAC's inner pad: the byte 0x36 repeated 64 times, XORed with the key before the inner hash." },
    { term: "opad", def: "HMAC's outer pad: the byte 0x5c repeated 64 times, XORed with the key before the outer hash." },
    { term: "λ(n)", def: "Carmichael's function of the RSA modulus: lcm(p−1, q−1). The private exponent d is the inverse of e modulo λ(n)." },
    { term: "Galois keys", aliases: ["galois keys"], def: "CKKS key-switching keys that let a party without the secret key rotate the slots of a ciphertext." },
    { term: "message schedule", def: "SHA-256's expansion of a 16-word block into the 64 words W₀…W₆₃ that feed its 64 rounds." },
    { term: "XOR", aliases: ["XORed"], def: "Exclusive or (⊕): bit by bit, 1 when the two bits differ. XORing with the same value twice gives back the original." },
    { term: "canonical embedding", def: "CKKS's encoding map between a vector of complex numbers and a polynomial, built from roots of unity (a Vandermonde matrix)." },
    { term: "Vandermonde", def: "A matrix whose rows are powers of fixed points. Here those points are the 2N-th roots of unity used by CKKS encoding." },
    { term: "negacyclic", def: "Multiplication mod X^N + 1: coefficients that wrap past degree N come back with their sign flipped, because X^N = -1." },
    { term: "ternary", def: "Coefficients drawn only from {-1, 0, 1}. CKKS secret keys are sampled this way." },
    { term: "lattice", def: "A regular grid of points in high-dimensional space. Recovering the secret key from the public key is a hard lattice problem (Ring-LWE)." },
    { term: "error", aliases: ["noise"], def: "Small random values added during key generation and encryption. They hide the secret, and they're the reason CKKS results are approximate." },
    { term: "integrity", def: "A guarantee that data arrived byte-for-byte unchanged." },
    { term: "GCM", aliases: ["AES-GCM", "AES-256-GCM"], def: "Galois/Counter Mode: AES in counter mode for encryption plus a GHASH tag for integrity, in one pass." },
    { term: "nonce", def: "A number used once. A fresh random 12-byte value per message, so the same key never produces the same keystream twice." },
    { term: "keystream", def: "The AES outputs of the counter blocks. XORing it with the data encrypts; XORing again decrypts." },
    { term: "GHASH", def: "GCM's hash: each 16-byte block is XORed into a running value that is multiplied by H = AES_K(0) in GF(2¹²⁸)." },
    { term: "tag", aliases: ["GCM tag"], def: "A 16-byte fingerprint of the header and ciphertext that only the key holder can compute. A wrong tag means the message is rejected." },
    { term: "OAEP", aliases: ["RSA-OAEP"], def: "Optimal Asymmetric Encryption Padding: random, hash-masked padding added before RSA, so equal keys encrypt differently and damage is detected." },
    { term: "S-box", def: "AES's 256-entry substitution table, built from inversion in GF(2⁸). The only non-linear step of AES." },
    { term: "round key", aliases: ["round keys"], def: "A 16-byte key for one AES round, expanded from the main key by the key schedule." },
    { term: "RNS", def: "Residue Number System: a huge number is stored as its remainders modulo several small primes (Chinese Remainder Theorem), so each fits in a 64-bit word." },
    { term: "Ring-LWE", def: "Ring Learning With Errors: the lattice problem CKKS's security rests on. Recovering the secret from noisy polynomial equations is believed hard, even for quantum computers." },
    { term: "Miller–Rabin", aliases: ["Miller-Rabin"], def: "A fast primality test. With the fixed bases used here it is exact for every number below 3.3·10²⁴." },
    { term: "zstd", def: "Zstandard, the compression SEAL applies when serializing. It recovers the unused high bits of each 64-bit residue." },
    { term: "AAD", def: "Additional authenticated data: bytes sent readable but covered by the GCM tag, so they cannot be changed unnoticed." },
    { term: "rotation", aliases: ["rotate", "rotations"], def: "Shifting the slots of a ciphertext cyclically, done with the Galois automorphism X → X^(5^k) followed by key switching." },
    { term: "key switching", aliases: ["key-switching"], def: "Turning a ciphertext that decrypts under one key (e.g. σ(s)) into one that decrypts under s, using public key-switching (Galois) keys." },
    { term: "decision boundary", def: "The surface where the model's score is exactly 0, separating the two predicted classes." },
];

const _glossaryByText = new Map();
for (const g of GLOSSARY) for (const t of [g.term, ...(g.aliases || [])]) _glossaryByText.set(t.toLowerCase(), g);
const _escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Longest first so "secret key" wins over a shorter overlapping term; Unicode
// lookarounds instead of \b so "TF-IDF" and similar match as whole words.
const _TERM_RE = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${[..._glossaryByText.keys()].sort((a, b) => b.length - a.length).map(_escapeRe).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
);

// Returns escaped HTML with the first occurrence of each glossary term
// wrapped in a dotted-underline <span title="...">. `seen` is shared across
// a step's cells so a term is underlined once per step, not on every repeat.
// Native title tooltip on purpose: the cells clamp with overflow:hidden,
// which would clip a custom popover.
function linkGlossaryTerms(text, seen) {
    let out = "";
    let last = 0;
    for (const m of String(text).matchAll(_TERM_RE)) {
        const entry = _glossaryByText.get(m[0].toLowerCase());
        if (seen.has(entry)) continue;
        seen.add(entry);
        out += escapeHtml(text.slice(last, m.index));
        out += `<span class="glossary-term" title="${escapeHtml(entry.term + ": " + entry.def)}">${escapeHtml(m[0])}</span>`;
        last = m.index + m[0].length;
    }
    return out + escapeHtml(String(text).slice(last));
}
