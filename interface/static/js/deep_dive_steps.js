// CKKS Deep-Dive chapter: the whole encrypted score w·x + b re-run with the
// small from-scratch CKKS in hecrypto/ckks_math.py (N=256, Q=2^60, Δ=2^25),
// in pipeline order: encode, keys, encrypt, then the evaluation the server
// runs (× w, chunk sum, 7 rotate-and-add rounds, + b), then decrypt and
// decode. Every polynomial relation and every decrypted slot is re-checked
// by the browser (deep_dive_check.js). Grids: poly_grid.js + grid_controls.js.
function buildDeepDiveSteps(dd, result) {
    if (!dd) return [];
    const P = dd.params, C = ddChecks(dd), ev = dd.evaluate;
    const base = P.shown_chunk * P.slots;
    const names = (result && result.feature_names) || [];
    const tenScore = result && result.scores ? result.scores[dd.row] : null;
    const skip = () => !!window.sceneAlreadyVisited;
    const title = (s) => `<div class="scene-title">CKKS · ${escapeHtml(s)}</div>`;
    const e1 = (v) => v.toExponential(1);
    const ms = (r) => `${Math.max(1, Math.round(r.ms))} ms`;
    const slotOk = (err) => err < 1e-2;

    // The 8 slots shown in tables: the chunk's non-zero inputs first, then the rest in order.
    const nzSlots = C.xs.map((v, j) => (v !== 0 ? j : -1)).filter((j) => j >= 0);
    const shownSlots = [...nzSlots, ...C.xs.map((_, j) => j).filter((j) => !nzSlots.includes(j))].slice(0, 8);
    const first8 = [0, 1, 2, 3, 4, 5, 6, 7];
    const featName = (j) => names[base + j] ?? `x[${base + j}]`;
    // Tables of x or w slots name the feature in each slot; partial-sum tables don't (a slot mixes many).
    // Hovering a value shows what the row means for that slot and the exact value (see hookSlotTables).
    const SLOT_TEX = {
        "x": (j) => `x_{${base + j}}`,
        "w": (j) => `w_{${base + j}}`,
        "decoded": (j) => `m(\\zeta^{5^{${j}}}) / \\Delta`,
        "decrypted": (j) => `\\mathrm{Decode}(c_0 + c_1 s)_{${j}}`,
        "x·w": (j) => `x_{${base + j}}\\, w_{${base + j}}`,
        "Σ x·w": (j) => `\\sum_{\\text{chunks}} x_{${j}+${P.slots}k}\\, w_{${j}+${P.slots}k}`,
        "partial Σ": (j) => `\\text{slot } ${j} \\text{ after the rotate-and-add rounds so far}`,
    };
    const slotTable = (slots, rows, withNames) => `
        <div class="recover-table">
            <div class="recover-row head"><span>slot</span>${slots.map((j) => `<span>${j}</span>`).join("")}</div>
            ${withNames ? `<div class="recover-row head"><span>feature</span>${slots.map((j) => `<span class="recover-name">${escapeHtml(featName(j))}</span>`).join("")}</div>` : ""}
            ${rows.map(([label, vals]) => `<div class="recover-row"><span>${escapeHtml(label)}</span>${slots.map((j) => `<span class="recover-val" data-j="${j}" data-label="${escapeHtml(label)}" data-v="${escapeHtml(String(vals[j]))}">${fmt(vals[j])}</span>`).join("")}</div>`).join("")}
        </div>`;
    const hookSlotTables = (el) => el.querySelectorAll(".recover-table").forEach((t) => attachFormulaHover(t, ".recover-val", (c) => {
        const j = +c.dataset.j, f = SLOT_TEX[c.dataset.label];
        return { tex: f ? f(j) : null, note: `slot ${j}${names[base + j] !== undefined ? ` (${names[base + j]})` : ""}: ${c.dataset.label} = ${c.dataset.v}` };
    }));
    const grid = (el, sel, coeffs, name, eq) => renderPolyGrid(el.querySelector(sel), coeffs, buildIndexedEquations(coeffs.length, eq), { name, skipAnimation: skip() }).done;
    // Negacyclic product coefficient k: terms with i + j ≥ N come back negated.
    const mulEq = (a, b) => (k) => `\\sum_{i+j\\equiv ${k}} \\pm ${a}_i ${b}_j`;

    const chunkLine = P.n_chunks > 1
        ? `x has ${dd.original_vector.length} values, more than the ${P.slots} slots of one N=${P.N} ciphertext, so it is split into ${P.n_chunks} chunks. Chunk ${P.shown_chunk + 1} (features ${base}–${base + P.slots - 1}) holds ${nzSlots.length} of your non-zero values, so it is the one shown.`
        : `All ${dd.original_vector.length} values of x fit in the ${P.slots} slots of one N=${P.N} ciphertext (the other slots are 0).`;
    const rowLine = result && result.task === "multiclass" ? ` The model is multiclass; this traces the row of the predicted class "${dd.row_class}".` : "";

    const steps = [
        {
            eli5: {
                what: `A small, from-scratch version of CKKS with every number visible (TenSEAL hides them). Your numbers are packed into a formula with ${P.N} coefficients.`,
                why: "Same idea as the Encryption chapter, but small enough to show every single number and check it in your browser.",
                formal: `your numbers → one formula, ${P.N} coefficients.`,
                next: "Next: the secret key.",
            },
            what: `${chunkLine}${rowLine} Those ${P.slots} slots are encoded into m(X): ${P.N} integer coefficients, Δ = 2^${Math.log2(P.scale)}.`,
            why: "CKKS encrypts polynomials, not numbers. The inverse canonical embedding finds the integer polynomial whose values at the slot roots are your numbers times Δ, so the rounding error is ~1/Δ.",
            formal: "m = round(Δ · V⁻¹ · (z ‖ z̄)) ∈ Z[X]/(X^256 + 1),  slot j = m(ζ^(5^j)) / Δ",
            next: "Next: the secret key.",
            renderVisual: (el) => {
                const r = C.encode();
                el.innerHTML = `${title("Encoding")}<div class="poly-label">m(X): your chunk as ${P.N} integer coefficients</div>
                    ${renderChecks([{ label: `browser: m(ζ^(5^j))/Δ = x for all ${P.slots} slots (max err ${e1(r.xErr)})`, ok: r.xErr < 1e-4 }])}
                    ${slotTable(shownSlots, [["x", C.xs], ["decoded", r.mx]], true)}<div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.encode.m_coeffs, "m", (k) => `m_{${k}} = \\mathrm{round}\\big(\\Delta \\sum_j V^{-1}_{${k},j}\\, z_j\\big)`);
            },
        },
        {
            eli5: {
                what: `The secret key is a formula whose ${P.N} coefficients are just −1, 0 or +1, chosen at random.`,
                why: "Everything else is built from it, and only it can unlock. It stays with the client.",
                formal: "secret key = random −1 / 0 / +1 coefficients.",
                next: "Next: the public key built from it.",
            },
            what: (() => { const c = C.secret().counts; return `The secret key s(X): ${P.N} coefficients drawn from {−1, 0, 1} (here ${c["-1"]}× −1, ${c[0]}× 0, ${c[1]}× +1).`; })(),
            why: "Everything else is derived from s: the public key hides it, and only s can undo the encryption. It stays with the client (the data owner).",
            formal: "s ← {−1, 0, 1}^256",
            next: "Next: the public key, built from s.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Secret key")}<div class="poly-label">s(X): ternary secret key</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.keygen.secret_key_s, "s", (k) => `s_{${k}} \\leftarrow \\{-1,0,1\\}`);
            },
        },
        {
            eli5: {
                what: `The public key is two formulas: a (pure random) and b, which is a mixed with the secret key plus a little noise. Your browser redid the mixing (${(P.N * P.N).toLocaleString()} multiplications) and got exactly b.`,
                why: "b looks random, so the public key can be handed to anyone; pulling the secret key back out of it is a famously hard problem.",
                formal: "b = −a × secret + small noise.",
                next: "Next: locking your formula, part 1.",
            },
            what: `The public key (b, a): a is uniform mod q = 2^60, e is small Gaussian error, b = −a·s + e. Your browser recomputes −a·s + e with ${P.N * P.N} BigInt products and compares every coefficient of b.`,
            why: "b looks uniformly random, so (a, b) can be given to anyone. Recovering s from it is the Ring-LWE problem.",
            formal: "b = −a·s + e (mod q),  q = 2^60",
            next: "Next: encrypting m with the public key gives c0.",
            renderVisual: (el) => {
                const r = C.publicKey();
                el.innerHTML = `${title("Public key")}
                    ${renderChecks([{ label: `browser: b ≡ −a·s + e (mod 2^60), all ${P.N} coefficients exact (${ms(r)})`, ok: r.ok }])}
                    <div class="grid-pair">
                        <div><div class="poly-label">a(X): uniform mod q</div><div id="ddA"></div></div>
                        <div><div class="poly-label">b(X) = −a·s + e (mod q)</div><div id="ddB"></div></div>
                    </div>`;
                return Promise.all([
                    grid(el, "#ddA", dd.keygen.public_key_a, "a", (k) => `a_{${k}} \\leftarrow \\mathrm{Uniform}(0, q)`),
                    grid(el, "#ddB", dd.keygen.public_key_b, "b", (k) => `b_{${k}} = \\Big(-${mulEq("a", "s")(k)} + e_{${k}}\\Big) \\bmod q`),
                ]);
            },
        },
        {
            eli5: {
                what: "Part 1 of the lock: your formula is hidden under b times a fresh random formula, plus a little noise. Your browser redid it exactly.",
                why: "The random part changes every time, so locking the same numbers twice looks completely different.",
                formal: "c0 = b × random + noise + your formula.",
                next: "Next: part 2 of the lock.",
            },
            what: "c0 = b·u + e1 + m (mod q), with a fresh ternary u and fresh error e1. The browser recomputes it from b, u, e1 and m and compares every coefficient exactly.",
            why: "The mask b·u looks random without s, so c0 hides m. The fresh u makes two encryptions of the same x look unrelated.",
            formal: "c0 = b·u + e1 + m (mod q)",
            next: "Next: c1 completes the ciphertext.",
            renderVisual: (el) => {
                const r = C.c0();
                el.innerHTML = `${title("Encrypt: c0")}${renderChecks([{ label: `browser: c0 ≡ b·u + e1 + m (mod 2^60), exact (${ms(r)})`, ok: r.ok }])}
                    <div class="poly-label">c0(X)</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.encrypt.c0, "c0", (k) => `c0_{${k}} = \\Big(${mulEq("b", "u")(k)}\\Big) + e1_{${k}} + m_{${k}} \\bmod q`);
            },
        },
        {
            eli5: {
                what: (() => { const f = C.fresh(); return `Part 2: c1 = a × the same random formula + noise. Together (c0, c1) are the locked package. Your browser unlocked it right away and got your numbers back (off by ${e1(f.err)}).`; })(),
                why: "c1 carries just enough information for the secret key to cancel the hiding later.",
                formal: "locked = (c0, c1).",
                next: "Next: the server starts computing on the locked package.",
            },
            what: (() => { const f = C.fresh(); return `c1 = a·u + e2 (mod q). (c0, c1) is the ciphertext. Decrypting it right now in the browser gives x back with max error ${e1(f.err)} over all ${P.slots} slots.`; })(),
            why: "c1 carries the u that s needs to cancel the mask: c0 + c1·s = m + small noise, because b + a·s = e is small.",
            formal: "c1 = a·u + e2 (mod q);  c0 + c1·s = m + e·u + e1 + e2·s",
            next: "Next: the evaluation. The weights are encoded as a plaintext polynomial.",
            renderVisual: (el) => {
                const r = C.c1(), f = C.fresh();
                el.innerHTML = `${title("Encrypt: c1")}${renderChecks([
                    { label: `browser: c1 ≡ a·u + e2 (mod 2^60), exact (${ms(r)})`, ok: r.ok },
                    { label: `browser decrypt (c0 + c1·s)/Δ = x (max err ${e1(f.err)}), = client's decrypt`, ok: slotOk(f.err) && f.serverOk },
                ])}${slotTable(shownSlots, [["x", C.xs], ["decrypted", f.slots]], true)}
                    <div class="poly-label">c1(X)</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.encrypt.c1, "c1", (k) => `c1_{${k}} = \\Big(${mulEq("a", "u")(k)}\\Big) + e2_{${k}} \\bmod q`);
            },
        },
        {
            eli5: {
                what: `Now the server works, holding only the locked package. First it packs the model's weights into a formula the same way.`,
                why: "The weights aren't secret, so they stay unlocked; multiplying a locked package by an unlocked formula is cheap.",
                formal: "weights → formula ŵ.",
                next: "Next: multiply the locked package by the weights.",
            },
            what: `Evaluation starts. The server has only the ciphertext and the public keys. The model's weights for the same ${P.slots} features are encoded like x, into ŵ(X).`,
            why: "The weights are not secret from the server, so they stay plaintext. Multiplying a ciphertext by a plaintext polynomial is much cheaper than by another ciphertext.",
            formal: "ŵ = round(Δ · V⁻¹ · (w ‖ w̄))",
            next: "Next: multiply the ciphertext by ŵ.",
            renderVisual: (el) => {
                const r = C.encode();
                el.innerHTML = `${title("Encode the weights")}${renderChecks([{ label: `browser: ŵ(ζ^(5^j))/Δ = w (max err ${e1(r.wErr)})`, ok: r.wErr < 1e-4 }])}
                    ${slotTable(shownSlots, [["w", C.ws], ["decoded", r.mw]], true)}<div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.encode.w_coeffs, "ŵ", (k) => `\\hat w_{${k}} = \\mathrm{round}\\big(\\Delta \\sum_j V^{-1}_{${k},j}\\, w_j\\big)`);
            },
        },
        {
            eli5: {
                what: (() => { const r = C.mul(); return `Both halves of the locked package are multiplied by the weights. Inside, every slot now holds number × weight. Your browser unlocked a copy to check: right within ${e1(r.err)}.`; })(),
                why: "This is the magic of CKKS: multiplying the locked package multiplies the hidden numbers too.",
                formal: "locked × weights = lock(number × weight).",
                next: "Next: add the pieces together.",
            },
            what: (() => { const r = C.mul(); return `(c0, c1) · ŵ: both halves multiplied by ŵ. Slot j now holds x_j·w_j at scale Δ² = 2^${2 * Math.log2(P.scale)}. Browser: decrypted slots match x_j·w_j within ${e1(r.err)}.`; })(),
            why: "Polynomial multiplication multiplies the slot values one by one (the embedding is a ring map), so one multiply computes all the per-feature products at once.",
            formal: "(c0·ŵ, c1·ŵ);  Dec = m·ŵ + noise·ŵ,  slot j ≈ Δ² x_j w_j",
            next: P.n_chunks > 1 ? `Next: the ${P.n_chunks} chunk products are added.` : "Next: rotations sum the slots.",
            renderVisual: (el) => {
                const r = C.mul();
                el.innerHTML = `${title("Multiply by ŵ")}${renderChecks([
                    { label: `browser: c0·ŵ and c1·ŵ (mod 2^60), exact (${ms(r)})`, ok: r.ok },
                    { label: `decrypted slots = x_j·w_j (max err ${e1(r.err)})`, ok: slotOk(r.err) },
                ])}${slotTable(shownSlots, [["x·w", r.want], ["decrypted", r.slots]], true)}
                    <div class="poly-label">c0·ŵ (c1·ŵ checked too)</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", ev.mul_plain.c0, "c0'", (k) => `c0'_{${k}} = ${mulEq("c0", "\\hat w")(k)} \\bmod q`);
            },
        },
    ];

    if (P.n_chunks > 1) {
        steps.push({
            eli5: {
                what: `Your numbers needed ${P.n_chunks} packages; their products are added package to package.`,
                why: "Adding locked packages adds the hidden numbers, slot by slot.",
                formal: "sum of the locked pieces.",
                next: "Next: slide-and-add to total every slot.",
            },
            what: (() => { const r = C.chunkSum(); return `The ${P.n_chunks} chunk products are added ciphertext + ciphertext. Slot j now holds the sum of x_i·w_i over every chunk position i ≡ j (mod ${P.slots}). Browser: matches within ${e1(r.err)}.`; })(),
            why: "Adding ciphertexts adds their slots. After this, one ciphertext holds all of w·x, spread over 128 slots.",
            formal: `c_Σ = Σ_{c=1..${P.n_chunks}} c^(c)·ŵ^(c);  slot j = Σ_c x_{${P.slots}c+j} w_{${P.slots}c+j}`,
            next: "Next: 7 rotate-and-add rounds fold the 128 slots into one sum.",
            renderVisual: (el) => {
                const r = C.chunkSum();
                el.innerHTML = `${title("Add the chunks")}${renderChecks([{ label: `decrypted slots = per-slot chunk sums (max err ${e1(r.err)}, ${ms(r)})`, ok: slotOk(r.err) }])}
                    ${slotTable(first8, [["Σ x·w", r.want], ["decrypted", r.slots]])}<div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", ev.chunk_sum.c0, "c0Σ", (k) => `c0^{\\Sigma}_{${k}} = \\sum_{c} c0'^{(c)}_{${k}} \\bmod q`);
            },
        });
    }

    ev.rotations.forEach((rot, r) => {
        const got = () => C.rotation(r);
        const span = 2 ** (r + 1);
        steps.push({
            eli5: {
                what: (() => { const g = got(); return `Slide-and-add round ${r + 1} of ${ev.rotations.length}: the locked slots slide over by ${rot.step} and are added to themselves. Each slot now holds a total of ${span} products; slot 0 = ${fmt(g.slots[0])}.`; })(),
                why: "A dot product needs every product added up. Sliding by 64, 32, … 1 and adding each time totals all of them in just 7 rounds, all while locked.",
                formal: `slot j ← slot j + slot j+${rot.step}.`,
                next: r < ev.rotations.length - 1 ? `Next: slide by ${ev.rotations[r + 1].step}.` : "Every slot now holds the full total. Next: add the bias.",
            },
            what: (() => { const g = got(); return `Rotation ${r + 1} of ${ev.rotations.length}: rotate by ${rot.step} slots (X → X^${rot.galois}) and add. Each slot now sums ${span} of the ${P.slots} products; slot 0 = ${fmt(g.slots[0])} (plaintext partial sum ${fmt(g.want[0])}).`; })(),
            why: `X → X^(5^k) moves slot j+k into slot j, but the result is encrypted under σ(s), not s. Key switching fixes that: c1 is cut into ${P.digits} base-2^15 digits, each multiplied by a Galois key that encrypts 2^(15i)·σ(s) under s.`,
            formal: `c ← c + KS(σ_${rot.galois}(c)),  slot j ← slot j + slot (j+${rot.step}) mod ${P.slots}`,
            next: r < ev.rotations.length - 1 ? `Next: rotate by ${ev.rotations[r + 1].step}.` : "Every slot now holds the full w·x. Next: add the bias.",
            renderVisual: (el) => {
                const g = got();
                el.innerHTML = `${title(`Rotate by ${rot.step} and add`)}${renderChecks([
                    { label: `Galois element 5^${rot.step} mod ${2 * P.N} = ${rot.galois}`, ok: g.galoisOk },
                    { label: `decrypted slots = plaintext partial sums (max err ${e1(g.err)}, ${ms(g)})`, ok: slotOk(g.err) },
                ])}${slotTable(first8, [["partial Σ", g.want], ["decrypted", g.slots]])}
                    <div class="poly-label">c0 after round ${r + 1} (c1 changes too)</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", rot.c0, `c0⁽${r + 1}⁾`, (k) => `c0^{(${r + 1})}_{${k}} = c0^{(${r})}_{${k}} + \\big[\\mathrm{KS}(\\sigma_{${rot.galois}}(c^{(${r})}))\\big]_{0,${k}} \\bmod q`);
            },
        });
    });

    steps.push(
        {
            eli5: {
                what: `The model's fixed offset (bias ${fmt(dd.bias)}) is added to the locked total. That was the server's last step.`,
                why: "The bias has to be scaled the same way as the total, or it would be added in the wrong units.",
                formal: "locked score = locked total + bias.",
                next: "Next: the client unlocks with the secret key.",
            },
            what: (() => { const r = C.bias(); return `+ b: the bias ${fmt(dd.bias)} is encoded at scale Δ² as a constant polynomial (coefficient 0 = ${r.coeff0}, the rest 0) and added to c0. c1 does not change.`; })(),
            why: "The ciphertext is at scale Δ² after the multiply, so the bias must be encoded at Δ² too, or it would be 2^25 times too small.",
            formal: "c0 ← c0 + round(Δ² b),  c1 unchanged",
            next: "That was the last step on the server. Next: the client decrypts with s.",
            renderVisual: (el) => {
                const r = C.bias();
                el.innerHTML = `${title("Add the bias")}${renderChecks([
                    { label: `browser: c0 + β exact, c1 unchanged (${ms(r)})`, ok: r.ok },
                    { label: `β decodes to b = ${fmt(dd.bias)} in every slot (max err ${e1(r.biasErr)})`, ok: r.biasErr < 1e-6 },
                ])}<div class="poly-label">β(X): the bias at scale Δ²</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", ev.bias_pt, "β", (k) => `\\beta_{${k}} = \\mathrm{round}\\big(\\Delta^2 \\sum_j V^{-1}_{${k},j}\\, b\\big)`);
            },
        },
        {
            eli5: {
                what: "The client unlocks: c0 + c1 × secret key. The random hiding cancels out exactly. Your browser redid it and got the same formula.",
                why: "Only the secret key makes the hiding cancel; with any other key the result is still noise.",
                formal: "unlocked = c0 + c1 × secret.",
                next: "Next: read the score out.",
            },
            what: "m′ = c0 + c1·s (mod q). Only the secret key cancels the mask. The browser recomputes m′ from the final ciphertext and s, and compares it with the client's m′ coefficient by coefficient.",
            why: "c0 + c1·s removes every b·u and key-switching mask at once, leaving Δ²·(w·x + b) in the slots plus noise far below Δ².",
            formal: "m′ = c0 + c1·s (mod q)",
            next: "Next: read the score out of slot 0.",
            renderVisual: (el) => {
                const r = C.decrypt();
                el.innerHTML = `${title("Decrypt")}${renderChecks([{ label: `browser: m′ ≡ c0 + c1·s (mod 2^60), exact (${ms(r)})`, ok: r.ok }])}
                    <div class="poly-label">m′(X)</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.decrypt.m_prime, "m′", (k) => `m'_{${k}} = \\Big(c0_{${k}} + ${mulEq("c1", "s")(k)}\\Big) \\bmod q`);
            },
        },
        {
            eli5: {
                what: (() => { const r = C.decrypt(); return `Reading slot 0 gives the score ${fmt(r.score, 6)}. The model on plain numbers gives ${fmt(dd.decode.plaintext_score, 6)}${tenScore !== null ? `, and the real TenSEAL run gave ${fmt(tenScore, 6)}` : ""}.`; })(),
                why: "A from-scratch CKKS and TenSEAL agree with the plain model, up to tiny noise. The maths shown here really is what runs.",
                formal: "score ≈ weights · numbers + bias.",
                next: "End of the deep-dive. Next chapter: the trip to the server.",
            },
            what: (() => { const r = C.decrypt(); return `Decode: slot 0 = m′(ζ)/Δ² = ${fmt(r.score, 6)}. The plaintext w·x + b = ${fmt(dd.decode.plaintext_score, 6)}${tenScore !== null ? `, the TenSEAL pipeline gave ${fmt(tenScore, 6)}` : ""}. Difference to plaintext: ${e1(Math.abs(r.score - dd.decode.plaintext_score))}.`; })(),
            why: "Two independent CKKS implementations, one written from scratch, agree with the plaintext model up to CKKS noise. The same math really runs inside TenSEAL.",
            formal: "score = Re m′(ζ^(5^0)) / Δ² ≈ w·x + b",
            next: "End of the deep-dive. Next chapter: Transport → server.",
            renderVisual: (el) => {
                const r = C.decrypt();
                const close = (a, b) => Math.abs(a - b) < 5e-3;
                el.innerHTML = `${title("Decode the score")}<div class="scene-body">
                    ${renderChecks([
                        { label: `browser decode = client decode (${fmt(r.score, 6)})`, ok: Math.abs(r.score - dd.decode.score) < 1e-9 },
                        { label: `≈ plaintext w·x + b ${fmt(dd.decode.plaintext_score, 6)}`, ok: close(r.score, dd.decode.plaintext_score) },
                        ...(tenScore !== null ? [{ label: `≈ TenSEAL score ${fmt(tenScore, 6)}`, ok: close(r.score, tenScore) }] : []),
                    ])}
                    ${slotTable(first8, [["decrypted", r.slots]])}
                    <p class="step-text muted">Every slot holds the same sum after the 7 rotations; slot 0 is the score.</p></div>`;
            },
        },
    );
    // Every slot table in every step gets its hover formulas once the step is drawn.
    steps.forEach((st) => {
        const draw = st.renderVisual;
        st.renderVisual = (el) => { const out = draw(el); hookSlotTables(el); return out; };
    });
    return steps;
}
