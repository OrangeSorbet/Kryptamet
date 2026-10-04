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
    const scoreOf = (p, r) => ({ c0: mod(w1 * p.c0 + w2 * r.c0 + bm), c1: mod(w1 * p.c1 + w2 * r.c1) });
    const score = scoreOf(x1, x2);
    // Run B: the same two inputs locked again with different random picks (u, e0, e1).
    const y1 = enc(0.25, 3, -1, 0), y2 = enc(0.5, 2, -1, 0);
    return {
        q, delta, s, a, e, pk0, pk1, mod, centre, x1, x2, y1, y2, w1, w2, b, bm, sum, times, score, dec,
        scoreB: scoreOf(y1, y2),
        noise: (c) => e * c.u + c.e0 + c.e1 * s,
        pk0NoNoise: mod(-a * s),
        crackNoNoise: mod(-mod(-a * s) * inv(a)),  // s recovered from a noiseless public key
        crackNoisy: mod(-pk0 * inv(a)),            // the same attack on the real (noisy) one
    };
})();

// Step lines of the (?) tip on "s = −pk0 ÷ pk1 (mod q)": what ÷ means mod q, the Euclidean algorithm for the
// inverse of pk1 (each remainder tracked as x·q + y·pk1), then the multiplication, all from the toy numbers.
function modDivTipLines(pk0, pk1, q, realS, noisy) {
    const n = (v) => v.toLocaleString("en-US");
    const sg = (v) => (v < 0 ? `(−${-v})` : String(v));
    const lines = [
        "## What ÷ means here",
        `s = −${pk0} ÷ ${pk1} (mod ${q}) asks: which whole number s gives ${pk1} × s ≡ −${pk0} (mod ${q})?`,
        `"mod ${q}" = keep only the remainder after dividing by ${q}. So there are no fractions: a calculator's ${pk0} ÷ ${pk1} = ${(pk0 / pk1).toFixed(2)} is not this.`,
        `÷ ${pk1} means × i, where i is the inverse of ${pk1}: ${pk1} × i ≡ 1 (mod ${q}).`,
        `## Step 1: find i with the Euclidean algorithm`,
        `Divide, keep the remainder, and write each remainder as x×${q} + y×${pk1}.`,
        `${q} = 1×${q} + 0×${pk1}`,
        `${pk1} = 0×${q} + 1×${pk1}`,
    ];
    let [r0, r1, x0, x1, y0, y1] = [q, pk1, 1, 0, 0, 1];
    while (r1 !== 1) {
        const k = Math.floor(r0 / r1), r2 = r0 - k * r1, x2 = x0 - k * x1, y2 = y0 - k * y1;
        lines.push(`${r0} = ${k}×${r1} + ${r2}  →  ${r2} = ${sg(x2)}×${q} + ${sg(y2)}×${pk1}`);
        [r0, r1, x0, x1, y0, y1] = [r1, r2, x1, x2, y1, y2];
    }
    const i = ((y1 % q) + q) % q, prod = pk1 * i;
    lines.push(
        `The remainder is 1: 1 = ${sg(x1)}×${q} + ${sg(y1)}×${pk1}, so ${pk1} × ${sg(y1)} ≡ 1 (mod ${q}).`,
        `i = ${sg(y1)} mod ${q} = ${i}`,
        `Check: ${pk1} × ${i} = ${n(prod)} = ${Math.floor(prod / q)}×${q} + ${prod % q}  ✓`,
        "## Step 2: multiply (this is the part a calculator can do)",
        `−${pk0} + ${q} = ${q - pk0}   (the same number, made positive)`,
    );
    const m = (q - pk0) * i, k = Math.floor(m / q), sFound = m - k * q;
    lines.push(
        `${q - pk0} × ${i} = ${n(m)}`,
        `${n(m)} ÷ ${q} = ${(m / q).toFixed(2)}, whole part ${k}`,
        `${k} × ${q} = ${n(k * q)}`,
        `${n(m)} − ${n(k * q)} = ${sFound}`,
        `s = ${sFound}`,
        "## Check",
        `${pk1} × ${sFound} = ${n(pk1 * sFound)}; mod ${q} that is ${(pk1 * sFound) % q}.   −${pk0} mod ${q} = ${q - pk0}.   ${(pk1 * sFound) % q === q - pk0 ? "Equal ✓" : "Not equal"}`,
        noisy
            ? `pk0 = ${pk0} has the noise added on top, so s = ${sFound} solves the equation but is not the real secret (${realS}).`
            : `pk0 = ${pk0} has no noise, so s = ${sFound} is the real secret.`,
    );
    return lines;
}

// One worked calculation: rows of [what, how it is computed, value, variable?]; `head` optionally names the
// columns. Numbers in "how" and the notes carry their variable underneath (vn tokens, var_label.js); a plain
// numeric value shows its row's variable (the 4th item, or the row name).
function renderToyCalc(el, heading, rows, note, head) {
    const val = (v, label) => (/^[−-]?[\d,.]+$/.test(String(v)) ? vnHtml(v, label) : richText(String(v), escapeHtml, true));
    el.innerHTML = `<div class="scene-title">${escapeHtml(heading)}</div>
        <div class="scene-body"><div class="toy-calc">${head ? `<div class="toy-row toy-head">${head.map((h) => `<span>${escapeHtml(h)}</span>`).join("")}</div>` : ""}${rows.map(([what, how, v, sym]) => `
            <div class="toy-row"><span class="toy-what">${richText(what)}</span><span class="toy-how">${withHelpTips(richText(how))}</span><span class="toy-val">${val(v, sym || what)}</span></div>`).join("")}
        </div>${note ? `<p class="step-text muted">${richText(note, escapeHtml, true)}</p>` : ""}</div>`;
}

