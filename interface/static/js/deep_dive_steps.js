// "Up close" steps: the whole encrypted score w·x + b re-run with the small
// from-scratch CKKS in hecrypto/ckks_math.py (N=256, Q=2^60, Δ=2^25), with
// every number visible. Not a chapter of its own: each stage is appended to
// the chapter it explains (chapter_registry.js), via `stage`:
//   "encrypt"  encode, keys, c0, c1                      → Encryption
//   "compute"  × w, chunk sum, 7 rotate-and-add, + b     → Computation
//   "result"   decrypt, decode                           → Result
// Every polynomial relation and every decrypted slot is re-checked by the
// browser (deep_dive_check.js). Grids: poly_grid.js + grid_controls.js.
function buildDeepDiveSteps(dd, result, stage) {
    if (!dd) return [];
    const P = dd.params, C = ddChecks(dd), ev = dd.evaluate;
    const base = P.shown_chunk * P.slots;
    const names = (result && result.feature_names) || [];
    const tenScore = result && result.scores ? result.scores[dd.row] : null;
    const skip = () => !!window.sceneAlreadyVisited;
    const title = (s) => `<div class="scene-title">Up close (N=${P.N}) · ${escapeHtml(s)}</div>`;
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
        const j = +c.dataset.j, f = SLOT_TEX[c.dataset.label], v = fmt(Number(c.dataset.v), 6);
        // x·w also shows its two factors as values.
        const factors = c.dataset.label === "x·w" ? `${kv(fmt(C.xs[j], 6), `x_{${base + j}}`)} \\cdot ${kv(fmt(dd.weights[base + j] ?? 0, 6), `w_{${base + j}}`)} = ` : "";
        return { tex: f ? `${f(j)} = ${factors}${kv(v, c.dataset.label === "x" || c.dataset.label === "w" ? f(j) : `\\text{slot } ${j}`)}` : null, note: `slot ${j}${names[base + j] !== undefined ? ` (${names[base + j]})` : ""}: ${c.dataset.label} = ${c.dataset.v}` };
    }));
    const grid = (el, sel, coeffs, name, eq) => renderPolyGrid(el.querySelector(sel), coeffs, buildIndexedEquations(coeffs.length, eq), { name, skipAnimation: skip() }).done;
    // Popup terms: each value with its variable underneath (var_label.js kv). Product coefficients are
    // computed on hover (ddCoef: one coefficient of the negacyclic product, 256 BigInt multiplications).
    const qTex = kv("2^{60}", "q");
    const mulKv = (A, B, k, label) => kv(String(ddCoef(A, B, k)), label);

    const chunkLine = P.n_chunks > 1
        ? `x has ${dd.original_vector.length} values, more than the ${P.slots} slots of one N=${P.N} ciphertext, so it is split into ${P.n_chunks} chunks. Chunk ${P.shown_chunk + 1} (features ${base}–${base + P.slots - 1}) holds ${nzSlots.length} of your non-zero values, so it is the one shown.`
        : `All ${dd.original_vector.length} values of x fit in the ${P.slots} slots of one N=${P.N} ciphertext (the other slots are 0).`;
    const rowLine = result && result.task === "multiclass" ? ` The model is multiclass; this traces the row of the predicted class "${dd.row_class}".` : "";

    const steps = [
        {
            eli5: {
                what: `Up close: the real library (TenSEAL) hides its inner numbers, so here the same encryption runs on a small hand-built CKKS where you can see every one: N = ${P.N} coefficients instead of 8192, ${P.slots} slots, one modulus q = 2^60, scale Δ = 2^${Math.log2(P.scale)}. Your numbers go into the slots, then into a formula m(X) exactly like step 2.3.`,
                why: "Same formulas, smaller sizes: small enough to show every coefficient in a grid and recheck each one. Smaller N is not secure; it is only for looking inside.",
                formal: `your numbers → m(X), ${P.N} coefficients.`,
                next: "Next: the secret key s.",
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
                return grid(el, "#ddGrid", dd.encode.m_coeffs, "m", (k) => `m_{${k}} = \\mathrm{round}\\big(${kv(P.scale, "\\Delta")} \\sum_j V^{-1}_{${k},j}\\, z_j\\big) = ${kv(dd.encode.m_coeffs[k], `m_{${k}}`)}`);
            },
        },
        {
            eli5: {
                what: (() => { const c = C.secret().counts; return `The secret key s is a formula with ${P.N} coefficients, each picked at random from −1, 0 or +1 (here ${c["-1"]} × −1, ${c[0]} × 0, ${c[1]} × +1).`; })(),
                why: "Small coefficients keep the noise small when s multiplies things during unlocking. Randomness makes s impossible to guess: there are 3^256 possible keys even at this toy size. Everything else is built from s, and only s unlocks; it stays with you.",
                formal: "s = random formula, coefficients −1 / 0 / +1.",
                next: "Next: the public key built from s.",
            },
            what: (() => { const c = C.secret().counts; return `The secret key s(X): ${P.N} coefficients drawn from {−1, 0, 1} (here ${c["-1"]}× −1, ${c[0]}× 0, ${c[1]}× +1).`; })(),
            why: "Everything else is derived from s: the public key hides it, and only s can undo the encryption. It stays with the client (the data owner).",
            formal: "s ← {−1, 0, 1}^256",
            next: "Next: the public key, built from s.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Secret key")}<div class="poly-label">s(X): ternary secret key</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.keygen.secret_key_s, "s", (k) => `s_{${k}} \\leftarrow \\{-1,0,1\\} = ${kv(dd.keygen.secret_key_s[k], `s_{${k}}`)}`);
            },
        },
        {
            eli5: {
                what: "The public key is two formulas: a, completely random (each coefficient anywhere from 0 to 2^60), and b = −a·s + e, where e is a small random noise formula. (Step 2.5 called them pk₁ = a and pk₀ = b.)",
                why: "b + a·s = e is small: that's the hidden link unlocking relies on later. To everyone else b looks random, because the noise e hides s; finding s from (a, b) is the Ring-LWE problem nobody can solve.",
                formal: "public key = (b, a), b = −a·s + e.",
                next: "Next: locking, part 1 (c0).",
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
                    grid(el, "#ddA", dd.keygen.public_key_a, "a", (k) => `a_{${k}} \\leftarrow \\mathrm{Uniform}(0, ${qTex}) = ${kv(dd.keygen.public_key_a[k], `a_{${k}}`)}`),
                    grid(el, "#ddB", dd.keygen.public_key_b, "b", (k) => `b_{${k}} = \\big(-${mulKv(dd.keygen.public_key_a, dd.keygen.secret_key_s, k, `(a s)_{${k}}`)} + ${kv(dd.keygen.error_e[k], `e_{${k}}`)}\\big) \\bmod ${qTex} = ${kv(dd.keygen.public_key_b[k], `b_{${k}}`)}`),
                ]);
            },
        },
        {
            eli5: {
                what: "c0 = b·u + e1 + m: your formula m, hidden under b times a fresh random formula u (coefficients −1, 0, +1), plus a little noise e1.",
                why: "Without s, b·u looks completely random, so it covers m like a mask. u is new every time, so locking the same numbers twice gives unrelated packages.",
                formal: "c0 = b·u + e1 + m.",
                next: "Next: locking, part 2 (c1).",
            },
            what: "c0 = b·u + e1 + m (mod q), with a fresh ternary u and fresh error e1. The browser recomputes it from b, u, e1 and m and compares every coefficient exactly.",
            why: "The mask b·u looks random without s, so c0 hides m. The fresh u makes two encryptions of the same x look unrelated.",
            formal: "c0 = b·u + e1 + m (mod q)",
            next: "Next: c1 completes the ciphertext.",
            renderVisual: (el) => {
                const r = C.c0();
                el.innerHTML = `${title("Encrypt: c0")}${renderChecks([{ label: `browser: c0 ≡ b·u + e1 + m (mod 2^60), exact (${ms(r)})`, ok: r.ok }])}
                    <div class="poly-label">c0(X)</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.encrypt.c0, "c0", (k) => `c0_{${k}} = \\big(${mulKv(dd.keygen.public_key_b, dd.encrypt.ephemeral_u, k, `(b u)_{${k}}`)} + ${kv(dd.encrypt.error_e1[k], `e1_{${k}}`)} + ${kv(dd.encode.m_coeffs[k], `m_{${k}}`)}\\big) \\bmod ${qTex} = ${kv(dd.encrypt.c0[k], `c0_{${k}}`)}`);
            },
        },
        {
            eli5: {
                what: (() => { const f = C.fresh(); return `c1 = a·u + e2, with the same u and new noise e2. The pair (c0, c1) is the locked package. Unlocked right away as a test: c0 + c1·s gives your numbers back, off by ${e1(f.err)}.`; })(),
                why: "c1 carries u in a form s can use. Unlocking: c0 + c1·s = (−a·s + e)·u + e1 + m + (a·u + e2)·s = m + e·u + e1 + e2·s. The a·u·s parts cancel exactly; only m and small noise remain.",
                formal: "c0 + c1·s = m + small noise.",
                next: "Next chapter: the locked package travels to the server.",
            },
            what: (() => { const f = C.fresh(); return `c1 = a·u + e2 (mod q). (c0, c1) is the ciphertext. Decrypting it right now in the browser gives x back with max error ${e1(f.err)} over all ${P.slots} slots.`; })(),
            why: "c1 carries the u that s needs to cancel the mask: c0 + c1·s = m + small noise, because b + a·s = e is small.",
            formal: "c1 = a·u + e2 (mod q);  c0 + c1·s = m + e·u + e1 + e2·s",
            next: "Next chapter: Transport → server.",
            renderVisual: (el) => {
                const r = C.c1(), f = C.fresh();
                el.innerHTML = `${title("Encrypt: c1")}${renderChecks([
                    { label: `browser: c1 ≡ a·u + e2 (mod 2^60), exact (${ms(r)})`, ok: r.ok },
                    { label: `browser decrypt (c0 + c1·s)/Δ = x (max err ${e1(f.err)}), = client's decrypt`, ok: slotOk(f.err) && f.serverOk },
                ])}${slotTable(shownSlots, [["x", C.xs], ["decrypted", f.slots]], true)}
                    <div class="poly-label">c1(X)</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.encrypt.c1, "c1", (k) => `c1_{${k}} = \\big(${mulKv(dd.keygen.public_key_a, dd.encrypt.ephemeral_u, k, `(a u)_{${k}}`)} + ${kv(dd.encrypt.error_e2[k], `e2_{${k}}`)}\\big) \\bmod ${qTex} = ${kv(dd.encrypt.c1[k], `c1_{${k}}`)}`);
            },
        },
        {
            eli5: {
                what: `Up close (N = ${P.N}): the server first turns the model's weights w into a formula ŵ(X) the same way your numbers became m(X): put them in slots, multiply by Δ, convert. It is not locked.`,
                why: "Locked slots can only be multiplied slot by slot with something in the same slot layout, so the weights must be encoded exactly like your numbers. They belong to the server and aren't secret, so they stay unlocked; multiplying locked × unlocked is much cheaper than locked × locked.",
                formal: "weights → formula ŵ.",
                next: "Next: multiply the locked package by ŵ.",
            },
            what: `Evaluation starts. The server has only the ciphertext and the public keys. The model's weights for the same ${P.slots} features are encoded like x, into ŵ(X).`,
            why: "The weights are not secret from the server, so they stay plaintext. Multiplying a ciphertext by a plaintext polynomial is much cheaper than by another ciphertext.",
            formal: "ŵ = round(Δ · V⁻¹ · (w ‖ w̄))",
            next: "Next: multiply the ciphertext by ŵ.",
            renderVisual: (el) => {
                const r = C.encode();
                el.innerHTML = `${title("Encode the weights")}${renderChecks([{ label: `browser: ŵ(ζ^(5^j))/Δ = w (max err ${e1(r.wErr)})`, ok: r.wErr < 1e-4 }])}
                    ${slotTable(shownSlots, [["w", C.ws], ["decoded", r.mw]], true)}<div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", dd.encode.w_coeffs, "ŵ", (k) => `\\hat w_{${k}} = \\mathrm{round}\\big(${kv(P.scale, "\\Delta")} \\sum_j V^{-1}_{${k},j}\\, w_j\\big) = ${kv(dd.encode.w_coeffs[k], `\\hat w_{${k}}`)}`);
            },
        },
        {
            eli5: {
                what: (() => { const r = C.mul(); return `Both halves are multiplied by ŵ: (c0·ŵ, c1·ŵ). Every slot now holds number × weight, still locked, and the scale is now Δ × Δ = 2^${2 * Math.log2(P.scale)}. ✓ unlocked copy matches the plain products within ${e1(r.err)}.`; })(),
                why: "Unlocking is c0 + c1·s; multiply both halves by ŵ and you get ŵ·(c0 + c1·s) = ŵ·m + noise·ŵ. Multiplying formulas multiplies their slot values one by one. (The real run then rescales; this small version keeps one modulus and simply carries the Δ² scale to the end.)",
                formal: "locked × ŵ = lock(number × weight).",
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
                return grid(el, "#ddGrid", ev.mul_plain.c0, "c0'", (k) => `c0'_{${k}} = ${mulKv(dd.encrypt.c0, dd.encode.w_coeffs, k, `(c0\\,\\hat w)_{${k}}`)} \\bmod ${qTex} = ${kv(ev.mul_plain.c0[k], `c0'_{${k}}`)}`);
            },
        },
    ];

    if (P.n_chunks > 1) {
        steps.push({
            eli5: {
                what: `Your ${dd.original_vector.length} numbers needed ${P.n_chunks} packages of ${P.slots} slots; their products are added package to package.`,
                why: "Adding locked packages adds the hidden numbers slot by slot (unlocking is linear). After this, slot j holds the sum of every product that landed in slot j.",
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
                return grid(el, "#ddGrid", ev.chunk_sum.c0, "c0Σ", (k) => `c0^{\\Sigma}_{${k}} = \\sum_{c=1}^{${P.n_chunks}} c0'^{(c)}_{${k}} \\bmod ${qTex} = ${kv(ev.chunk_sum.c0[k], `c0^{\\Sigma}_{${k}}`)}`);
            },
        });
    }

    ev.rotations.forEach((rot, r) => {
        const got = () => C.rotation(r);
        const span = 2 ** (r + 1);
        steps.push({
            eli5: {
                what: (() => { const g = got(); return `Slide-and-add round ${r + 1} of ${ev.rotations.length}: the locked slots slide over by ${rot.step} and are added to the unslid copy. Each slot now holds a total of ${span} products; slot 0 = ${fmt(g.slots[0])}.`; })(),
                why: `A score needs every product added up, but locked slots only add position to position. Sliding uses a rotation (Galois) key: it rearranges the formula's coefficients, which moves the slots, and the key fixes up the result so the same secret key still unlocks it. Sliding by 64, 32, … 1 halves the distance each time: ${ev.rotations.length} rounds for ${P.slots} slots.`,
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
                return grid(el, "#ddGrid", rot.c0, `c0⁽${r + 1}⁾`, (k) => {
                    const prev = r ? ev.rotations[r - 1].c0[k] : ev.chunk_sum.c0[k];
                    const ks = ddCenter(BigInt(rot.c0[k]) - BigInt(prev));
                    return `c0^{(${r + 1})}_{${k}} = ${kv(prev, `c0^{(${r})}_{${k}}`)} + ${kv(String(ks), `\\mathrm{KS}(\\sigma_{${rot.galois}}(c^{(${r})}))_{0,${k}}`)} \\bmod ${qTex} = ${kv(rot.c0[k], `c0^{(${r + 1})}_{${k}}`)}`;
                });
            },
        });
    });

    steps.push(
        {
            eli5: {
                what: `The model's bias b = ${fmt(dd.bias)} is added to the locked total. It is first multiplied by Δ² (the total's scale) and added to c0 only.`,
                why: "The total sits at scale Δ², so the bias must too, or it would count 2^25 times too little. Only c0 changes, because unlocking is c0 + c1·s. That was the server's last step.",
                formal: "locked score = locked total + Δ²·b.",
                next: "Next chapter: the locked result travels back to you.",
            },
            what: (() => { const r = C.bias(); return `+ b: the bias ${fmt(dd.bias)} is encoded at scale Δ² as a constant polynomial (coefficient 0 = ${r.coeff0}, the rest 0) and added to c0. c1 does not change.`; })(),
            why: "The ciphertext is at scale Δ² after the multiply, so the bias must be encoded at Δ² too, or it would be 2^25 times too small.",
            formal: "c0 ← c0 + round(Δ² b),  c1 unchanged",
            next: "That was the last step on the server. Next chapter: Transport ← client.",
            renderVisual: (el) => {
                const r = C.bias();
                el.innerHTML = `${title("Add the bias")}${renderChecks([
                    { label: `browser: c0 + β exact, c1 unchanged (${ms(r)})`, ok: r.ok },
                    { label: `β decodes to b = ${fmt(dd.bias)} in every slot (max err ${e1(r.biasErr)})`, ok: r.biasErr < 1e-6 },
                ])}<div class="poly-label">β(X): the bias at scale Δ²</div><div id="ddGrid"></div>`;
                return grid(el, "#ddGrid", ev.bias_pt, "β", (k) => `\\beta_{${k}} = \\mathrm{round}\\big(${kv(`2^{${2 * Math.log2(P.scale)}}`, "\\Delta^2")} \\sum_j V^{-1}_{${k},j}\\, ${kv(fmt(dd.bias), "b")}\\big) = ${kv(ev.bias_pt[k], `\\beta_{${k}}`)}`);
            },
        },
        {
            eli5: {
                what: "Up close: you unlock with c0 + c1·s. Substituting: c0 + c1·s = m′ + noise, where m′ is the formula of the scores. ✓ redone exactly.",
                why: "Every step the server did (× ŵ, adding, rotations, + bias) kept the rule \"c0 + c1·s = hidden formula + small noise\" true. Only the real s makes the random masks cancel; any other key leaves noise.",
                formal: "unlocked = c0 + c1·s.",
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
                return grid(el, "#ddGrid", dd.decrypt.m_prime, "m′", (k) => `m'_{${k}} = \\big(${kv(ev.add_bias.c0[k], `c0_{${k}}`)} + ${mulKv(ev.add_bias.c1, dd.keygen.secret_key_s, k, `(c1\\,s)_{${k}}`)}\\big) \\bmod ${qTex} = ${kv(dd.decrypt.m_prime[k], `m'_{${k}}`)}`);
            },
        },
        {
            eli5: {
                what: (() => { const r = C.decrypt(); return `Read the slots: evaluate m′ at the slot points and divide by Δ² (the scale it ended at). Every slot holds the same total; slot 0 is the score, ${fmt(r.score, 6)}. The plain model gives ${fmt(dd.decode.plaintext_score, 6)}${tenScore !== null ? `, and the real TenSEAL run gave ${fmt(tenScore, 6)}` : ""}.`; })(),
                why: "A from-scratch CKKS, TenSEAL, and the plain model agree, up to tiny noise. Dividing by the large scale is what shrinks that noise to almost nothing.",
                formal: "score = slot 0 / Δ².",
                next: "Next: what the score means.",
            },
            what: (() => { const r = C.decrypt(); return `Decode: slot 0 = m′(ζ)/Δ² = ${fmt(r.score, 6)}. The plaintext w·x + b = ${fmt(dd.decode.plaintext_score, 6)}${tenScore !== null ? `, the TenSEAL pipeline gave ${fmt(tenScore, 6)}` : ""}. Difference to plaintext: ${e1(Math.abs(r.score - dd.decode.plaintext_score))}.`; })(),
            why: "Two independent CKKS implementations, one written from scratch, agree with the plaintext model up to CKKS noise. The same math really runs inside TenSEAL.",
            formal: "score = Re m′(ζ^(5^0)) / Δ² ≈ w·x + b",
            next: "Next: the prediction, compared with the plaintext run.",
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
    steps.forEach((st, i) => {
        const draw = st.renderVisual;
        st.renderVisual = (el) => { const out = draw(el); hookSlotTables(el); return out; };
        // The first 5 steps lock (encode, s, pk, c0, c1); the last 2 unlock (decrypt, decode).
        st.stage = i < 5 ? "encrypt" : i >= steps.length - 2 ? "result" : "compute";
    });
    return stage ? steps.filter((st) => st.stage === stage) : steps;
}
