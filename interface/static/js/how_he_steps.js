// "How HE works" chapter: the whole idea of CKKS-style homomorphic encryption on toy numbers small
// enough to check by hand. One secret number s instead of 8192 coefficients, q = 10007 instead of a
// ~200-bit modulus, Δ = 1000 instead of 2^40, one slot instead of 4096. Every value below is computed
// here from those constants with the real formulas (c0 = pk0·u + e0 + m, c1 = pk1·u + e1,
// c0 + c1·s ≈ m); nothing is typed in. Needs no run, so it opens before the first inference too.
const TOY = (() => {
    const q = 10007, delta = 1000, s = 3, a = 4321, e = 2;
    const mod = (v) => ((v % q) + q) % q;
    // Centred remainder: values above q/2 stand for negatives (e.g. 10006 means −1).
    const centre = (v) => { const r = mod(v); return r > q / 2 ? r - q : r; };
    const inv = (v) => { // modular inverse by the extended Euclidean algorithm
        let [r0, r1, t0, t1] = [q, mod(v), 0, 1];
        while (r1) { const k = Math.floor(r0 / r1); [r0, r1] = [r1, r0 - k * r1]; [t0, t1] = [t1, t0 - k * t1]; }
        return mod(t0);
    };
    const pk0 = mod(-a * s + e), pk1 = a;
    const enc = (x, u, e0, e1) => {
        const m = Math.round(x * delta);
        return { x, m, u, e0, e1, c0: mod(pk0 * u + e0 + m), c1: mod(pk1 * u + e1) };
    };
    const dec = (c, key = s) => centre(c.c0 + c.c1 * key);
    const x1 = enc(0.25, 2, 1, -1), x2 = enc(0.5, 1, 1, 0);
    const w1 = 3, w2 = -1, b = 0.1;
    const sum = { c0: mod(x1.c0 + x2.c0), c1: mod(x1.c1 + x2.c1) };
    const times = { c0: mod(w1 * x1.c0), c1: mod(w1 * x1.c1) };
    const bm = Math.round(b * delta);
    const score = { c0: mod(w1 * x1.c0 + w2 * x2.c0 + bm), c1: mod(w1 * x1.c1 + w2 * x2.c1) };
    return {
        q, delta, s, a, e, pk0, pk1, mod, centre, x1, x2, w1, w2, b, bm, sum, times, score, dec,
        noise: (c) => e * c.u + c.e0 + c.e1 * s,
        crackNoNoise: mod(-mod(-a * s) * inv(a)),  // s recovered from a noiseless public key
        crackNoisy: mod(-pk0 * inv(a)),            // the same attack on the real (noisy) one
    };
})();

// One worked calculation: rows of [what, how it is computed, value]; `head` optionally names the columns.
function renderToyCalc(el, heading, rows, note, head) {
    el.innerHTML = `<div class="scene-title">${escapeHtml(heading)}</div>
        <div class="scene-body"><div class="toy-calc">${head ? `<div class="toy-row toy-head">${head.map((h) => `<span>${escapeHtml(h)}</span>`).join("")}</div>` : ""}${rows.map(([what, how, val]) => `
            <div class="toy-row"><span class="toy-what">${escapeHtml(what)}</span><span class="toy-how">${escapeHtml(how)}</span><span class="toy-val">${escapeHtml(String(val))}</span></div>`).join("")}
        </div>${note ? `<p class="step-text muted">${escapeHtml(note)}</p>` : ""}</div>`;
}