function buildHowHeSteps() {
    const T = TOY, q = T.q, D = T.delta;
    const x1 = T.x1, x2 = T.x2;
    const d1 = T.dec(x1), dSum = T.dec(T.sum), dTimes = T.dec(T.times), dScore = T.dec(T.score), dWrong = T.dec(x1, T.s + 1);
    const wantScore = T.w1 * x1.x + T.w2 * x2.x + T.b;
    const r3 = (v) => Number(v.toFixed(3));
    HELP_TIPS.set("attack_free", modDivTipLines(T.pk0NoNoise, T.pk1, q, T.s, false));
    HELP_TIPS.set("attack_real", modDivTipLines(T.pk0, T.pk1, q, T.s, true));
    const expanded = `[ ( ( (−${vn(T.a, "a")} × ${vn(T.s, "s")} + ${vn(T.e, "e")}) mod ${vn(q, "q")} ) × ${vn(x1.u, "u")} + ${vn(x1.e0, "e0")} + ${vn(x1.x, "x₁")} × ${vn(D, "Δ")} ) mod ${vn(q, "q")} ] + [ ( ${vn(T.a, "a")} × ${vn(x1.u, "u")} + (${vn(x1.e1, "e1")}) ) mod ${vn(q, "q")} ] × ${vn(T.s, "s")}`;
    const y1 = T.y1, y2 = T.y2, dB = T.dec(T.scoreB);
    const nA = T.w1 * T.noise(x1) + T.w2 * T.noise(x2), nB = T.w1 * T.noise(y1) + T.w2 * T.noise(y2);
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
                ["toy modulus", "every result is kept as a remainder after dividing by q", `q = ${vn(q, "q")}`],
                ["toy scale", "decimals are multiplied by Δ to become whole numbers", `Δ = ${vn(D, "Δ")}`],
                ["your two inputs", "the numbers to keep private", `x₁ = ${vn(x1.x, "x₁")}, x₂ = ${vn(x2.x, "x₂")}`],
                ["the server's model", "weights w and offset b", `score = ${vn(T.w1, "w₁")}·x₁ + (${vn(T.w2, "w₂")})·x₂ + ${vn(T.b, "b")}`],
            ], "The real run uses the same formulas with far bigger numbers (shown in the last step)."),
        },
        {
            eli5: {
                what: `The lock only works on whole numbers, so each decimal is multiplied by Δ = ${vn(D, "Δ")} and rounded: ${vn(x1.x, "x₁")} becomes ${vn(x1.m, "m₁")}, ${vn(x2.x, "x₂")} becomes ${vn(x2.m, "m₂")}.`,
                why: `Multiplying by ${vn(D, "Δ")} keeps 3 decimal places. Dividing by ${vn(D, "Δ")} at the end gives the decimals back. The real run uses 2⁴⁰ (about a trillion) to keep about 12 decimal places.`,
                formal: `${vn(x1.x, "x₁")} × ${vn(D, "Δ")} = ${vn(x1.m, "m₁")}; ${vn(x2.x, "x₂")} × ${vn(D, "Δ")} = ${vn(x2.m, "m₂")}.`,
                next: "Next: the secret key and the public key.",
            },
            what: `Fixed-point encoding: m = round(Δ·x). x₁ = ${vn(x1.x, "x₁")} → m₁ = ${vn(x1.m, "m₁")}; x₂ = ${vn(x2.x, "x₂")} → m₂ = ${vn(x2.m, "m₂")}. Rounding error ≤ 0.5/Δ = ${vn(0.5 / D, "max rounding error")}.`,
            why: "Arithmetic is over integers mod q. Δ sets the precision; it must also be much larger than the noise so noise/Δ is negligible.",
            formal: "m = ⌊Δ·x⌉,  x ≈ m/Δ",
            next: "Next: key generation.",
            renderVisual: (el) => renderToyCalc(el, "Step 1: decimals become whole numbers", [
                ["m₁", `round(${vn(x1.x, "x₁")} × ${vn(D, "Δ")})`, x1.m],
                ["m₂", `round(${vn(x2.x, "x₂")} × ${vn(D, "Δ")})`, x2.m],
            ], `Back again: ${vn(x1.m, "m₁")} ÷ ${vn(D, "Δ")} = ${vn(x1.m / D, "x₁")}.`),
        },
        {
            eli5: {
                what: `The secret key is one number, s = ${vn(T.s, "s")}, which you keep. The public key is two numbers made from it: pk1 = ${vn(T.pk1, "pk1")} (random) and pk0 = −pk1·s + e = ${vn(T.pk0, "pk0")} (remainder after dividing by ${vn(q, "q")}), where e = ${vn(T.e, "e")} is a small random "noise".`,
                why: "Anyone can use the public key to lock, but only s unlocks. The noise e hides s inside pk0; the next step shows why that matters.",
                formal: `s = ${vn(T.s, "s")} (private); public key = (${vn(T.pk0, "pk0")}, ${vn(T.pk1, "pk1")}).`,
                next: "Next: why the tiny noise e is the whole trick.",
            },
            what: `s = ${vn(T.s, "s")}. Public key: pk1 = a = ${vn(T.a, "a")} (uniform), pk0 = (−a·s + e) mod q = (−${vn(T.a, "a")}·${vn(T.s, "s")} + ${vn(T.e, "e")}) mod ${vn(q, "q")} = ${vn(T.pk0, "pk0")}.`,
            why: "RLWE key generation in one dimension: pk0 + pk1·s = e (mod q), a small number. That relation is what makes decryption cancel.",
            formal: "pk = (−a·s + e, a) mod q",
            next: "Next: the noise makes recovering s hard.",
            renderVisual: (el) => renderToyCalc(el, "Step 2: the keys", [
                ["secret key s", "chosen at random, never shared", T.s],
                ["pk1 = a", "random number below q", T.pk1],
                ["e", "small random noise", T.e],
                ["pk0", `(−${vn(T.a, "a")} × ${vn(T.s, "s")} + ${vn(T.e, "e")}) mod ${vn(q, "q")}`, T.pk0],
                ["check", "pk0 + pk1·s mod q (centred)", T.centre(T.pk0 + T.pk1 * T.s)],
            ], `The check gives back e = ${vn(T.e, "e")}: small. That small leftover is why unlocking works later.`),
        },
        {
            eli5: {
                what: `Without noise, anyone could find s from the public key with school maths: s = −pk0 ÷ pk1, giving ${vn(T.crackNoNoise, "s found")}. With the noise e = ${vn(T.e, "e")}, the same trick gives ${vn(T.crackNoisy, "s guessed")}, which is wrong.`,
                why: `That tiny noise turns an easy equation into a puzzle nobody can solve when the numbers are big. In this toy you could still try all ${vn(q.toLocaleString(), "q")} values of s, but the real key has 8192 secret numbers, so there are about 3⁸¹⁹² keys to try.`,
                formal: `no noise: s found (${vn(T.crackNoNoise, "s found")}); with noise: wrong answer (${vn(T.crackNoisy, "s guessed")}).`,
                next: "Next: locking your numbers.",
            },
            what: `Attack: s = −pk0·pk1⁻¹ mod q. Noise-free key → ${vn(T.crackNoNoise, "s found")} (= s). Real key (e = ${vn(T.e, "e")}) → ${vn(T.crackNoisy, "s guessed")}; the error e·pk1⁻¹ is spread over all of Z_q.`,
            why: "Learning With Errors: without e the key is a linear equation solvable by Gaussian elimination. With e, recovering s is a lattice problem believed hard, even for quantum computers. The toy is breakable by brute force (one coefficient); real keys have N = 8192 coefficients.",
            formal: "LWE: given (a, −a·s + e), find s",
            next: "Next: encryption.",
            renderVisual: (el) => renderToyCalc(el, "Why the noise matters", [
                ["pk0 built without noise", `(−${vn(T.pk1, "pk1")} × ${vn(T.s, "s")}) mod ${vn(q, "q")}`, T.pk0NoNoise, "pk0 (no noise)"],
                ["pk0 built with noise (the real key)", `(−${vn(T.pk1, "pk1")} × ${vn(T.s, "s")} + ${vn(T.e, "e")}) mod ${vn(q, "q")}`, T.pk0, "pk0"],
                ["attack on a noise-free key", `s = −(${vn(T.pk0NoNoise, "pk0 (no noise)")}) ÷ ${vn(T.pk1, "pk1")} ⟪?attack_free⟫ (mod ${vn(q, "q")})`, `${vn(T.crackNoNoise, "s found")}  (found!)`],
                ["the same attack on the real key", `s = −(${vn(T.pk0, "pk0")}) ÷ ${vn(T.pk1, "pk1")} ⟪?attack_real⟫ (mod ${vn(q, "q")})`, `${vn(T.crackNoisy, "s guessed")}  (wrong)`],
                ["the real s", "kept secret", T.s],
                ["check: is s found the real s?", `${vn(T.pk1, "pk1")} × ${vn(T.crackNoNoise, "s found")} + ${vn(T.pk0NoNoise, "pk0 (no noise)")} = ${vn(T.pk1 * T.crackNoNoise + T.pk0NoNoise, "sum")} = ${vn((T.pk1 * T.crackNoNoise + T.pk0NoNoise) / q, "k")} × ${vn(q, "q")}`, "a multiple of q: yes", "check"],
                ["check: the real key, with the real s", `${vn(T.pk1, "pk1")} × ${vn(T.s, "s")} + ${vn(T.pk0, "pk0")} = ${vn(T.pk1 * T.s + T.pk0, "sum")}, remainder ${vn(T.mod(T.pk1 * T.s + T.pk0), "remainder")} after dividing by ${vn(q, "q")}`, `${T.mod(T.pk1 * T.s + T.pk0)} = e, not 0`, "check"],
            ], "\"÷\" here is division that wraps at q: s is the whole number where pk1 × s + pk0 is a multiple of q. A calculator's 7051 ÷ 4321 = 1.63 ignores the wrap. With noise, the whole number that fits (7796) is not the real s: the real s leaves the remainder e = 2."),
        },
        {
            eli5: {
                what: `To lock m₁ = ${vn(x1.m, "m₁")}, pick a fresh random u = ${vn(x1.u, "u")} and two tiny noises e0 = ${vn(x1.e0, "e0")}, e1 = ${vn(x1.e1, "e1")}. Then c0 = pk0·u + e0 + m = ${vn(x1.c0, "c0 of x₁")} and c1 = pk1·u + e1 = ${vn(x1.c1, "c1 of x₁")}. The locked number is the pair (${vn(x1.c0, "c0 of x₁")}, ${vn(x1.c1, "c1 of x₁")}). m₂ = ${vn(x2.m, "m₂")} locks to (${vn(x2.c0, "c0 of x₂")}, ${vn(x2.c1, "c1 of x₂")}).`,
                why: `Locking never uses s, but s is already inside pk0 (pk0 = −pk1·s + e). So c0 = pk0·u + e0 + m hides m under a mask containing −pk1·u·s, and c1 = pk1·u + e1 hands over pk1·u. Only someone who knows s can turn c1 into pk1·u·s and cancel the mask; that is what the next-but-one step does. u makes every lock different, so locking the same number twice gives different pairs. The noises keep it hard to undo.`,
                formal: `${vn(x1.m, "m₁")} → (${vn(x1.c0, "c0 of x₁")}, ${vn(x1.c1, "c1 of x₁")}); ${vn(x2.m, "m₂")} → (${vn(x2.c0, "c0 of x₂")}, ${vn(x2.c1, "c1 of x₂")}).`,
                next: "Next: unlocking with s.",
            },
            what: `Enc: c0 = (pk0·u + e0 + m) mod q, c1 = (pk1·u + e1) mod q. m₁: u = ${vn(x1.u, "u")}, e0 = ${vn(x1.e0, "e0")}, e1 = ${vn(x1.e1, "e1")} → (${vn(x1.c0, "c0 of x₁")}, ${vn(x1.c1, "c1 of x₁")}). m₂: u = ${vn(x2.u, "u")}, e0 = ${vn(x2.e0, "e0")}, e1 = ${vn(x2.e1, "e1")} → (${vn(x2.c0, "c0 of x₂")}, ${vn(x2.c1, "c1 of x₂")}).`,
            why: "Public-key encryption: anyone with pk can encrypt, and s never appears in the formula because it is already inside pk0: c0 = −a·u·s + e·u + e0 + m. Decryption adds c1·s = a·u·s + e1·s to cancel that mask, which only the holder of s can do. The fresh u randomizes each ciphertext (semantic security).",
            formal: "c = (pk0·u + e0 + m, pk1·u + e1) mod q",
            next: "Next: decryption.",
            renderVisual: (el) => renderToyCalc(el, "Step 3: locking", [
                ["c0 for m₁", `(${vn(T.pk0, "pk0")}×${vn(x1.u, "u")} + ${vn(x1.e0, "e0")} + ${vn(x1.m, "m₁")}) mod ${vn(q, "q")}`, x1.c0],
                ["c1 for m₁", `(${vn(T.pk1, "pk1")}×${vn(x1.u, "u")} + ${vn(x1.e1, "e1")}) mod ${vn(q, "q")}`, x1.c1],
                ["c0 for m₂", `(${vn(T.pk0, "pk0")}×${vn(x2.u, "u")} + ${vn(x2.e0, "e0")} + ${vn(x2.m, "m₂")}) mod ${vn(q, "q")}`, x2.c0],
                ["c1 for m₂", `(${vn(T.pk1, "pk1")}×${vn(x2.u, "u")} + ${vn(x2.e1, "e1")}) mod ${vn(q, "q")}`, x2.c1],
            ], "These pairs are what travels to the server. They look like random numbers."),
        },
        {
            eli5: {
                what: `To unlock, compute c0 + c1·s: ${vn(x1.c0, "c0 of x₁")} + ${vn(x1.c1, "c1 of x₁")}×${vn(T.s, "s")}, then the remainder after dividing by ${vn(q, "q")}. Spelled out with every number replaced by what made it: ${expanded} = ${vn(x1.c0 + x1.c1 * T.s, "c0 + c1·s")}. That gives ${vn(d1, "c0 + c1·s")}, and ${vn(d1, "c0 + c1·s")} ÷ ${vn(D, "Δ")} = ${vn(d1 / D, "x₁ unlocked")}. You locked ${vn(x1.x, "x₁")}.`,
                why: `The big random parts cancel exactly; only m plus a tiny leftover noise (${vn(T.noise(x1), "noise")}) remains. Dividing by Δ makes the noise almost vanish: ${vn(T.noise(x1), "noise")} ÷ ${vn(D, "Δ")} = ${vn(T.noise(x1) / D, "noise ÷ Δ")}. That's why CKKS answers are "approximate".`,
                formal: `${vn(x1.m, "m₁")} + ${vn(T.noise(x1), "noise")} noise = ${vn(d1, "c0 + c1·s")} → ${vn(d1 / D, "x₁ unlocked")}.`,
                next: "Next: what a wrong key gives.",
            },
            what: `c0 + c1·s, fully expanded: ${expanded} = ${vn(x1.c0 + x1.c1 * T.s, "c0 + c1·s")}. Then c0 + c1·s = m + (e·u + e0 + e1·s) = ${vn(x1.m, "m₁")} + (${vn(T.e, "e")}·${vn(x1.u, "u")} + ${vn(x1.e0, "e0")} + ${vn(x1.e1, "e1")}·${vn(T.s, "s")}) = ${vn(d1, "c0 + c1·s")} (mod ${vn(q, "q")}, centred). ${vn(d1, "c0 + c1·s")}/Δ = ${vn(d1 / D, "x₁ unlocked")}.`,
            why: "Substituting pk: (−a·s + e)·u + e0 + m + (a·u + e1)·s. The a·u·s terms cancel, leaving m + small noise. Decoding divides by Δ, shrinking the noise by Δ.",
            formal: "c0 + c1·s = m + e·u + e0 + e1·s ≈ m",
            next: "Next: decrypting with the wrong key.",
            eli1: {
                what: `Unlock by hand. Replace c0 and c1 by the sums that made them, down to the toy values: ${expanded} = ${vn(x1.c0, "c0 of x₁")} + ${vn(x1.c1, "c1 of x₁")}×${vn(T.s, "s")} = ${vn(x1.c0 + x1.c1 * T.s, "c0 + c1·s")}. Subtract whole copies of ${vn(q, "q")} (here ${vn(Math.floor((x1.c0 + x1.c1 * T.s) / q), "k")}) to get ${vn(d1, "c0 + c1·s")}, then ${vn(d1, "c0 + c1·s")} ÷ ${vn(D, "Δ")} = ${vn(d1 / D, "x₁ unlocked")}.`,
                why: `The ${vn(T.a, "a")}·${vn(x1.u, "u")}·${vn(T.s, "s")} parts cancel, so what is left is ${vn(x1.m, "m₁")} plus the small noise ${vn(T.e, "e")}×${vn(x1.u, "u")} + ${vn(x1.e0, "e0")} + (${vn(x1.e1, "e1")})×${vn(T.s, "s")} = ${vn(T.noise(x1), "noise")}.`,
                formal: `${vn(x1.m, "m₁")} + ${vn(T.noise(x1), "noise")} = ${vn(d1, "c0 + c1·s")} → ${vn(d1 / D, "x₁ unlocked")}.`,
                next: "Next: what a wrong key gives.",
            },
            vars: { c0: x1.c0, c1: x1.c1, "c₀": x1.c0, "c₁": x1.c1, u: x1.u, e0: x1.e0, e1: x1.e1, m: x1.m },
            renderVisual: (el) => renderToyCalc(el, "Step 4: unlocking", [
                ["c0 + c1·s", `${vn(x1.c0, "c0 of x₁")} + ${vn(x1.c1, "c1 of x₁")}×${vn(T.s, "s")} = ${vn(x1.c0 + x1.c1 * T.s, "c0 + c1·s")}`, x1.c0 + x1.c1 * T.s],
                ["c0 + c1·s, fully expanded", `${expanded}`, x1.c0 + x1.c1 * T.s, "c0 + c1·s"],
                ["remainder mod q", `${vn(x1.c0 + x1.c1 * T.s, "c0 + c1·s")} mod ${vn(q, "q")} (centred)`, d1],
                ["noise left over", `e·u + e0 + e1·s = ${vn(T.e, "e")}×${vn(x1.u, "u")} + ${vn(x1.e0, "e0")} + ${vn(x1.e1, "e1")}×${vn(T.s, "s")}`, T.noise(x1)],
                ["your number", `${vn(d1, "c0 + c1·s")} ÷ ${vn(D, "Δ")}`, d1 / D],
            ], `Exact input ${vn(x1.x, "x₁")}; error ${vn(r3(d1 / D - x1.x), "error")}. The real run's error is about 0.000000000001.`),
        },
        {
            eli5: {
                what: `The same unlocking with a wrong key, s = ${vn(T.s + 1, "wrong s")}, gives ${vn(dWrong, "wrong-key result")}, which is ${vn(dWrong / D, "garbage")} after dividing by Δ. Nonsense.`,
                why: "The random parts only cancel with the exact s. Anyone without it, including the server, gets garbage.",
                formal: `wrong key → ${vn(dWrong / D, "garbage")}, not ${vn(x1.x, "x₁")}.`,
                next: "Next: adding two locked numbers.",
            },
            what: `c0 + c1·(s+1) = m + noise + c1 = ${vn(dWrong, "wrong-key result")} (mod ${vn(q, "q")}, centred), i.e. ${vn(dWrong / D, "garbage")}.`,
            why: "With the wrong key, the a·u·s term no longer cancels; a uniform-looking value remains.",
            formal: "c0 + c1·s′ = m + noise + c1·(s′ − s)",
            next: "Next: homomorphic addition.",
            vars: { c0: x1.c0, c1: x1.c1, "c₀": x1.c0, "c₁": x1.c1, m: x1.m },
            renderVisual: (el) => renderToyCalc(el, "Unlocking with the wrong key", [
                [`c0 + c1·${vn(T.s + 1, "wrong s")}`, `${vn(x1.c0, "c0 of x₁")} + ${vn(x1.c1, "c1 of x₁")}×${vn(T.s + 1, "wrong s")} mod ${vn(q, "q")}`, dWrong, "c0 + c1·s′"],
                ["\"your number\"", `${vn(dWrong, "wrong-key result")} ÷ ${vn(D, "Δ")}`, dWrong / D, "garbage"],
            ]),
        },
        {
            eli5: {
                what: `The server adds the two locked pairs, part by part: (${vn(x1.c0, "c0 of x₁")} + ${vn(x2.c0, "c0 of x₂")}, ${vn(x1.c1, "c1 of x₁")} + ${vn(x2.c1, "c1 of x₂")}), remainders mod ${vn(q, "q")}, = (${vn(T.sum.c0, "c0 of sum")}, ${vn(T.sum.c1, "c1 of sum")}). You unlock it: ${vn(dSum, "sum unlocked")} ÷ ${vn(D, "Δ")} = ${vn(dSum / D, "x₁ + x₂ unlocked")}. And ${vn(x1.x, "x₁")} + ${vn(x2.x, "x₂")} = ${vn(x1.x + x2.x, "x₁ + x₂")}.`,
                why: "Unlocking is just adding and multiplying, so adding locked pairs adds what's inside. The server did the sum without seeing either number.",
                formal: `Enc(${vn(x1.x, "x₁")}) + Enc(${vn(x2.x, "x₂")}) unlocks to ${vn(dSum / D, "x₁ + x₂ unlocked")}.`,
                next: "Next: multiplying a locked number by a plain one.",
            },
            what: `(c0 + c0′, c1 + c1′) = (${vn(T.sum.c0, "c0 of sum")}, ${vn(T.sum.c1, "c1 of sum")}); Dec = ${vn(dSum, "sum unlocked")} → ${vn(dSum / D, "x₁ + x₂ unlocked")} (exact ${vn(x1.x + x2.x, "x₁ + x₂")}). The noises add too.`,
            why: "Decryption is linear in (c0, c1): (c0+c0′) + (c1+c1′)·s = (m+m′) + (noise+noise′).",
            formal: "Enc(m) + Enc(m′) = Enc(m + m′)",
            next: "Next: plaintext multiplication.",
            vars: { c0: T.sum.c0, c1: T.sum.c1, "c₀": T.sum.c0, "c₁": T.sum.c1 },
            renderVisual: (el) => renderToyCalc(el, "Adding locked numbers", [
                ["c0 of the sum", `(${vn(x1.c0, "c0 of x₁")} + ${vn(x2.c0, "c0 of x₂")}) mod ${vn(q, "q")}`, T.sum.c0],
                ["c1 of the sum", `(${vn(x1.c1, "c1 of x₁")} + ${vn(x2.c1, "c1 of x₂")}) mod ${vn(q, "q")}`, T.sum.c1],
                ["unlock", `(${vn(T.sum.c0, "c0 of sum")} + ${vn(T.sum.c1, "c1 of sum")}×${vn(T.s, "s")}) mod ${vn(q, "q")} ÷ ${vn(D, "Δ")}`, dSum / D],
                ["plain answer", `${vn(x1.x, "x₁")} + ${vn(x2.x, "x₂")}`, x1.x + x2.x],
            ]),
        },
        {
            eli5: {
                what: `Multiply both parts of the locked ${vn(x1.x, "x₁")} by the plain weight ${vn(T.w1, "w₁")}: (${vn(T.times.c0, "c0 of 3x₁")}, ${vn(T.times.c1, "c1 of 3x₁")}). Unlocked: ${vn(dTimes, "3x₁ unlocked")} ÷ ${vn(D, "Δ")} = ${vn(dTimes / D, "3x₁ ÷ Δ")}. And ${vn(T.w1, "w₁")} × ${vn(x1.x, "x₁")} = ${vn(T.w1 * x1.x, "w₁·x₁")}.`,
                why: `Same reason: the unlock formula is linear, so ${vn(T.w1, "w₁")}× the lock is the lock of ${vn(T.w1, "w₁")}× the number. The noise grew ${vn(T.w1, "w₁")}× too (now ${vn(T.w1 * T.noise(x1), "noise")}). Noise grows with every operation, which is why the real run needs big numbers and a limited number of steps.`,
                formal: `${vn(T.w1, "w₁")} × Enc(${vn(x1.x, "x₁")}) unlocks to ${vn(dTimes / D, "3x₁ ÷ Δ")}.`,
                next: "Next: the server's whole score, while locked.",
            },
            what: `k·(c0, c1) = (${vn(T.times.c0, "c0 of 3x₁")}, ${vn(T.times.c1, "c1 of 3x₁")}), k = ${vn(T.w1, "w₁")}; Dec = ${vn(dTimes, "3x₁ unlocked")} → ${vn(dTimes / D, "3x₁ ÷ Δ")} (exact ${vn(T.w1 * x1.x, "w₁·x₁")}); noise ${vn(T.noise(x1), "noise")} → ${vn(T.w1 * T.noise(x1), "noise")}.`,
            why: "Plaintext-ciphertext multiplication by an integer keeps the scale Δ. Real CKKS encodes w at scale Δ, so the product sits at Δ² and is rescaled by a ~40-bit prime.",
            formal: "k·Enc(m) = Enc(k·m), noise × k",
            next: "Next: w·x + b on ciphertexts.",
            vars: { c0: T.times.c0, c1: T.times.c1, "c₀": T.times.c0, "c₁": T.times.c1, k: T.w1 },
            renderVisual: (el) => renderToyCalc(el, "Multiplying by a plain number", [
                ["c0", `${vn(T.w1, "w₁")} × ${vn(x1.c0, "c0 of x₁")} mod ${vn(q, "q")}`, T.times.c0],
                ["c1", `${vn(T.w1, "w₁")} × ${vn(x1.c1, "c1 of x₁")} mod ${vn(q, "q")}`, T.times.c1],
                ["unlock", `(${vn(T.times.c0, "c0 of 3x₁")} + ${vn(T.times.c1, "c1 of 3x₁")}×${vn(T.s, "s")}) mod ${vn(q, "q")} ÷ ${vn(D, "Δ")}`, dTimes / D],
                ["plain answer", `${vn(T.w1, "w₁")} × ${vn(x1.x, "x₁")}`, T.w1 * x1.x],
            ]),
        },
        {
            eli5: {
                what: `The server computes the score on locked numbers: ${vn(T.w1, "w₁")}×(locked ${vn(x1.x, "x₁")}) + (${vn(T.w2, "w₂")})×(locked ${vn(x2.x, "x₂")}) + ${vn(T.b, "b")}. The offset ${vn(T.b, "b")} is scaled to ${vn(T.bm, "Δ·b")} and added to c0. Result: (${vn(T.score.c0, "c0 of score")}, ${vn(T.score.c1, "c1 of score")}). The server can't read it. You unlock it: ${vn(dScore, "score unlocked")} ÷ ${vn(D, "Δ")} = ${vn(dScore / D, "score")} (plain maths: ${vn(r3(wantScore), "plain score")}).`,
                why: "This is exactly what the real server does with your real numbers: weights times inputs, add up, add the offset, all locked. Turning the score into a percentage (sigmoid/softmax) needs eˣ, which isn't add or multiply, so you do that after unlocking.",
                formal: `locked score unlocks to ${vn(dScore / D, "score")} ≈ ${vn(r3(wantScore), "plain score")}.`,
                next: "Next: toy vs the real run.",
            },
            what: `c = w₁·c₁ + w₂·c₂ + (Δb, 0) = (${vn(T.score.c0, "c0 of score")}, ${vn(T.score.c1, "c1 of score")}); Dec = ${vn(dScore, "score unlocked")} → ${vn(dScore / D, "score")}; plaintext w·x + b = ${vn(r3(wantScore), "plain score")}.`,
            why: "A linear model is only + and ×, so it can be evaluated entirely on ciphertexts. The non-polynomial link function runs on the client after decryption.",
            formal: "Enc(w·x + b) = Σ wᵢ·Enc(xᵢ) + Δb",
            next: "Next: how the real parameters differ.",
            vars: { c0: T.score.c0, c1: T.score.c1, "c₀": T.score.c0, "c₁": T.score.c1 },
            renderVisual: (el) => renderToyCalc(el, "The model's score, computed while locked", [
                ["c0", `(${vn(T.w1, "w₁")}×${vn(x1.c0, "c0 of x₁")} + (${vn(T.w2, "w₂")})×${vn(x2.c0, "c0 of x₂")} + ${vn(T.bm, "Δ·b")}) mod ${vn(q, "q")}`, T.score.c0],
                ["c1", `(${vn(T.w1, "w₁")}×${vn(x1.c1, "c1 of x₁")} + (${vn(T.w2, "w₂")})×${vn(x2.c1, "c1 of x₂")}) mod ${vn(q, "q")}`, T.score.c1],
                ["you unlock", `(${vn(T.score.c0, "c0 of score")} + ${vn(T.score.c1, "c1 of score")}×${vn(T.s, "s")}) mod ${vn(q, "q")} ÷ ${vn(D, "Δ")}`, dScore / D],
                ["plain maths", `${vn(T.w1, "w₁")}×${vn(x1.x, "x₁")} + (${vn(T.w2, "w₂")})×${vn(x2.x, "x₂")} + ${vn(T.b, "b")}`, r3(wantScore)],
            ], "The server only ever had the pairs. Only you, holding s, can read the score."),
        },
        {
            eli5: {
                what: `Lock the same ${vn(x1.x, "x₁")} and ${vn(x2.x, "x₂")} a second time with different random picks (run B). The locks look unrelated: ${vn(x1.m, "m₁")} was (${vn(x1.c0, "c0 of x₁")}, ${vn(x1.c1, "c1 of x₁")}) in run A and is (${vn(y1.c0, "c0 of x₁ (B)")}, ${vn(y1.c1, "c1 of x₁ (B)")}) in run B. The server computes the score on each: (${vn(T.score.c0, "c0 of score")}, ${vn(T.score.c1, "c1 of score")}) and (${vn(T.scoreB.c0, "c0 of score (B)")}, ${vn(T.scoreB.c1, "c1 of score (B)")}). Unlocked: ${vn(dScore / D, "score")} and ${vn(dB / D, "score (B)")}. Both are close to the true ${vn(r3(wantScore), "plain score")}.`,
                why: `Unlocking cancels the big random mask (that is what s is for) and leaves the number plus a small leftover. The server's steps (multiply, add) treat the number and the leftover the same way, so each run ends at ${vn(T.w1 * x1.m + T.w2 * x2.m + T.bm, "true Δ·score")} plus its own small error. The error differs per run (${vn(r3(dScore / D - wantScore), "error A")} vs ${vn(r3(dB / D - wantScore), "error B")}). That is why CKKS is called approximate. The mod only keeps numbers bounded; the key s does the cancelling. A wrong s gives garbage.`,
                formal: `same inputs, different locks, same answer up to a small error.`,
                next: "Next: toy vs the real run.",
            },
            eli1: {
                what: `Work m₁ = ${vn(x1.m, "m₁")} by hand, twice. Run A: c0 = ${vn(T.pk0, "pk0")}×${vn(x1.u, "u")} + ${vn(x1.e0, "e0")} + ${vn(x1.m, "m₁")} = ${vn(T.pk0 * x1.u + x1.e0 + x1.m, "c0 before mod")}, minus ${vn(Math.floor((T.pk0 * x1.u + x1.e0 + x1.m) / q), "k")}×${vn(q, "q")} = ${vn(x1.c0, "c0 of x₁")}. Run B (u = ${vn(y1.u, "u")}, e0 = ${vn(y1.e0, "e0")}): c0 = ${vn(T.pk0, "pk0")}×${vn(y1.u, "u")} + ${vn(y1.e0, "e0")} + ${vn(y1.m, "m₁")} = ${vn(T.pk0 * y1.u + y1.e0 + y1.m, "c0 before mod")}, minus ${vn(Math.floor((T.pk0 * y1.u + y1.e0 + y1.m) / q), "k")}×${vn(q, "q")} = ${vn(y1.c0, "c0 of x₁ (B)")}. Two unrelated-looking locks for one number.`,
                why: `Unlock each: A gives ${vn(x1.m, "m₁")} + noise ${vn(T.noise(x1), "noise A")} = ${vn(T.dec(x1), "c0 + c1·s")}; B gives ${vn(y1.m, "m₁")} + noise ${vn(T.noise(y1), "noise B")} = ${vn(T.dec(y1), "c0 + c1·s (B)")}. The server's score (w₁×lock₁ + w₂×lock₂, plus ${vn(T.bm, "Δ·b")} in c0) then unlocks to ${vn(dScore, "score unlocked")} in A and ${vn(dB, "score unlocked (B)")} in B. True value: ${vn(T.w1 * x1.m + T.w2 * x2.m + T.bm, "true Δ·score")}. The leftovers (A: ${vn(nA, "score noise A")}, B: ${vn(nB, "score noise B")}) are tiny next to ${vn(D, "Δ")}, so both read as about ${vn(r3(wantScore), "plain score")}.`,
                formal: `two different locks → ${vn(dScore / D, "score")} and ${vn(dB / D, "score (B)")}; true ${vn(r3(wantScore), "plain score")}.`,
                next: "Next: the same formulas with the real, much bigger numbers.",
            },
            what: `Unlock of one lock: c0 + c1·s = u·(pk0 + pk1·s) + e0 + e1·s + m = ${vn(T.e, "e")}·u + e0 + ${vn(T.s, "s")}·e1 + m (mod ${vn(q, "q")}). Noise of m₁: A = ${vn(T.noise(x1), "noise A")}, B = ${vn(T.noise(y1), "noise B")}; of m₂: A = ${vn(T.noise(x2), "noise A")}, B = ${vn(T.noise(y2), "noise B")}. Score noise = w₁·n₁ + w₂·n₂: A = ${vn(nA, "score noise A")}, B = ${vn(nB, "score noise B")}.`,
            why: "pk0 + pk1·s = e is small, so the large terms pk0·u + pk1·u·s collapse to e·u. Every server operation is linear in (c0, c1), so it maps message and leftovers identically; the leftovers stay small as long as the weights are small. At real sizes the two ciphertexts are computationally indistinguishable (RLWE) even though the plaintexts are equal.",
            formal: "c0 + c1·s = m + e·u + e0 + e1·s;  noise(score) = Σ wᵢ·noiseᵢ",
            next: "Next: how the real parameters differ.",
            renderVisual: (el) => renderToyCalc(el, "The same inputs locked twice", [
                ["run A: m₁ lock", `u=${vn(x1.u, "u")}, e0=${vn(x1.e0, "e0")}, e1=${vn(x1.e1, "e1")}`, `(${x1.c0}, ${x1.c1})`],
                ["run B: m₁ lock", `u=${vn(y1.u, "u")}, e0=${vn(y1.e0, "e0")}, e1=${vn(y1.e1, "e1")}`, `(${y1.c0}, ${y1.c1})`],
                ["run A: m₂ lock", `u=${vn(x2.u, "u")}, e0=${vn(x2.e0, "e0")}, e1=${vn(x2.e1, "e1")}`, `(${x2.c0}, ${x2.c1})`],
                ["run B: m₂ lock", `u=${vn(y2.u, "u")}, e0=${vn(y2.e0, "e0")}, e1=${vn(y2.e1, "e1")}`, `(${y2.c0}, ${y2.c1})`],
                ["run A: score lock", "w₁·lock₁ + w₂·lock₂ + Δb in c0", `(${T.score.c0}, ${T.score.c1})`],
                ["run B: score lock", "the same formula", `(${T.scoreB.c0}, ${T.scoreB.c1})`],
                ["run A: unlock", `(${vn(T.score.c0, "c0 of score")} + ${vn(T.score.c1, "c1 of score")}×${vn(T.s, "s")}) mod ${vn(q, "q")}, noise ${vn(nA, "score noise A")}`, dScore / D],
                ["run B: unlock", `(${vn(T.scoreB.c0, "c0 of score (B)")} + ${vn(T.scoreB.c1, "c1 of score (B)")}×${vn(T.s, "s")}) mod ${vn(q, "q")}, noise ${vn(nB, "score noise B")}`, dB / D],
                ["plain maths", "3·0.25 − 0.5 + 0.1", r3(wantScore)],
            ], "Different locks, different server outputs, nearly the same answer. Only the small leftover differs."),
        },
        {
            eli5: {
                what: `The real run does exactly this, with much bigger numbers: s is 8192 small numbers instead of one, q is about 200 bits instead of ${vn(q, "q")}, Δ is 2⁴⁰ instead of ${vn(D, "Δ")}, and one locked package holds 4096 numbers instead of one.`,
                why: "Bigger numbers make the noise relatively tinier (more correct decimals) and the puzzle impossibly hard to crack. Packing 4096 numbers lets one locked operation work on all of them at once.",
                formal: "Same formulas; real sizes make it safe and precise.",
                next: "Next chapter: your real input becomes numbers.",
            },
            what: `Toy → production: one coefficient → N = 8192 (Z_q[X]/(X^8192 + 1)); q = ${vn(q, "q")} → ∏ [60, 40, 40, 60]-bit primes; Δ = ${vn(D, "Δ")} → 2^40; 1 slot → 4096 slots (canonical embedding); s ∈ {−1, 0, 1}^8192.`,
            why: "Ring-LWE at N = 8192 gives ≥128-bit security for this modulus size; slot packing gives SIMD operations; the modulus chain allows rescaling after multiplications.",
            formal: "R_q = Z_q[X]/(X^N + 1), N = 8192, Δ = 2^40",
            next: "Next chapter: Feature Extraction.",
            renderVisual: (el) => renderToyCalc(el, "Toy vs the real run", [
                ["secret key s", `one number (${vn(T.s, "s")})`, "8192 numbers, each −1, 0 or 1"],
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
