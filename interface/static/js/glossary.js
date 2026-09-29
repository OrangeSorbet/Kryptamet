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
    { term: "canonical embedding", def: "CKKS's encoding map between a vector of complex numbers and a polynomial, built from roots of unity (a Vandermonde matrix)." },
    { term: "Vandermonde", def: "A matrix whose rows are powers of fixed points. Here those points are the 2N-th roots of unity used by CKKS encoding." },
    { term: "negacyclic", def: "Multiplication mod X^N + 1: coefficients that wrap past degree N come back with their sign flipped, because X^N = -1." },
    { term: "ternary", def: "Coefficients drawn only from {-1, 0, 1}. CKKS secret keys are sampled this way." },
    { term: "lattice", def: "A regular grid of points in high-dimensional space. Recovering the secret key from the public key is a hard lattice problem (Ring-LWE)." },
    { term: "error", aliases: ["noise"], def: "Small random values added during key generation and encryption. They hide the secret, and they're the reason CKKS results are approximate." },
    { term: "integrity", def: "A guarantee that data arrived byte-for-byte unchanged." },
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