function buildHowHeSteps() {
    const T = TOY, q = T.q, D = T.delta;
    const x1 = T.x1, x2 = T.x2;
    const d1 = T.dec(x1), dSum = T.dec(T.sum), dTimes = T.dec(T.times), dScore = T.dec(T.score), dWrong = T.dec(x1, T.s + 1);
    const wantScore = T.w1 * x1.x + T.w2 * x2.x + T.b;
    const r3 = (v) => Number(v.toFixed(3));
    return [
        {
            eli5: {
                what: "Homomorphic encryption (HE) is a lock that lets someone else do maths on your numbers while they stay locked. You lock, they compute, you unlock the answer. They never see your numbers or the answer.",
                why: "You want a service (the server) to run its model on your private data, like your symptoms, without trusting it with that data.",
                formal: "Compute on locked data, unlock only the answer.",
                next: "Next: the same thing with tiny numbers you can check by hand.",
            },
            what: "Homomorphic encryption: Dec(Enc(a) ⊕ Enc(b)) = a + b and Dec(k ⊗ Enc(a)) = k·a, so a party holding only ciphertexts can evaluate additions and multiplications for the key holder.",
            why: "Privacy-preserving inference: the server holds the model, the client holds the data and the secret key; neither reveals its half.",
            formal: "Dec_s(f(Enc_pk(x))) ≈ f(x) for f built from + and ×",
            next: "Next: the toy scheme's numbers.",
            renderVisual: (el) => renderToyCalc(el, "How HE works, with toy numbers", [
                ["toy modulus", "every result is kept as a remainder after dividing by q", `q = ${q}`],
                ["toy scale", "decimals are multiplied by Δ to become whole numbers", `Δ = ${D}`],
                ["your two inputs", "the numbers to keep private", `x₁ = ${x1.x}, x₂ = ${x2.x}`],
                ["the server's model", "weights w and offset b", `score = ${T.w1}·x₁ + (${T.w2})·x₂ + ${T.b}`],
            ], "The real run uses the same formulas with far bigger numbers (shown in the last step)."),
        },
        {
            eli5: {
                what: `The lock only works on whole numbers, so each decimal is multiplied by Δ = ${D} and rounded: ${x1.x} becomes ${x1.m}, ${x2.x} becomes ${x2.m}.`,
                why: `Multiplying by ${D} keeps 3 decimal places. Dividing by ${D} at the end gives the decimals back. The real run uses 2⁴⁰ (about a trillion) to keep about 12 decimal places.`,
                formal: `${x1.x} × ${D} = ${x1.m}; ${x2.x} × ${D} = ${x2.m}.`,
                next: "Next: the secret key and the public key.",
            },
            what: `Fixed-point encoding: m = round(Δ·x). x₁ = ${x1.x} → m₁ = ${x1.m}; x₂ = ${x2.x} → m₂ = ${x2.m}. Rounding error ≤ 0.5/Δ = ${0.5 / D}.`,
            why: "Arithmetic is over integers mod q. Δ sets the precision; it must also be much larger than the noise so noise/Δ is negligible.",
            formal: "m = ⌊Δ·x⌉,  x ≈ m/Δ",
            next: "Next: key generation.",
            renderVisual: (el) => renderToyCalc(el, "Step 1: decimals become whole numbers", [
                ["m₁", `round(${x1.x} × ${D})`, x1.m],
                ["m₂", `round(${x2.x} × ${D})`, x2.m],
            ], `Back again: ${x1.m} ÷ ${D} = ${x1.m / D}.`),
        },
        {
            eli5: {
                what: `The secret key is one number, s = ${T.s}, which you keep. The public key is two numbers made from it: pk1 = ${T.pk1} (random) and pk0 = −pk1·s + e = ${T.pk0} (remainder after dividing by ${q}), where e = ${T.e} is a small random "noise".`,
                why: "Anyone can use the public key to lock, but only s unlocks. The noise e hides s inside pk0; the next step shows why that matters.",
                formal: `s = ${T.s} (private); public key = (${T.pk0}, ${T.pk1}).`,
                next: "Next: why the tiny noise e is the whole trick.",
            },
            what: `s = ${T.s}. Public key: pk1 = a = ${T.a} (uniform), pk0 = (−a·s + e) mod q = (−${T.a}·${T.s} + ${T.e}) mod ${q} = ${T.pk0}.`,
            why: "RLWE key generation in one dimension: pk0 + pk1·s = e (mod q), a small number. That relation is what makes decryption cancel.",
            formal: "pk = (−a·s + e, a) mod q",
            next: "Next: the noise makes recovering s hard.",
            renderVisual: (el) => renderToyCalc(el, "Step 2: the keys", [
                ["secret key s", "chosen at random, never shared", T.s],
                ["pk1 = a", "random number below q", T.pk1],
                ["e", "small random noise", T.e],
                ["pk0", `(−${T.a} × ${T.s} + ${T.e}) mod ${q}`, T.pk0],
                ["check", "pk0 + pk1·s mod q (centred)", T.centre(T.pk0 + T.pk1 * T.s)],
            ], `The check gives back e = ${T.e}: small. That small leftover is why unlocking works later.`),
        },
        {
            eli5: {
                what: `Without noise, anyone could find s from the public key with school maths: s = −pk0 ÷ pk1, giving ${T.crackNoNoise}. With the noise e = ${T.e}, the same trick gives ${T.crackNoisy}, which is wrong.`,
                why: `That tiny noise turns an easy equation into a puzzle nobody can solve when the numbers are big. In this toy you could still try all ${q.toLocaleString()} values of s, but the real key has 8192 secret numbers, so there are about 3⁸¹⁹² keys to try.`,
                formal: `no noise: s found (${T.crackNoNoise}); with noise: wrong answer (${T.crackNoisy}).`,
                next: "Next: locking your numbers.",
            },
            what: `Attack: s = −pk0·pk1⁻¹ mod q. Noise-free key → ${T.crackNoNoise} (= s). Real key (e = ${T.e}) → ${T.crackNoisy}; the error e·pk1⁻¹ is spread over all of Z_q.`,
            why: "Learning With Errors: without e the key is a linear equation solvable by Gaussian elimination. With e, recovering s is a lattice problem believed hard, even for quantum computers. The toy is breakable by brute force (one coefficient); real keys have N = 8192 coefficients.",
            formal: "LWE: given (a, −a·s + e), find s",
            next: "Next: encryption.",
            renderVisual: (el) => renderToyCalc(el, "Why the noise matters", [
                ["attack on a noise-free key", "s = −pk0 ÷ pk1 (mod q)", `${T.crackNoNoise}  (found!)`],
                ["the same attack on the real key", "s = −pk0 ÷ pk1 (mod q)", `${T.crackNoisy}  (wrong)`],
                ["the real s", "kept secret", T.s],
            ], "\"÷\" here means multiplying by the number that undoes pk1 mod q (the modular inverse)."),
        },
        {
            eli5: {
                what: `To lock m₁ = ${x1.m}, pick a fresh random u = ${x1.u} and two tiny noises e0 = ${x1.e0}, e1 = ${x1.e1}. Then c0 = pk0·u + e0 + m = ${x1.c0} and c1 = pk1·u + e1 = ${x1.c1}. The locked number is the pair (${x1.c0}, ${x1.c1}). m₂ = ${x2.m} locks to (${x2.c0}, ${x2.c1}).`,
                why: "u makes every lock different, so locking the same number twice gives different pairs. Nobody can tell equal inputs apart. The noises keep it hard to undo.",
                formal: `${x1.m} → (${x1.c0}, ${x1.c1}); ${x2.m} → (${x2.c0}, ${x2.c1}).`,
                next: "Next: unlocking with s.",
            },
            what: `Enc: c0 = (pk0·u + e0 + m) mod q, c1 = (pk1·u + e1) mod q. m₁: u = ${x1.u}, e0 = ${x1.e0}, e1 = ${x1.e1} → (${x1.c0}, ${x1.c1}). m₂: u = ${x2.u}, e0 = ${x2.e0}, e1 = ${x2.e1} → (${x2.c0}, ${x2.c1}).`,
            why: "Public-key encryption: anyone with pk can encrypt. The fresh u randomizes each ciphertext (semantic security).",
            formal: "c = (pk0·u + e0 + m, pk1·u + e1) mod q",
            next: "Next: decryption.",
            renderVisual: (el) => renderToyCalc(el, "Step 3: locking", [
                ["c0 for m₁", `(${T.pk0}×${x1.u} + ${x1.e0} + ${x1.m}) mod ${q}`, x1.c0],
                ["c1 for m₁", `(${T.pk1}×${x1.u} + ${x1.e1}) mod ${q}`, x1.c1],
                ["c0 for m₂", `(${T.pk0}×${x2.u} + ${x2.e0} + ${x2.m}) mod ${q}`, x2.c0],
                ["c1 for m₂", `(${T.pk1}×${x2.u} + ${x2.e1}) mod ${q}`, x2.c1],
            ], "These pairs are what travels to the server. They look like random numbers."),
        },
        {
            eli5: {
                what: `To unlock, compute c0 + c1·s: ${x1.c0} + ${x1.c1}×${T.s}, then the remainder after dividing by ${q}. That gives ${d1}, and ${d1} ÷ ${D} = ${d1 / D}. You locked ${x1.x}.`,
                why: `The big random parts cancel exactly; only m plus a tiny leftover noise (${T.noise(x1)}) remains. Dividing by Δ makes the noise almost vanish: ${T.noise(x1)} ÷ ${D} = ${T.noise(x1) / D}. That's why CKKS answers are "approximate".`,
                formal: `${x1.m} + ${T.noise(x1)} noise = ${d1} → ${d1 / D}.`,
                next: "Next: what a wrong key gives.",
            },
            what: `c0 + c1·s = m + (e·u + e0 + e1·s) = ${x1.m} + (${T.e}·${x1.u} + ${x1.e0} + ${x1.e1}·${T.s}) = ${d1} (mod ${q}, centred). ${d1}/Δ = ${d1 / D}.`,
            why: "Substituting pk: (−a·s + e)·u + e0 + m + (a·u + e1)·s. The a·u·s terms cancel, leaving m + small noise. Decoding divides by Δ, shrinking the noise by Δ.",
            formal: "c0 + c1·s = m + e·u + e0 + e1·s ≈ m",
            next: "Next: decrypting with the wrong key.",
            renderVisual: (el) => renderToyCalc(el, "Step 4: unlocking", [
                ["c0 + c1·s", `${x1.c0} + ${x1.c1}×${T.s} = ${x1.c0 + x1.c1 * T.s}`, x1.c0 + x1.c1 * T.s],
                ["remainder mod q", `${x1.c0 + x1.c1 * T.s} mod ${q} (centred)`, d1],
                ["noise left over", `e·u + e0 + e1·s = ${T.e}×${x1.u} + ${x1.e0} + ${x1.e1}×${T.s}`, T.noise(x1)],
                ["your number", `${d1} ÷ ${D}`, d1 / D],
            ], `Exact input ${x1.x}; error ${r3(d1 / D - x1.x)}. The real run's error is about 0.000000000001.`),
        },
        {
            eli5: {
                what: `The same unlocking with a wrong key, s = ${T.s + 1}, gives ${dWrong}, which is ${dWrong / D} after dividing by Δ. Nonsense.`,
                why: "The random parts only cancel with the exact s. Anyone without it, including the server, gets garbage.",
                formal: `wrong key → ${dWrong / D}, not ${x1.x}.`,
                next: "Next: adding two locked numbers.",
            },
            what: `c0 + c1·(s+1) = m + noise + c1 = ${dWrong} (mod ${q}, centred), i.e. ${dWrong / D}.`,
            why: "With the wrong key, the a·u·s term no longer cancels; a uniform-looking value remains.",
            formal: "c0 + c1·s′ = m + noise + c1·(s′ − s)",
            next: "Next: homomorphic addition.",
            renderVisual: (el) => renderToyCalc(el, "Unlocking with the wrong key", [
                [`c0 + c1·${T.s + 1}`, `${x1.c0} + ${x1.c1}×${T.s + 1} mod ${q}`, dWrong],
                ["\"your number\"", `${dWrong} ÷ ${D}`, dWrong / D],
            ]),
        },
        {
            eli5: {
                what: `The server adds the two locked pairs, part by part: (${x1.c0} + ${x2.c0}, ${x1.c1} + ${x2.c1}), remainders mod ${q}, = (${T.sum.c0}, ${T.sum.c1}). You unlock it: ${dSum} ÷ ${D} = ${dSum / D}. And ${x1.x} + ${x2.x} = ${x1.x + x2.x}.`,
                why: "Unlocking is just adding and multiplying, so adding locked pairs adds what's inside. The server did the sum without seeing either number.",
                formal: `Enc(${x1.x}) + Enc(${x2.x}) unlocks to ${dSum / D}.`,
                next: "Next: multiplying a locked number by a plain one.",
            },
            what: `(c0 + c0′, c1 + c1′) = (${T.sum.c0}, ${T.sum.c1}); Dec = ${dSum} → ${dSum / D} (exact ${x1.x + x2.x}). The noises add too.`,
            why: "Decryption is linear in (c0, c1): (c0+c0′) + (c1+c1′)·s = (m+m′) + (noise+noise′).",
            formal: "Enc(m) + Enc(m′) = Enc(m + m′)",
            next: "Next: plaintext multiplication.",
            renderVisual: (el) => renderToyCalc(el, "Adding locked numbers", [
                ["c0 of the sum", `(${x1.c0} + ${x2.c0}) mod ${q}`, T.sum.c0],
                ["c1 of the sum", `(${x1.c1} + ${x2.c1}) mod ${q}`, T.sum.c1],
                ["unlock", `(${T.sum.c0} + ${T.sum.c1}×${T.s}) mod ${q} ÷ ${D}`, dSum / D],
                ["plain answer", `${x1.x} + ${x2.x}`, x1.x + x2.x],
            ]),
        },
        {
            eli5: {
                what: `Multiply both parts of the locked ${x1.x} by the plain weight ${T.w1}: (${T.times.c0}, ${T.times.c1}). Unlocked: ${dTimes} ÷ ${D} = ${dTimes / D}. And ${T.w1} × ${x1.x} = ${T.w1 * x1.x}.`,
                why: `Same reason: the unlock formula is linear, so ${T.w1}× the lock is the lock of ${T.w1}× the number. The noise grew ${T.w1}× too (now ${T.w1 * T.noise(x1)}). Noise grows with every operation, which is why the real run needs big numbers and a limited number of steps.`,
                formal: `${T.w1} × Enc(${x1.x}) unlocks to ${dTimes / D}.`,
                next: "Next: the server's whole score, while locked.",
            },
            what: `k·(c0, c1) = (${T.times.c0}, ${T.times.c1}), k = ${T.w1}; Dec = ${dTimes} → ${dTimes / D} (exact ${T.w1 * x1.x}); noise ${T.noise(x1)} → ${T.w1 * T.noise(x1)}.`,
            why: "Plaintext-ciphertext multiplication by an integer keeps the scale Δ. Real CKKS encodes w at scale Δ, so the product sits at Δ² and is rescaled by a ~40-bit prime.",
            formal: "k·Enc(m) = Enc(k·m), noise × k",
            next: "Next: w·x + b on ciphertexts.",
            renderVisual: (el) => renderToyCalc(el, "Multiplying by a plain number", [
                ["c0", `${T.w1} × ${x1.c0} mod ${q}`, T.times.c0],
                ["c1", `${T.w1} × ${x1.c1} mod ${q}`, T.times.c1],
                ["unlock", `(${T.times.c0} + ${T.times.c1}×${T.s}) mod ${q} ÷ ${D}`, dTimes / D],
                ["plain answer", `${T.w1} × ${x1.x}`, T.w1 * x1.x],
            ]),
        },
        {
            eli5: {
                what: `The server computes the score on locked numbers: ${T.w1}×(locked ${x1.x}) + (${T.w2})×(locked ${x2.x}) + ${T.b}. The offset ${T.b} is scaled to ${T.bm} and added to c0. Result: (${T.score.c0}, ${T.score.c1}). The server can't read it. You unlock it: ${dScore} ÷ ${D} = ${dScore / D} (plain maths: ${r3(wantScore)}).`,
                why: "This is exactly what the real server does with your real numbers: weights times inputs, add up, add the offset, all locked. Turning the score into a percentage (sigmoid/softmax) needs eˣ, which isn't add or multiply, so you do that after unlocking.",
                formal: `locked score unlocks to ${dScore / D} ≈ ${r3(wantScore)}.`,
                next: "Next: toy vs the real run.",
            },
            what: `c = w₁·c₁ + w₂·c₂ + (Δb, 0) = (${T.score.c0}, ${T.score.c1}); Dec = ${dScore} → ${dScore / D}; plaintext w·x + b = ${r3(wantScore)}.`,
            why: "A linear model is only + and ×, so it can be evaluated entirely on ciphertexts. The non-polynomial link function runs on the client after decryption.",
            formal: "Enc(w·x + b) = Σ wᵢ·Enc(xᵢ) + Δb",
            next: "Next: how the real parameters differ.",
            renderVisual: (el) => renderToyCalc(el, "The model's score, computed while locked", [
                ["c0", `(${T.w1}×${x1.c0} + (${T.w2})×${x2.c0} + ${T.bm}) mod ${q}`, T.score.c0],
                ["c1", `(${T.w1}×${x1.c1} + (${T.w2})×${x2.c1}) mod ${q}`, T.score.c1],
                ["you unlock", `(${T.score.c0} + ${T.score.c1}×${T.s}) mod ${q} ÷ ${D}`, dScore / D],
                ["plain maths", `${T.w1}×${x1.x} + (${T.w2})×${x2.x} + ${T.b}`, r3(wantScore)],
            ], "The server only ever had the pairs. Only you, holding s, can read the score."),
        },
        {
            eli5: {
                what: `The real run does exactly this, with much bigger numbers: s is 8192 small numbers instead of one, q is about 200 bits instead of ${q}, Δ is 2⁴⁰ instead of ${D}, and one locked package holds 4096 numbers instead of one.`,
                why: "Bigger numbers make the noise relatively tinier (more correct decimals) and the puzzle impossibly hard to crack. Packing 4096 numbers lets one locked operation work on all of them at once.",
                formal: "Same formulas; real sizes make it safe and precise.",
                next: "Next chapter: your real input becomes numbers.",
            },
            what: `Toy → production: one coefficient → N = 8192 (Z_q[X]/(X^8192 + 1)); q = ${q} → ∏ [60, 40, 40, 60]-bit primes; Δ = ${D} → 2^40; 1 slot → 4096 slots (canonical embedding); s ∈ {−1, 0, 1}^8192.`,
            why: "Ring-LWE at N = 8192 gives ≥128-bit security for this modulus size; slot packing gives SIMD operations; the modulus chain allows rescaling after multiplications.",
            formal: "R_q = Z_q[X]/(X^N + 1), N = 8192, Δ = 2^40",
            next: "Next chapter: Feature Extraction.",
            renderVisual: (el) => renderToyCalc(el, "Toy vs the real run", [
                ["secret key s", `one number (${T.s})`, "8192 numbers, each −1, 0 or 1"],
                ["modulus q", String(q), "about 2²⁰⁰ (60 digits), as 4 primes"],
                ["scale Δ", String(D), "2⁴⁰ ≈ 1.1 trillion"],
                ["numbers per lock", "1", "4096"],
                ["make keys", "step 2", "Key Setup chapter"],
                ["lock", "step 3", "Encryption chapter"],
                ["compute while locked", "steps 7–9", "Computation chapter"],
                ["unlock", "step 4", "Result chapter"],
            ], null, ["", "toy", "real run"]),
        },
    ];
}
