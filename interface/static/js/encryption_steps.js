// Encryption chapter: the real CKKS encryption of the feature vector, step by
// step, from event ckks_encrypt (hecrypto/ckks_encode_trace.py): slot
// packing, Δ-scaling, the inverse canonical embedding σ⁻¹ to m(X), RNS
// residues, the public-key encryption and the serialized bytes; the client's
// decryption round trip is a sanity check (✓ on the ciphertext step), not a
// protocol step. Browser checks come from encrypt_check.js.
// Components: byte_matrix.js, pbkdf2_graph.js, split_view.js (pipeline = step 2, its stages 2.1-2.7).
const ENC_FLOW = [["x>slots"], ["slots>scaled"], ["scaled>m"], ["m>rns"], ["rns>enc"], ["enc>bytes"], ["bytes>sha"]];

function encPipelineGraph(result, e) {
    const d = result.x.length, p = e.params;
    return {
        cols: 4, rows: 2,
        nodes: [
            { id: "x", col: 0, row: 0, title: `x · ${d} features`, value: "plaintext" },
            { id: "slots", col: 1, row: 0, title: `${p.slots} slots`, value: `x repeated ${(p.slots / d).toFixed(p.slots % d ? 2 : 0)}×` },
            { id: "scaled", col: 2, row: 0, title: `× Δ = 2^${p.scale_bits}`, value: "fixed point" },
            { id: "m", col: 3, row: 0, title: "σ⁻¹ → m(X)", value: `${p.N} integer coeffs` },
            { id: "rns", col: 3, row: 1, title: `mod q₀, q₁, q₂`, value: `${e.rns.data_primes.length} residues each` },
            { id: "enc", col: 2, row: 1, title: "Enc_pk → (c₀, c₁)", value: `${e.encryption.coefficients_total.toLocaleString()} numbers` },
            { id: "bytes", col: 1, row: 1, title: "serialize + zstd", value: `${e.serialization.size_bytes.toLocaleString()} B` },
            { id: "sha", col: 0, row: 1, title: "SHA-256 → transport", value: ksShort(e.serialization.sha256) },
        ],
        edges: [
            { from: "x", to: "slots", label: "slot[j] = x[j mod d]" },
            { from: "slots", to: "scaled", label: "multiply by the scale" },
            { from: "scaled", to: "m", label: "inverse canonical embedding, then round" },
            { from: "m", to: "rns", label: "Chinese Remainder Theorem" },
            { from: "rns", to: "enc", label: "public-key encryption" },
            { from: "enc", to: "bytes", label: "SEAL serialization" },
            { from: "bytes", to: "sha", label: "fingerprint of the exact bytes" },
        ],
    };
}

