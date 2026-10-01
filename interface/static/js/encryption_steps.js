// Encryption chapter: the real CKKS encryption of the feature vector, step by
// step, from event ckks_encrypt (hecrypto/ckks_encode_trace.py): slot
// packing, Δ-scaling, the inverse canonical embedding σ⁻¹ to m(X), RNS
// residues, the public-key encryption, the serialized bytes, and a real
// decryption round trip. Browser checks come from encrypt_check.js.
// Components: byte_matrix.js, pbkdf2_graph.js (generic node graph).
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

    return [
        {
            what: loadEv.description,
            why: loadEv.why,
            formal: loadEv.formal,
            next: "Next: the whole encryption pipeline at a glance.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Plaintext input")}
                    <div class="scene-body">
                        <div class="vector-caption">Readable feature vector (${vec.length.toLocaleString()} values${vec.length > preview.length ? ", non-zero ones shown" : ""}):</div>
                        ${vectorHtml}
                        <p class="step-text muted">${rawBytes.toLocaleString()} bytes as raw float64 values. Only the server can read this.</p>
                    </div>`;
            },
        },
        {
            what: `CKKS turns x into one ciphertext in 7 stages: pack ${d} values into ${p.slots} slots, scale by Δ = 2^${p.scale_bits}, map to a polynomial m(X) of degree < ${N}, split its coefficients over ${rns.data_primes.length} primes, encrypt under the public key into (c₀, c₁), and serialize to ${ser.size_bytes.toLocaleString()} bytes.`,
            why: `CKKS is built for approximate arithmetic on real numbers, which is what a model needs: the client can multiply and add on the ciphertext, and all ${p.slots} slots are processed by each operation at once (SIMD). ${p.security}`,
            formal: encEv.formal,
            next: "Next: stage 1, filling the slots.",
            renderVisual: (el) => {
                el.innerHTML = `${title("CKKS encryption, stage by stage")}<div class="scene-body"><div class="ks-graph"></div></div>`;
                return renderPbkdf2Graph(el.querySelector(".ks-graph"), graph, { lit: ["x"], flow: ENC_FLOW, skipAnimation: ksSkip() });
            },
        },
        {
            what: `x has ${d} values but one ciphertext has ${sp.slots} slots. TenSEAL fills them by repeating x: slot[j] = x[j mod ${d}], giving ${sp.replication.full_copies} full copies${sp.replication.partial_copy_len ? ` and a partial copy of ${sp.replication.partial_copy_len}` : ""}, ${sp.zero_padded_slots} zero-padded slots. Browser check of the rule: ${packing.copiesOk && packing.first16Ok && packing.nonzeroOk ? "✓" : "✕"}.`,
            why: sp.note,
            formal: `z = (x_{j mod ${d}})_{j=0}^{${sp.slots - 1}} ∈ ℝ^${sp.slots}`,
            next: "Next: every slot is scaled up to a large integer range.",
            renderVisual: (el) => {
                const nz = new Set(x.map((v, i) => (v !== 0 ? i : -1)).filter((i) => i >= 0));
                // Dense x (every value non-zero): marking non-zeros would light every slot, so mark copy 1 instead.
                const dense = nz.size === d;
                const hot = (i, copy) => (dense ? copy === 0 : nz.has(i));
                const cells = [];
                for (let j = 0; j < sp.slots; j++) {
                    const i = j % d, copy = Math.floor(j / d);
                    cells.push(`<span class="enc-slot${copy % 2 ? " odd" : ""}${hot(i, copy) ? " nz" : ""}" data-copy="${copy}" title="slot ${j} = x[${i}] (${escapeHtml(featName(i))}) = ${fmt(x[i])}, copy ${copy + 1}"></span>`);
                }
                el.innerHTML = `${title(`Slot packing: ${sp.slots} slots`)}
                    <div class="scene-body">
                        <div class="vector-caption">One square per slot, 64 per row. Shades alternate per copy of x; ${dense ? `all ${d} values are non-zero, so the bright squares mark copy 1, x itself` : `bright squares hold one of the ${nz.size} non-zero values`} (hover any square for its value). ${renderChecks([
                            { label: `${sp.replication.full_copies} full copies + ${sp.replication.partial_copy_len} = ${sp.slots}`, ok: packing.copiesOk },
                            { label: "first 16 slots = x[0..15]", ok: packing.first16Ok },
                        ])}</div>
                        <div class="enc-slots">${cells.join("")}</div>
                        <div class="ks-legend"><span class="enc-key-even">copy 1, 3, …</span><span class="enc-key-odd">copy 2, 4, …</span><span class="enc-key-nz">${dense ? "copy 1 (= x)" : "non-zero x_i"}</span></div>
                    </div>`;
                const slotEls = [...el.querySelectorAll(".enc-slot")];
                if (ksSkip()) { slotEls.forEach((s) => s.classList.add("on")); return undefined; }
                const copies = Math.ceil(sp.slots / d);
                const batch = Math.max(1, Math.ceil(copies / 16));
                return new Promise((resolve) => {
                    let c = 0;
                    const tick = () => {
                        if (!el.isConnected || c >= copies) { slotEls.forEach((s) => s.classList.add("on")); resolve(); return; }
                        slotEls.slice(c * d, (c + batch) * d).forEach((s) => s.classList.add("on"));
                        c += batch;
                        setTimeout(tick, ksSpeedMs(260));
                    };
                    tick();
                });
            },
        },
        {
            what: `Each value is multiplied by Δ = 2^${p.scale_bits} = ${sc.delta.toLocaleString()} so its digits survive as an integer. The ${sc.values.length} ${sc.values.length === d ? "" : "non-zero "}values: browser recomputed x·Δ and the rounding for all of them: ${scaling.every((v) => v.ok) ? "✓" : "✕"}.`,
            why: `${sc.note} A 2^${p.scale_bits} scale keeps about ${Math.floor(p.scale_bits * Math.log10(2))} decimal digits of each value.`,
            formal: `Δ·x_i = x_i · 2^${p.scale_bits}; rounding error ≤ 0.5/Δ ≈ ${(0.5 / sc.delta).toExponential(1)}`,
            next: "Next: σ⁻¹ turns all slots into one polynomial at once.",
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
            what: `σ⁻¹ maps all ${p.slots} scaled slots to one polynomial m(X) = m₀ + m₁X + … + m_${N - 1}X^${N - 1} with integer coefficients (largest |m_i| = ${Number(ce.max_abs_coeff).toLocaleString()}). SEAL's own encoder gave the same ${N} coefficients (${ce.seal_check.coeffs_differing_from_seal} differ). Your browser evaluates m at all ${p.slots} slot roots to get x back.`,
            why: "The polynomial is chosen so that evaluating it at special complex roots of unity gives back the slot values. Adding or multiplying two such polynomials adds or multiplies all slots at once, which is how one ciphertext operation handles every slot.",
            formal: `m = round(Δ · σ⁻¹(z)); σ(m)_j = m(ζ^{3^j mod ${2 * N}}), ζ = e^{iπ/${N}}`,
            next: "Next: the coefficients are stored modulo three primes.",
            renderVisual: (el) => {
                const first = ce.coeffs_first_256;
                el.innerHTML = `${title("σ⁻¹: slots → polynomial m(X)")}
                    <div class="scene-body">
                        <div class="ks-verify">
                            <div class="ks-check ${ce.seal_check.matches_seal ? "ok" : "bad"}">${ce.seal_check.matches_seal ? "✓" : "✕"} server: equals SEAL's CKKSEncoder, all ${N} coefficients</div>
                            ${tpCheck("encReembed", `browser: evaluating m(X) at ${p.slots} roots (${(p.slots * N / 1e6).toFixed(1)}M terms)`)}
                        </div>
                        <div class="vector-caption">m₀ … m₂₅₅ (8 per row; hover a row):</div>
                        <div id="encCoeffs" class="ks-tall"></div>
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
                    tpSetCheck(el, "encReembed", ok, `browser: σ(m)/Δ = x in all ${r.slots} slots, worst error ${r.maxErr.toExponential(2)} (server ${ce.reembed_max_abs_error.toExponential(2)}), ${r.ms.toFixed(0)} ms`);
                });
                return Promise.all([matrix, check]);
            },
        },
        {
            what: `The coefficients live modulo q = q₀·q₁·q₂ (${p.total_modulus_bits - p.coeff_mod_bit_sizes[p.coeff_mod_bit_sizes.length - 1]} bits of data primes). Each one is stored as ${rns.data_primes.length} small residues, one per prime. Your browser re-proved every prime (Miller–Rabin), checked q ≡ 1 mod ${2 * N}, and recomputed the first 16 residues per prime: ${rnsChk.allOk ? "all ✓" : "✕"}.`,
            why: `${rns.note} Primes with q ≡ 1 mod 2N allow the fast number-theoretic transform SEAL uses for multiplication.`,
            formal: `m_i ↦ (m_i mod q₀, m_i mod q₁, m_i mod q₂); negative m_i become q_k + m_i`,
            next: "Next: the actual encryption under the public key.",
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
            what: `Encryption with the public key: c = (c₀, c₁), two polynomials × ${en.primes_at_level} primes × ${N} coefficients = ${en.coefficients_total.toLocaleString()} numbers, at scale 2^${Math.log2(en.ciphertext_scale)}. Took ${(encEv.elapsed_sec * 1000).toFixed(0)} ms including the checks. Below: the real first 8 coefficients of c₀ and c₁ mod q₀ (browser: all < q₀ ${cRangeOk ? "✓" : "✕"}).`,
            why: `${en.details} The random u and the errors are what make the ciphertext look uniformly random; the CKKS Deep-Dive chapter shows them at N = 256, where they can be displayed.`,
            formal: en.equation.join("; "),
            next: "Next: how (c₀, c₁) becomes bytes.",
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
            what: `Serialized: ${ser.size_bytes.toLocaleString()} bytes vs ${ser.theoretical_uncompressed_bytes.toLocaleString()} for ${ser.theoretical_expr} (${(ser.ratio * 100).toFixed(1)}%). Your browser parses the bytes itself: TenSEAL's wrapper, SEAL's header (version, compression mode, size) and the zstd frame.`,
            why: ser.compression_note,
            formal: `bytes = pb{ size = ${d}, SEAL[0x${ser.seal_header.magic.slice(2)} v${ser.seal_header.seal_version} zstd(c₀, c₁)], scale = 2^${p.scale_bits} }`,
            next: "Next: the full ciphertext, as it leaves the server.",
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
            what: `The full ciphertext, ${ser.size_bytes.toLocaleString()} bytes (${formatBytes(ser.size_bytes)}), ${Math.round(ser.size_bytes / rawBytes).toLocaleString()}× the ${rawBytes.toLocaleString()} bytes of raw float64 values. Your browser hashes the exact bytes with SHA-256; that hash is what Transport → client seals and checks on arrival.`,
            why: "This is all that ever leaves the server. Without the secret key, getting x back from these bytes means solving the Ring-LWE problem, which is believed hard even for quantum computers.",
            formal: `SHA-256(bytes) = ${ser.sha256}`,
            next: "Next: proof that these bytes really hold x.",
            renderVisual: (el) => {
                el.innerHTML = `${title("The ciphertext")}
                    <div class="scene-body">
                        <div class="ciphertext-box">${escapeHtml(ser.base64)}</div>
                        <div class="ks-verify">
                            ${tpCheck("encSha", "browser: SHA-256 of the decoded bytes")}
                            <div class="ks-check ${leg1Sha === ser.sha256 ? "ok" : "bad"}">${leg1Sha === ser.sha256 ? "✓" : "✕"} = the payload hash Transport → client seals (${ksShort(leg1Sha)})</div>
                        </div>
                    </div>`;
                return encSha256(ser.base64).then((s) => {
                    if (s.error) { tpSetCheck(el, "encSha", false, s.error); return; }
                    tpSetCheck(el, "encSha", s.hex === ser.sha256, `browser: SHA-256 of ${s.bytes.length.toLocaleString()} bytes = ${s.hex}`);
                });
            },
        },
        {
            what: `Round trip with the secret key: decrypting gives m(X) plus small noise (first 16 coefficients differ by at most ${Math.max(...rtChk.noise.map(Math.abs))}; ${rt.max_abs_noise_coeff} worst shown by the server), and decoding gives back x with max error ${rt.max_abs_error.toExponential(2)} (all ${p.slots} slots: ${rt.all_slots_vs_replicated_max_abs_error.toExponential(2)}). Browser checks: noise ${rtChk.noiseOk ? "✓" : "✕"}, slots ${rtChk.slotsOk ? "✓" : "✕"}.`,
            why: `${rt.noise_note}. The server runs this check only for this walkthrough; in the real flow the next time the secret key is used is the final decryption.`,
            formal: "c₀ + c₁·s = m + e (mod q); x ≈ σ(m + e)/Δ, |e|/Δ ≈ 10⁻¹⁰",
            next: encEv.next_step,
            renderVisual: (el) => {
                const rows = rtChk.noise.map((n, i) => `<div class="tp-row enc-row5"><span>${i}</span><span>${escapeHtml(coeffs[i])}</span><span>${escapeHtml(rt.decrypted_poly_first_16[i])}</span><span class="${Math.abs(n) <= rt.max_abs_noise_coeff ? "tp-ok" : "tp-bad"}">e = ${n}</span><span>${fmt(rt.decrypted_first_16[i], 12)} vs ${fmt(x[i % d], 4)}</span></div>`).join("");
                el.innerHTML = `${title("Decryption round trip")}
                    <div class="scene-body">
                        <div class="tp-table ${ksRevealClass()}">
                            <div class="tp-row enc-row5 tp-headrow"><span>i</span><span>m_i (encoded)</span><span>decrypted</span><span>noise e_i</span><span>slot i decoded vs x</span></div>
                            ${rows}
                        </div>
                        <p class="step-text muted">${escapeHtml(rt.all_slots_note)} ${escapeHtml(rt.source)}.</p>
                    </div>`;
            },
        },
    ];
}