function buildEncryptionSteps(result) {
    const loadEv = findEv(result, "load_plaintext");
    const encEv = findEv(result, "ckks_encrypt");
    const e = encEv.data_after;
    const p = e.params, sp = e.slot_packing, sc = e.scaling, ce = e.canonical_embedding;
    const rns = e.rns, en = e.encryption, ser = e.serialization, rt = e.roundtrip;
    const x = result.x, d = x.length, names = result.feature_names || [];
    const N = p.N;
    const coeffs = ce.coeffs_all;
    const title = (s) => `<div class="scene-title">${escapeHtml(s)}</div>`;
    const packing = encCheckPacking(x, sp);
    const scaling = encCheckScaling(sc.values, sc.delta);
    const rnsChk = encCheckRns(rns, coeffs, N);
    const rtChk = encCheckRoundtrip(rt, coeffs, x);
    const leg1Sha = findEv(result, "leg1_wrap").data_after.payload_sha256;
    const rawBytes = d * 8;
    const featName = (i) => names[i] ?? `x[${i}]`;
    const graph = encPipelineGraph(result, e);
    const q0 = BigInt(rns.data_primes[0]);
    const cRangeOk = [...en.c0_mod_q0_first_8, ...en.c1_mod_q0_first_8].every((c) => BigInt(c) >= 0n && BigInt(c) < q0);

    const vec = inputVector(result);
    const preview = (vec.some((v) => v.value !== 0) ? vec.filter((v) => v.value !== 0) : vec).slice(0, 8);
    const vectorHtml = `<div class="vector-row">${preview.map((v) => `
        <div class="vector-cell"><div class="vector-name">${escapeHtml(v.name ?? "x[" + v.index + "]")}</div><div class="vector-value">${fmt(v.value)}</div></div>`).join("")}
        ${vec.length > preview.length ? `<div class="vector-cell more">+${(vec.length - preview.length).toLocaleString()} more</div>` : ""}</div>`;

    const steps = [
        {
            eli5: {
                what: `This is ${srcRef("feature_x", "your input as plain numbers")}: the list x of ${d.toLocaleString()} values from Feature Extraction. Anyone holding them can read them; right now only you (the client) have them.`,
                why: "To let another computer work on them without reading them, they must be locked first, with a lock that still allows maths. That lock is CKKS, and this chapter builds it step by step.",
                formal: `x = your ${d.toLocaleString()} numbers, readable.`,
                next: "Next: the whole locking machine at a glance.",
            },
            what: loadEv.description,
            why: loadEv.why,
            formal: loadEv.formal,
            next: "Next: the whole encryption pipeline at a glance.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Plaintext input")}
                    <div class="scene-body">
                        <div class="vector-caption">Readable feature vector (${vec.length.toLocaleString()} values${vec.length > preview.length ? ", non-zero ones shown" : ""}):</div>
                        ${vectorHtml}
                        <p class="step-text muted">${rawBytes.toLocaleString()} bytes as raw float64 values. Only the client can read this.</p>
                    </div>`;
            },
        },
        {
            eli5: {
                what: `CKKS locks all ${d.toLocaleString()} numbers into one package in 7 stages: copy them into ${p.slots} slots, scale to whole numbers, pack into one formula m(X), split into remainders, lock with the public key into (c₀, c₁), write out as bytes, fingerprint. Out comes ${ser.size_bytes.toLocaleString()} bytes that look like random noise.`,
                why: "Each stage exists because the lock needs a particular shape: whole numbers (scale), a polynomial (m(X)), numbers small enough for a CPU (remainders). Steps 2.1-2.7 follow the stages in order, each with its reason.",
                formal: `${d.toLocaleString()} numbers → 1 locked package (${formatBytes(ser.size_bytes)}).`,
                next: "Next: 2.1, filling the package's slots.",
            },
            what: `CKKS turns x into one ciphertext in 7 stages: pack ${d} values into ${p.slots} slots, scale by Δ = 2^${p.scale_bits}, map to a polynomial m(X) of degree < ${N}, split its coefficients over ${rns.data_primes.length} primes, encrypt under the public key into (c₀, c₁), and serialize to ${ser.size_bytes.toLocaleString()} bytes.`,
            why: `CKKS is built for approximate arithmetic on real numbers, which is what a model needs: the server can multiply and add on the ciphertext, and all ${p.slots} slots are processed by each operation at once (SIMD). ${p.security} Steps 2.1-2.7 go through the stages in order, with this graph on the right.`,
            formal: encEv.formal,
            next: "Next: 2.1, filling the slots.",
            renderVisual: (el) => {
                el.innerHTML = `${title("CKKS encryption, stage by stage")}<div class="scene-body"><div class="ks-graph"></div></div>`;
                return renderPbkdf2Graph(el.querySelector(".ks-graph"), graph, { lit: ["x"], flow: ENC_FLOW, skipAnimation: ksSkip() });
            },
        },
        {
            eli5: {
                what: `One package has ${sp.slots} slots (half of N = ${N}). You have ${d} numbers, so TenSEAL copies them round and round to fill every slot: slot j holds x[j mod ${d}] (the remainder of j ÷ ${d}), giving ${sp.replication.full_copies} full copies${sp.replication.partial_copy_len ? ` plus ${sp.replication.partial_copy_len} extra` : ""}. ${packing.copiesOk && packing.first16Ok ? "✓" : "✕"} copying rule recomputed.`,
                why: "Later the server adds slots together by sliding the package round in a circle (\"rotations\"). With your numbers repeated everywhere, every slide lands on real values instead of empty zeros, so the sum is right wherever it is read. Only the first copy matters at the end.",
                formal: `slot[j] = x[j mod ${d}], j = 0…${sp.slots - 1}.`,
                next: "Next: 2.2, making every number a whole number.",
            },
            eli1: {
                what: "Toy: 3 numbers [a, b, c] into 8 slots gives a, b, c, a, b, c, a, b. Slot 7: ⟨7|j⟩ mod ⟨3|d⟩ = ⟨1|j mod d⟩, so it holds b.",
                why: `Same rule, bigger: ${d} numbers into ${sp.slots} slots, ${sp.replication.full_copies} copies.`,
                formal: "toy: slot[j] = x[j mod 3].",
                next: "Next: whole numbers.",
            },
            what: `x has ${d} values but one ciphertext has ${sp.slots} slots. TenSEAL fills them by repeating x: slot[j] = x[j mod ${d}], giving ${sp.replication.full_copies} full copies${sp.replication.partial_copy_len ? ` and a partial copy of ${sp.replication.partial_copy_len}` : ""}, ${sp.zero_padded_slots} zero-padded slots. Browser check of the rule: ${packing.copiesOk && packing.first16Ok && packing.nonzeroOk ? "✓" : "✕"}.`,
            why: sp.note,
            formal: `z = (x_{j mod ${d}})_{j=0}^{${sp.slots - 1}} ∈ ℝ^${sp.slots}`,
            next: "Next: 2.2, every slot is scaled up to a large integer range.",
            renderVisual: (el) => {
                const nz = new Set(x.map((v, i) => (v !== 0 ? i : -1)).filter((i) => i >= 0));
                // Dense x (every value non-zero): marking non-zeros would light every slot, so mark copy 1 instead.
                const dense = nz.size === d;
                const hot = (i, copy) => (dense ? copy === 0 : nz.has(i));
                const cells = [];
                for (let j = 0; j < sp.slots; j++) {
                    const i = j % d, copy = Math.floor(j / d);
                    cells.push(`<span class="enc-slot${copy % 2 ? " odd" : ""}${hot(i, copy) ? " nz" : ""}" data-j="${j}"></span>`);
                }
                el.innerHTML = `${title(`Slot packing: ${sp.slots} slots`)}
                    <div class="scene-body">
                        <div class="vector-caption">One square per slot, 64 per row. Shades alternate per copy of x; ${dense ? `all ${d} values are non-zero, so the bright squares mark copy 1, x itself` : `bright squares hold one of the ${nz.size} non-zero values`} (hover any square for its value). ${renderChecks([
                            { label: `${sp.replication.full_copies} full copies + ${sp.replication.partial_copy_len} = ${sp.slots}`, ok: packing.copiesOk },
                            { label: "first 16 slots = x[0..15]", ok: packing.first16Ok },
                        ])}</div>
                        <div class="grid-ctl"></div>
                        <div class="enc-slots">${cells.join("")}</div>
                        <div class="ks-legend"><span class="enc-key-even">copy 1, 3, …</span><span class="enc-key-odd">copy 2, 4, …</span><span class="enc-key-nz">${dense ? "copy 1 (= x)" : "non-zero x_i"}</span></div>
                    </div>`;
                const slotEls = [...el.querySelectorAll(".enc-slot")];
                const slotFormula = (j) => ({ tex: `z_{${j}} = x_{${j} \\bmod ${d}} = x_{${j % d}}`, note: `slot ${j} = x[${j % d}] (${featName(j % d)}) = ${fmt(x[j % d])}, copy ${Math.floor(j / d) + 1}` });
                attachFormulaHover(el.querySelector(".enc-slots"), ".enc-slot", (s) => slotFormula(+s.dataset.j));
                // Revealed copy by copy (batched to at most 16 groups), with the same controls as every matrix.
                const copies = Math.ceil(sp.slots / d);
                const batch = Math.max(1, Math.ceil(copies / 16));
                const group = (g) => slotEls.slice(g * batch * d, (g + 1) * batch * d);
                const pop = createFormulaPop();
                const ctrl = createRevealController({
                    count: Math.ceil(copies / batch),
                    delay: (g) => gridRevealDelay(g, 1, 4, 260),
                    show: (g) => group(g).forEach((s) => s.classList.add("on")),
                    point: (g) => {
                        const first = g * batch * d, last = Math.min(sp.slots, (g + 1) * batch * d) - 1;
                        pop.show(group(g)[0], `z_{${first}..${last}} = x_{j \\bmod ${d}}`, `slots ${first}–${last}: copies ${g * batch + 1}–${Math.min(copies, (g + 1) * batch)} of x`);
                    },
                    clear: () => { slotEls.forEach((s) => s.classList.remove("on")); pop.hide(); },
                    finish: () => pop.hide(),
                    alive: () => el.isConnected,
                    skip: ksSkip(),
                });
                createGridControls(el.querySelector(".grid-ctl"), ctrl);
                return ctrl.start().done;
            },
        },
        {
            eli5: {
                what: (() => { const v = sc.values[0]; return `Every number is multiplied by the scale Δ = ${srcRef("ckks_params", `2^${p.scale_bits}`, "Δ")} = ${sc.delta.toLocaleString()} and rounded. Your first value: ${vn(v.x, "x₀")} × ${vn(sc.delta.toLocaleString(), "Δ")} = ${vn(BigInt(v.rounded).toLocaleString(), "round(x₀·Δ)")}. ${scaling.every((v) => v.ok) ? "✓" : "✕"} recomputed.`; })(),
                why: `The lock only works on whole numbers (remainders mod q), so decimals would be lost. Multiplying first keeps them: rounding loses at most 0.5, which is ⟨0.5|max rounding⟩ ÷ ${vn(`2^${p.scale_bits}`, "Δ")} ≈ ${vn((0.5 / sc.delta).toExponential(1), "error")} once divided back, about 12 correct decimals. Why exactly 2^${p.scale_bits}: after a multiplication the scale doubles to 2^${2 * p.scale_bits}, and CKKS divides by one of the ${p.scale_bits}-bit primes to bring it back, so the scale matches those primes.`,
                formal: `whole number = round(value × 2^${p.scale_bits}).`,
                next: "Next: 2.3, all slots packed into one formula.",
            },
            eli1: {
                what: (() => { const v = sc.values[0]; return `Toy scale Δ = 1000: ⟨0.25|x⟩ × ⟨1000|Δ⟩ = ⟨250|m⟩. Real: ${vn(v.x, "x₀")} × ${vn(`2^${p.scale_bits}`, "Δ")} = ${vn(BigInt(v.rounded).toLocaleString(), "m₀")}. At the end: ${vn(BigInt(v.rounded).toLocaleString(), "m₀")} ÷ ${vn(`2^${p.scale_bits}`, "Δ")} = ${vn(v.x, "x₀")} again.`; })(),
                why: "A bigger scale keeps more decimals: Δ = 1000 keeps 3, 2^40 keeps about 12.",
                formal: "toy: ⟨0.25|x⟩ × ⟨1000|Δ⟩ = ⟨250|m⟩.",
                next: "Next: the formula.",
            },
            what: `Each value is multiplied by Δ = 2^${p.scale_bits} = ${sc.delta.toLocaleString()} so its digits survive as an integer. The ${sc.values.length} ${sc.values.length === d ? "" : "non-zero "}values: browser recomputed x·Δ and the rounding for all of them: ${scaling.every((v) => v.ok) ? "✓" : "✕"}.`,
            why: `${sc.note} A 2^${p.scale_bits} scale keeps about ${Math.floor(p.scale_bits * Math.log10(2))} decimal digits of each value.`,
            formal: `Δ·x_i = x_i · 2^${p.scale_bits}; rounding error ≤ 0.5/Δ ≈ ${(0.5 / sc.delta).toExponential(1)}`,
            next: "Next: 2.3, σ⁻¹ turns all slots into one polynomial at once.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Scaling by Δ")}
                    <div class="scene-body">
                        <div class="tp-table ${ksRevealClass()}">
                            <div class="tp-row enc-row5 tp-headrow"><span>slot</span><span>feature</span><span>x_i</span><span>x_i · 2^${p.scale_bits}</span><span>rounded</span></div>
                            ${scaling.map((v) => `<div class="tp-row enc-row5"><span>${v.index}</span><span>${escapeHtml(featName(v.index))}</span><span>${v.x}</span><span>${v.x_times_delta}</span><span class="${v.ok ? "tp-ok" : "tp-bad"}">${escapeHtml(v.rounded)} ${v.ok ? "✓" : "✕"}</span></div>`).join("")}
                        </div>
                    </div>`;
            },
        },
        {
            eli5: {
                what: (() => { const nz = coeffs.map((c, i) => (c !== "0" ? i : -1)).filter((i) => i >= 0); return `All ${p.slots} scaled slots are packed into one polynomial: m(X) = m₀ + m₁·X + m₂·X² + … + m₈₁₉₁·X^8191. The m's are ${N.toLocaleString()} whole-number coefficients; X never gets a value, it only keeps them in order. ${nz.length < N / 4 ? `Only ${nz.length} of the ${N.toLocaleString()} are non-zero here (at X^${nz.slice(0, 4).join(", X^")}${nz.length > 4 ? ", …" : ""})` : `${nz.length.toLocaleString()} of the ${N.toLocaleString()} are non-zero here`}, largest ${BigInt(ce.max_abs_coeff).toLocaleString()}. ${ce.seal_check.matches_seal ? "✓" : "✕"} same as SEAL's own encoder.`; })(),
                why: `The lock (Ring-LWE) works on polynomials, not lists. The coefficients are chosen so that plugging ${p.slots} special points into m(X) and dividing by Δ gives back your slots, so nothing is lost. Maths is done "mod X^${N} + 1": X^${N} counts as −1, so multiplying never makes the formula longer.${(() => { const nz = coeffs.filter((c) => c !== "0").length; return nz < N / 4 ? ` Why so many zeros: your ${d} numbers repeat ${sp.replication.full_copies}× in exact copies, and a pattern that repeats that evenly needs only a few ingredients to describe.` : ` Here ${nz.toLocaleString()} coefficients are non-zero: ${d} numbers don't repeat evenly in ${sp.slots} slots, so it takes almost every ingredient to describe them.`; })()}`,
                formal: `m(X) = Σ mᵢ·Xⁱ, i = 0…${N - 1}; slotⱼ = m(ζⱼ) / Δ.`,
                next: "Next: 2.4, each coefficient split into smaller pieces.",
            },
            eli1: {
                what: "Toy with 2 slots and 2 coefficients: slots (5, 1) are the values of m(X) = m₀ + m₁·X at the points X = 1 and X = −1. Solve: m₀ + m₁ = 5 and m₀ − m₁ = 1, so m₀ = (⟨5|slot 1⟩ + ⟨1|slot 2⟩) ÷ 2 = ⟨3|m₀⟩, m₁ = (⟨5|slot 1⟩ − ⟨1|slot 2⟩) ÷ 2 = ⟨2|m₁⟩. Check: m(1) = ⟨3|m₀⟩ + ⟨2|m₁⟩ = ⟨5|slot 1⟩, m(−1) = ⟨3|m₀⟩ − ⟨2|m₁⟩ = ⟨1|slot 2⟩.",
                why: `The real run does the same with ${p.slots} slots and ${N} coefficients; its special points are complex numbers (points on a circle), but the idea is identical: slots = the formula's values at fixed points.`,
                formal: "toy: (⟨5|slot 1⟩, ⟨1|slot 2⟩) → m(X) = ⟨3|m₀⟩ + ⟨2|m₁⟩X.",
                next: "Next: splitting big numbers.",
            },
            what: `σ⁻¹ maps all ${p.slots} scaled slots to one polynomial m(X) = m₀ + m₁X + … + m_${N - 1}X^${N - 1} with integer coefficients (largest |m_i| = ${Number(ce.max_abs_coeff).toLocaleString()}). SEAL's own encoder gave the same ${N} coefficients (${ce.seal_check.coeffs_differing_from_seal} differ). Your browser evaluates m at all ${p.slots} slot roots to get x back.`,
            why: "The polynomial is chosen so that evaluating it at special complex roots of unity gives back the slot values. Adding or multiplying two such polynomials adds or multiplies all slots at once, which is how one ciphertext operation handles every slot.",
            formal: `m = round(Δ · σ⁻¹(z)); σ(m)_j = m(ζ^{3^j mod ${2 * N}}), ζ = e^{iπ/${N}}`,
            next: "Next: 2.4, the coefficients are stored modulo three primes.",
            renderVisual: (el) => {
                const first = ce.coeffs_first_256;
                el.innerHTML = `${title("σ⁻¹: slots → polynomial m(X)")}
                    <div class="scene-body">
                        <div class="ks-verify">
                            <div class="ks-check ${ce.seal_check.matches_seal ? "ok" : "bad"}">${ce.seal_check.matches_seal ? "✓" : "✕"} client: equals SEAL's CKKSEncoder, all ${N} coefficients</div>
                            ${tpCheck("encReembed", `browser: evaluating m(X) at ${p.slots} roots (${(p.slots * N / 1e6).toFixed(1)}M terms)`)}
                        </div>
                        <div class="vector-caption">m₀ … m₂₅₅ (8 per row; hover a row):</div>
                        <div id="encCoeffs"></div>
                        <div class="vector-caption">All ${N} coefficients:</div>
                        <div class="enc-coeff-box">${coeffs.join(" ")}</div>
                    </div>`;
                const matrix = renderByteMatrix(el.querySelector("#encCoeffs"), first, {
                    cols: 8, revealBy: "row", skipAnimation: ksSkip(),
                    rowLabels: first.filter((_, i) => i % 8 === 0).map((_, r) => `m${8 * r}`),
                    title: (i) => `m_${i} = ${first[i]}`,
                    equation: (r) => `m_{${8 * r}} \\ldots m_{${8 * r + 7}} \\text{ of } \\mathrm{round}(\\Delta \\cdot \\sigma^{-1}(z))`,
                });
                const check = encReembed(coeffs, x, sc.delta).then((r) => {
                    const ok = r.maxErr < 1e-6 && r.maxImag < 1e-6;
                    tpSetCheck(el, "encReembed", ok, `browser: σ(m)/Δ = x in all ${r.slots} slots, worst error ${r.maxErr.toExponential(2)} (client ${ce.reembed_max_abs_error.toExponential(2)}), ${r.ms.toFixed(0)} ms`);
                });
                return Promise.all([matrix, check]);
            },
        },
        {
            eli5: {
                what: (() => { const r = rns.m_mod_q_first_16; return `The full modulus q is a ${p.total_modulus_bits}-bit number, far too big for a CPU's 64-bit numbers. So each coefficient is stored as ${rns.data_primes.length} remainders, one per prime q₀, q₁, q₂ (from Key Setup). m₀ = ${BigInt(coeffs[0]).toLocaleString()} becomes ${r.map((x) => BigInt(x.coeffs[0]).toLocaleString()).join(", ")}. ${rnsChk.allOk ? "✓" : "✕"} primes and remainders recomputed.`; })(),
                why: "The Chinese Remainder Theorem says the remainders after dividing by several different primes pin down the original number exactly (below their product). So the CPU works on small, fast numbers, and the full number can always be rebuilt. This is called RNS, the Residue Number System.",
                formal: `mᵢ → (mᵢ mod q₀, mᵢ mod q₁, mᵢ mod q₂).`,
                next: "Next: 2.5, the actual locking.",
            },
            eli1: {
                what: `Toy primes 5 and 7: the number 23 becomes (⟨23|m⟩ mod ⟨5|q₀⟩, ⟨23|m⟩ mod ⟨7|q₁⟩) = (${vn(23 % 5, "m mod q₀")}, ${vn(23 % 7, "m mod q₁")}). Which number below ⟨5|q₀⟩ × ⟨7|q₁⟩ = ⟨35|q₀·q₁⟩ leaves remainder 3 when divided by 5 and 2 when divided by 7? Only ⟨23|m⟩.`,
                why: "So the pair (3, 2) is as good as 23 itself. The real run uses three primes of 60, 40 and 40 bits.",
                formal: "toy: ⟨23|m⟩ → (⟨3|mod 5⟩, ⟨2|mod 7⟩).",
                next: "Next: locking.",
            },
            what: `The coefficients live modulo q = q₀·q₁·q₂ (${p.total_modulus_bits - p.coeff_mod_bit_sizes[p.coeff_mod_bit_sizes.length - 1]} bits of data primes). Each one is stored as ${rns.data_primes.length} small residues, one per prime. Your browser re-proved every prime (Miller–Rabin), checked q ≡ 1 mod ${2 * N}, and recomputed the first 16 residues per prime: ${rnsChk.allOk ? "all ✓" : "✕"}.`,
            why: `${rns.note} Primes with q ≡ 1 mod 2N allow the fast number-theoretic transform SEAL uses for multiplication.`,
            formal: `m_i ↦ (m_i mod q₀, m_i mod q₁, m_i mod q₂); negative m_i become q_k + m_i`,
            next: "Next: 2.5, the actual encryption under the public key.",
            renderVisual: (el) => {
                const cards = rnsChk.primes.map((q, k) => `
                    <div class="param-card enc-prime">
                        <div class="param-name">${escapeHtml(q.role)}${q.role === "data prime" ? ` q${k}` : ""} · ${q.bits} bits</div>
                        <div class="param-value enc-prime-q">${escapeHtml(q.q)}</div>
                        <div class="param-note">${q.primeOk ? "✓ prime" : "✕ not prime"} · ${q.nttOk ? "✓" : "✕"} q ≡ 1 mod ${2 * N}</div>
                    </div>`).join("");
                const rows = coeffs.slice(0, 16).map((c, i) => `
                    <div class="tp-row enc-row5${c.startsWith("-") ? " enc-neg" : ""}"><span>m${i}</span><span>${escapeHtml(c)}</span>
                        ${rns.m_mod_q_first_16.map((r, k) => `<span class="${rnsChk.residues[k][i] ? "" : "tp-bad"}">${escapeHtml(r.coeffs[i])}</span>`).join("")}</div>`).join("");
                el.innerHTML = `${title("RNS: one coefficient, three residues")}
                    <div class="scene-body">
                        <div class="param-grid enc-primes ${ksRevealClass()}">${cards}</div>
                        <div class="tp-table ${ksRevealClass()}">
                            <div class="tp-row enc-row5 tp-headrow"><span>i</span><span>m_i</span>${rns.m_mod_q_first_16.map((_, k) => `<span>m_i mod q${k}</span>`).join("")}</div>
                            ${rows}
                        </div>
                        <p class="step-text muted">Highlighted rows: negative coefficients, stored as q_k + m_i. ${renderChecks([{ label: "all 48 residues recomputed with BigInt", ok: rnsChk.residues.flat().every(Boolean) }])}</p>
                    </div>`;
            },
        },
        {
            eli5: {
                what: `Locking with the ${srcRef("ckks_pk", "public key")} (pk₀, pk₁): c₀ = pk₀·u + e₀ + m and c₁ = pk₁·u + e₁. Here m is your formula m(X); u is a fresh random formula whose ${N} coefficients are each −1, 0 or 1; e₀ and e₁ are tiny random noise formulas; every product is done mod X^${N} + 1 and mod each prime. The pair (c₀, c₁) is the ciphertext: ⟨2|formulas⟩ × ${vn(rns.data_primes.length, "primes")} × ${vn(N, "N")} = ${vn(en.coefficients_total.toLocaleString(), "numbers")}.`,
                why: `u makes every locking different, so equal inputs can't be spotted. The noise makes the lock hard: without it, s could be solved from the public key with school algebra. Unlocking computes c₀ + c₁·s: the big random parts cancel exactly and leave m + small noise. In this run, m₀ = ${BigInt(coeffs[0]).toLocaleString()} came back as ${BigInt(rt.decrypted_poly_first_16[0]).toLocaleString()} (largest noise ${rt.max_abs_noise_coeff}), which after ÷ 2^${p.scale_bits} is an error of about ${(rt.max_abs_noise_coeff / sc.delta).toExponential(0)}.`,
                formal: "(c₀, c₁) = (pk₀·u + e₀ + m, pk₁·u + e₁).",
                next: "Next: 2.6, writing the locked package down as bytes.",
            },
            eli1: {
                what: `Same as "How HE works": m = ${TOY.x1.m}, u = ${TOY.x1.u}, e₀ = ${TOY.x1.e0}, e₁ = ${TOY.x1.e1}: c₀ = ${vn(TOY.pk0, "pk₀")}×${vn(TOY.x1.u, "u")} + ${vn(TOY.x1.e0, "e₀")} + ${vn(TOY.x1.m, "m")} mod ${vn(TOY.q, "q")} = ${vn(TOY.x1.c0, "c₀")}; c₁ = ${vn(TOY.pk1, "pk₁")}×${vn(TOY.x1.u, "u")} + ${vn(TOY.x1.e1, "e₁")} mod ${vn(TOY.q, "q")} = ${vn(TOY.x1.c1, "c₁")}. Unlock: ${vn(TOY.x1.c0, "c₀")} + ${vn(TOY.x1.c1, "c₁")}×${vn(TOY.s, "s")} mod ${vn(TOY.q, "q")} = ${vn(TOY.dec(TOY.x1), "m + noise")} (m + noise ${vn(TOY.noise(TOY.x1), "noise")}).`,
                why: `The real run: the same two lines, but every number is a formula with ${N} coefficients.`,
                formal: `toy: ${vn(TOY.x1.m, "m")} → (${vn(TOY.x1.c0, "c₀")}, ${vn(TOY.x1.c1, "c₁")}).`,
                next: "Next: bytes.",
            },
            what: `Encryption with the public key: c = (c₀, c₁), two polynomials × ${en.primes_at_level} primes × ${N} coefficients = ${en.coefficients_total.toLocaleString()} numbers, at scale 2^${Math.log2(en.ciphertext_scale)}. Took ${(encEv.elapsed_sec * 1000).toFixed(0)} ms including the checks. Below: the real first 8 coefficients of c₀ and c₁ mod q₀ (browser: all < q₀ ${cRangeOk ? "✓" : "✕"}).`,
            why: `${en.details} The random u and the errors are what make the ciphertext look uniformly random; the CKKS Deep-Dive chapter shows them at N = 256, where they can be displayed.`,
            formal: en.equation.join("; "),
            next: "Next: 2.6, how (c₀, c₁) becomes bytes.",
            renderVisual: (el) => {
                const cs = [...en.c0_mod_q0_first_8, ...en.c1_mod_q0_first_8];
                el.innerHTML = `${title("Public-key encryption")}
                    <div class="scene-body">
                        <div class="enc-eq">${en.equation.map((q) => `<div>${escapeHtml(q)}</div>`).join("")}</div>
                        <div class="vector-caption">${escapeHtml(en.c_note)}</div>
                        <div id="encC"></div>
                        <p class="step-text muted">${escapeHtml(en.source)}.</p>
                    </div>`;
                return renderByteMatrix(el.querySelector("#encC"), cs, {
                    cols: 8, skipAnimation: ksSkip(), rowLabels: ["c₀", "c₁"],
                    cellClass: (i) => (i < 8 ? "bm-seg-msg" : "bm-seg-key"),
                    equation: (i) => (i < 8
                        ? `c_{0,${i}} = (pk_0 u + e_0 + m)_{${i}} \\bmod q_0 = ${cs[i]}`
                        : `c_{1,${i - 8}} = (pk_1 u + e_1)_{${i - 8}} \\bmod q_0 = ${cs[i]}`),
                });
            },
        },
        {
            eli5: {
                what: `The two formulas are written out as bytes: in full that is ${vn(en.ciphertext_polys, "formulas")} formulas × ${vn(rns.data_primes.length, "primes")} primes × ${vn(N, "N")} coefficients × ⟨8|bytes each⟩ bytes = ${vn(ser.theoretical_uncompressed_bytes.toLocaleString(), "raw size")} bytes; zstd compression makes it ${vn(ser.size_bytes.toLocaleString(), "sent size")} (${vn((ser.ratio * 100).toFixed(0) + "%", "sent ÷ raw")}). The header says what follows: the SEAL marker 0xA15E, SEAL version ${ser.seal_header.seal_version}, compression "${ser.seal_header.compr_mode}".`,
                why: "To travel over a network anything has to become one flat row of bytes. The header lets the receiver read them back correctly. Compression saves little, because locked data looks random, and random data barely compresses.",
                formal: `locked package → ${ser.size_bytes.toLocaleString()} bytes.`,
                next: "Next: 2.7, the finished package.",
            },
            what: `Serialized: ${ser.size_bytes.toLocaleString()} bytes vs ${ser.theoretical_uncompressed_bytes.toLocaleString()} for ${ser.theoretical_expr} (${(ser.ratio * 100).toFixed(1)}%). Your browser parses the bytes itself: TenSEAL's wrapper, SEAL's header (version, compression mode, size) and the zstd frame.`,
            why: ser.compression_note,
            formal: `bytes = pb{ size = ${d}, SEAL[0x${ser.seal_header.magic.slice(2)} v${ser.seal_header.seal_version} zstd(c₀, c₁)], scale = 2^${p.scale_bits} }`,
            next: "Next: 2.7, the full ciphertext, as it leaves the client.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Serialized bytes")}
                    <div class="scene-body">
                        <div class="vector-caption">First 32 bytes:</div>
                        <div id="encHead"></div>
                        <div class="ks-legend"><span class="bm-seg-int">TenSEAL: vector size</span><span class="bm-seg-salt">TenSEAL: blob tag + length</span><span class="bm-seg-msg">SEAL header</span><span class="bm-seg-key">zstd frame (compressed c₀, c₁)</span><span class="bm-seg-one">TenSEAL: scale (last 9 bytes)</span></div>
                        <div class="ks-verify" id="encHdrChecks">${tpCheck("encHdr", "browser: parsing the bytes")}</div>
                    </div>`;
                return encSha256(ser.base64).then((s) => {
                    if (!el.querySelector("#encHead")) return undefined;
                    if (s.error) { tpSetCheck(el, "encHdr", false, s.error); return undefined; }
                    const h = encParseHeader(s.bytes, ser.seal_header, d, sc.delta);
                    const b = s.bytes;
                    const tagAt = 2 + b[1]; // field 1 = tag byte, length byte, then b[1] bytes of packed varint
                    const seg = (i) => (i < tagAt ? "bm-seg-int" : i < h.offset ? "bm-seg-salt" : i < h.offset + h.headerSize ? "bm-seg-msg" : "bm-seg-key");
                    const head = Array.from(b.slice(0, 32), (v) => v.toString(16).padStart(2, "0"));
                    const tail = Array.from(b.slice(h.tail), (v) => v.toString(16).padStart(2, "0"));
                    el.querySelector("#encHdrChecks").innerHTML = renderChecks([
                        { label: `TenSEAL field 1: vector size ${h.vecSize} = d`, ok: h.vecSize === d },
                        { label: `SEAL magic ${h.magic}, header ${h.headerSize} B, version ${h.version}`, ok: h.magic === ser.seal_header.magic && h.version === ser.seal_header.seal_version },
                        { label: `compr_mode ${h.comprMode} = zstd, frame magic 28 b5 2f fd at byte ${h.zstdAt}`, ok: h.comprMode === 2 && h.zstd },
                        { label: `SEAL size field ${h.size.toLocaleString()} = blob length`, ok: h.size === h.protoLen },
                        { label: `last 9 bytes (${tail.join(" ")}): scale = ${h.scale} = 2^${p.scale_bits}`, ok: h.scale === sc.delta },
                    ]);
                    return renderByteMatrix(el.querySelector("#encHead"), head, {
                        cols: 16, skipAnimation: ksSkip(), cellClass: seg,
                        title: (i) => `byte ${i} = 0x${head[i]}`,
                        equation: (i) => `\\text{byte } ${i} = \\mathtt{0x${head[i]}}`,
                    });
                });
            },
        },
        {
            eli5: {
                what: `This is the whole locked package, ${formatBytes(ser.size_bytes)}, ${Math.round(ser.size_bytes / rawBytes).toLocaleString()}× bigger than your raw numbers (${rawBytes.toLocaleString()} bytes). Its SHA-256 fingerprint ${ksShort(ser.sha256)} is recorded so the next chapter can prove it arrived unchanged.`,
                why: "This is all that ever leaves your computer. To anyone without the secret key it is noise. Locking makes data much bigger: every one of your numbers is spread over thousands of large coefficients. Extra check (not part of the protocol): you unlocked it once and got your numbers back.",
                formal: "fingerprint = SHA-256(package).",
                next: "Next chapter: the package travels to the server.",
            },
            what: `The full ciphertext, ${ser.size_bytes.toLocaleString()} bytes (${formatBytes(ser.size_bytes)}), ${Math.round(ser.size_bytes / rawBytes).toLocaleString()}× the ${rawBytes.toLocaleString()} bytes of raw float64 values. Your browser hashes the exact bytes with SHA-256; that hash is what Transport → server seals and checks on arrival. Sanity check, not part of the protocol: the client decrypted its own fresh ciphertext once and got x back (max error ${rt.max_abs_error.toExponential(2)}; noise ${rtChk.noiseOk ? "✓" : "✕"}, slots ${rtChk.slotsOk ? "✓" : "✕"} re-checked in your browser).`,
            why: "This is all that ever leaves the client. Without the secret key, getting x back from these bytes means solving the Ring-LWE problem, which is believed hard even for quantum computers.",
            formal: `SHA-256(bytes) = ${ser.sha256}`,
            next: encEv.next_step,
            facts: [{ id: "ckks_ct_sha", label: "SHA-256 fingerprint of your CKKS ciphertext", value: ser.sha256 }],
            renderVisual: (el) => {
                el.innerHTML = `${title("The ciphertext")}
                    <div class="scene-body">
                        <div class="ciphertext-box">${escapeHtml(ser.base64)}</div>
                        <div class="ks-verify" data-fact-src="ckks_ct_sha">
                            ${tpCheck("encSha", "browser: SHA-256 of the decoded bytes")}
                            <div class="ks-check ${leg1Sha === ser.sha256 ? "ok" : "bad"}">${leg1Sha === ser.sha256 ? "✓" : "✕"} = the payload hash Transport → server seals (${ksShort(leg1Sha)})</div>
                        </div>
                        <div class="vector-caption">Sanity check (the client decrypts its own fresh ciphertext once; the protocol's only decryption is at the start of Result):</div>
                        ${renderChecks([
                            { label: `decrypted m(X) = encoded m(X) + small noise (first 16 coefficients, |e| ≤ ${Math.max(...rtChk.noise.map(Math.abs))})`, ok: rtChk.noiseOk },
                            { label: `decoded slots = x (max error ${rt.max_abs_error.toExponential(2)})`, ok: rtChk.slotsOk },
                        ])}
                    </div>`;
                return encSha256(ser.base64).then((s) => {
                    if (s.error) { tpSetCheck(el, "encSha", false, s.error); return; }
                    tpSetCheck(el, "encSha", s.hex === ser.sha256, `browser: SHA-256 of ${s.bytes.length.toLocaleString()} bytes = ${s.hex}`);
                });
            },
        },
    ];
    // Graph order (ENC_FLOW): x -> slots -> ×Δ -> m(X) -> RNS -> Enc -> bytes -> SHA-256.
    // node(i, focus, flow): step i in the split view; every stage before it is already lit.
    const order = ["x", "slots", "scaled", "m", "rns", "enc", "bytes", "sha"];
    const node = (i, focus) => {
        const k = order.indexOf(focus);
        return subStep(steps[i], { graph, focus: [focus], lit: order.slice(0, k), flow: [[`${order[k - 1]}>${focus}`]], caption: "CKKS encryption of your x, stage by stage" });
    };
    return [
        steps[0],              // 1: plaintext x
        steps[1],              // 2: the pipeline graph
        node(2, "slots"),      // 2.1 slot packing
        node(3, "scaled"),     // 2.2 × Δ
        node(4, "m"),          // 2.3 σ⁻¹ -> m(X)
        node(5, "rns"),        // 2.4 RNS residues
        node(6, "enc"),        // 2.5 Enc_pk -> (c0, c1)
        node(7, "bytes"),      // 2.6 serialization
        node(8, "sha"),        // 2.7 the ciphertext + SHA-256 (+ round-trip sanity check)
    ];
}
