// Transport chapters: "Transport → client" (leg 1, Enc(x) server → client)
// and "Transport ← server" (leg 2, Enc(score) client → server). One shared
// 14-step builder, driven by the real events legN_wrap / legN_unwrap and the
// AES-256-GCM trace from hecrypto/aes_trace.py. Everything shown is checked
// in the browser by aes_check.js: key schedule, all AES rounds, S-box,
// keystream, GHASH and tag (pure JS/BigInt), the RSA-OAEP envelope (BigInt +
// MGF1), and a WebCrypto unwrap + decrypt of the full wire payload with the
// same bit flips the server's tamper test made.
// Components: byte_matrix.js, pbkdf2_graph.js (generic node graph), sub_zoom.js.
const TP_PARTY = { server: "Server (data owner)", client: "Client (compute node)" };

const TP_LEGS = {
    leg1: {
        wrap: "leg1_wrap", unwrap: "leg1_unwrap", from: "server", to: "client", recipientRsa: "rsa_keygen_client",
        payload: (r) => {
            const s = findEv(r, "ckks_encrypt").data_after.serialization;
            return { sha: s.sha256, size: s.size_bytes, name: "Enc(x)", desc: "your CKKS-encrypted feature vector", origin: "Encryption" };
        },
        inner: "the client computes on the CKKS ciphertext itself",
        next: "Next chapter: the client evaluates the model on Enc(x) without decrypting it.",
    },
    leg2: {
        wrap: "leg2_wrap", unwrap: "leg2_unwrap", from: "client", to: "server", recipientRsa: "rsa_keygen_server",
        payload: (r) => {
            const d = findEv(r, "compute_general_form").data_after;
            const name = r.class_names.length > 2 ? "Enc(scores)" : "Enc(score)";
            return { sha: d.output_ciphertext_sha256, size: d.output_ciphertext_size, name, desc: "the encrypted model output", origin: "Computation" };
        },
        inner: "the server needs the CKKS ciphertext back to decrypt it",
        next: "Next chapter: the server decrypts the result with its CKKS secret key.",
    },
};

const TP_CTR_FLOW = [["nonce>j0"], ["j0>ctr"], ["ctr>aes", "key>aes"], ["aes>ks"], ["ks>xor", "p>xor"], ["xor>c"]];
const tpBlockHex = (m) => [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => m[r][c])).join("");
const tpBits = (hex, bit) => {
    const v = parseInt(hex, 16);
    return [7, 6, 5, 4, 3, 2, 1, 0].map((b) => `<span class="tp-bit${b === bit ? " flip" : ""}">${(v >> b) & 1}</span>`).join("");
};
const tpCheck = (id, text) => `<div class="ks-check" id="${id}">… ${escapeHtml(text)}</div>`;
const tpSetCheck = (root, id, ok, text) => {
    const el = root.querySelector("#" + id);
    if (!el) return;
    el.className = `ks-check ${ok ? "ok" : "bad"}`;
    el.textContent = `${ok ? "✓" : "✕"} ${text}`;
};

function tpCtrGraph(t) {
    const b = t.blocks[0];
    return {
        cols: 4, rows: 4,
        nodes: [
            { id: "nonce", col: 0, row: 0, title: "nonce · 12 random bytes", value: ksShort(t.nonce_hex), full: t.nonce_hex },
            { id: "j0", col: 1, row: 0, title: "J₀ = nonce ‖ 00000001", value: ksShort(t.j0_hex), full: t.j0_hex },
            { id: "ctr", col: 2, row: 0, title: "counter 1 = J₀ + 1", value: ksShort(b.counter_hex), full: b.counter_hex },
            { id: "key", col: 3, row: 0, title: "K · AES-256 key", value: ksShort(t.key_hex), full: t.key_hex },
            { id: "aes", col: 2, row: 1, title: "AES_K · 14 rounds", value: "zoom in ›", full: `AES-256 of ${b.counter_hex}` },
            { id: "ks", col: 2, row: 2, title: "keystream block 1", value: ksShort(b.keystream_hex), full: b.keystream_hex },
            { id: "xor", col: 1, row: 2, title: "⊕ XOR", value: "P₁ ⊕ keystream", full: "byte-wise XOR" },
            { id: "p", col: 0, row: 2, title: "P₁ · first 16 payload bytes", value: ksShort(b.plaintext_hex), full: b.plaintext_hex },
            { id: "c", col: 1, row: 3, title: "C₁ · first ciphertext block", value: ksShort(b.ciphertext_hex), full: b.ciphertext_hex },
        ],
        edges: [
            { from: "nonce", to: "j0", label: "append the 32-bit counter 1" },
            { from: "j0", to: "ctr", label: "increment the last 32 bits" },
            { from: "ctr", to: "aes", label: "the counter block is what AES encrypts" },
            { from: "key", to: "aes", label: "15 round keys from the key schedule" },
            { from: "aes", to: "ks", label: "AES output = keystream" },
            { from: "ks", to: "xor", label: "keystream" },
            { from: "p", to: "xor", label: "payload bytes" },
            { from: "xor", to: "c", label: "ciphertext block" },
        ],
    };
}

// The 5-6 matrices of one AES round, each with a per-cell KaTeX equation.
function tpRoundStages(R) {
    const flat = (m) => m.flat();
    const pre = R.after_mix_columns || R.after_shift_rows;
    const stages = [
        { label: `start of round ${R.round}`, cells: R.start },
        { label: "SubBytes", cells: R.after_sub_bytes, eq: (i) => `S(\\mathtt{${flat(R.start)[i]}}) = \\mathtt{${flat(R.after_sub_bytes)[i]}}` },
        { label: "ShiftRows", cells: R.after_shift_rows, eq: (i) => { const r = i >> 2, c = i & 3; return `s'_{${r},${c}} = s_{${r},${(c + r) % 4}} = \\mathtt{${R.after_shift_rows[r][c]}}`; } },
    ];
    if (R.after_mix_columns) stages.push({
        label: "MixColumns", cells: R.after_mix_columns,
        eq: (i) => {
            const r = i >> 2, c = i & 3;
            const terms = MIX_COEFFS[r].map((k, j) => `${k === 1 ? "" : k + "\\cdot "}\\mathtt{${R.after_shift_rows[j][c]}}`).join(" \\oplus ");
            return `${terms} = \\mathtt{${R.after_mix_columns[r][c]}}`;
        },
    });
    stages.push(
        { label: `round key K${R.round}`, cells: R.round_key, cls: () => "bm-seg-key" },
        { label: "AddRoundKey", cells: R.after_add_round_key, eq: (i) => `\\mathtt{${flat(pre)[i]}} \\oplus \\mathtt{${flat(R.round_key)[i]}} = \\mathtt{${flat(R.after_add_round_key)[i]}}` },
    );
    return stages;
}

async function tpPlayRounds(host, k1, chk, skip) {
    host.innerHTML = `<div class="tp-round-head"></div><div class="tp-stages"></div>
        <div class="tp-round-list"><div class="tp-round-row tp-round-headrow"><span>round</span><span>state after AddRoundKey (block order)</span><span>browser</span></div></div>`;
    const head = host.querySelector(".tp-round-head");
    const stagesEl = host.querySelector(".tp-stages");
    const list = host.querySelector(".tp-round-list");
    for (const R of k1.rounds) {
        if (!host.isConnected) return;
        const rc = chk.rounds[R.round - 1];
        const animate = !skip && R.round === 1;
        head.innerHTML = `Round <strong>${R.round}</strong> of 14${R.round === 14 ? " (no MixColumns in the last round)" : ""} ${ksBadge(rc.ok, "browser recomputed every matrix", "browser recomputation differs")}`;
        stagesEl.innerHTML = "";
        for (const st of tpRoundStages(R)) {
            const box = document.createElement("div");
            box.className = "tp-stage";
            box.innerHTML = `<div class="poly-label">${escapeHtml(st.label)}</div><div></div>`;
            stagesEl.appendChild(box);
            const p = renderByteMatrix(box.lastElementChild, st.cells.flat(), { cols: 4, skipAnimation: !animate, equation: st.eq, cellClass: st.cls });
            if (animate) await p;
        }
        list.insertAdjacentHTML("beforeend", `<div class="tp-round-row"><span>r=${R.round}</span><span>${tpBlockHex(R.after_add_round_key)}</span><span class="${rc.ok ? "tp-ok" : "tp-bad"}">${rc.ok ? "✓" : "✕"}</span></div>`);
        list.scrollTop = list.scrollHeight;
        if (!skip && R.round < 14) await ksPause(R.round === 1 ? 1400 : 800);
    }
}

function buildTransportSteps(result, leg) {
    const L = TP_LEGS[leg];
    const wrapEv = findEv(result, L.wrap), unwrapEv = findEv(result, L.unwrap);
    const w = wrapEv.data_after, u = unwrapEv.data_after, t = w.aes_trace;
    const rsa = findEv(result, L.recipientRsa).data_after;
    const pay = L.payload(result);
    const chk = checkAesGcmTrace(t);
    const from = TP_PARTY[L.from], to = TP_PARTY[L.to];
    const nBlocks = t.total_blocks;
    const k1 = t.keystream1_rounds;
    const g = t.ghash;
    const tamper = u.tamper_test;
    const size = pay.size.toLocaleString();
    const legNo = leg === "leg1" ? 1 : 2;
    const unwrap = () => browserUnwrap(w, rsa, pay.sha, tamper);
    const crumbs = (...parts) => `<div class="sub-zoom-crumbs">${parts.map((x) => `<span>${escapeHtml(x)}</span>`).join("<span>›</span>")}</div>`;
    const aesCrumbs = crumbs(`leg ${legNo} · AES-256-GCM`, "counter mode", "AES_K(counter 1)");
    const graph = tpCtrGraph(t);
    const graphInto = (el, opts) => renderPbkdf2Graph(el, graph, { ...opts, skipAnimation: opts.skipAnimation ?? ksSkip() });
    const title = (s) => `<div class="scene-title">${escapeHtml(s)}</div>`;

    // Step 2 differs per leg: where the AES key came from.
    let keyStep;
    if (leg === "leg1") {
        const pb = findEv(result, "pbkdf2").data_after;
        const same = w.aes_key_hex === pb.derived_key_hex;
        keyStep = {
            what: `The AES-256 key for this trip is the PBKDF2 key from Key Setup: ${w.aes_key_hex}. Compared in your browser with the Key Setup value: ${same ? "identical ✓" : "DIFFERENT ✕"}.`,
            why: "The server and the client never meet to agree on a key. The server derives it from the passphrase; the RSA envelope (step 11) is how the client gets it without ever learning the passphrase.",
            formal: `k = PBKDF2-HMAC-SHA256(P, salt, ${pb.iterations.toLocaleString()}, 32) = ${w.aes_key_hex}`,
            checks: [{ label: "k = Key Setup's PBKDF2 output T", ok: same }],
        };
    } else {
        const kEv = findEv(result, "leg2_session_key");
        const leg1Key = findEv(result, "leg1_wrap").data_after.aes_key_hex;
        const fresh = w.aes_key_hex === kEv.data_after.aes_key_hex && w.aes_key_hex !== leg1Key;
        keyStep = {
            what: `${kEv.description} Browser check: it is the key this trip uses, and it differs from the leg-1 key: ${fresh ? "✓" : "✕"}.`,
            why: kEv.why,
            formal: `${kEv.formal} = ${w.aes_key_hex}`,
            checks: [
                { label: "k₂ = the key leg 2 encrypts with", ok: w.aes_key_hex === kEv.data_after.aes_key_hex },
                { label: "k₂ ≠ the leg-1 PBKDF2 key", ok: w.aes_key_hex !== leg1Key },
            ],
        };
    }

    return [
        {
            what: `${from} → ${to}: ${pay.name} (${size} bytes, ${pay.desc}, SHA-256 ${ksShort(pay.sha)}) must cross the network. It is sealed in two layers: AES-256-GCM encrypts the bytes and adds a 16-byte tag, and RSA-OAEP locks the AES key so only the ${L.to} can open it.`,
            why: `CKKS already hides the values, but it does not stop tampering: bytes changed on the way would silently corrupt the result. This layer makes any change detectable and lets only the intended machine open the bytes. CKKS stays on the inside because ${L.inner}; nothing can be computed on AES bytes.`,
            formal: `wire = (RSA-OAEP_{pk_${L.to}}(k), nonce, AES-GCM_k(${pay.name}), tag)`,
            next: "Next: the AES key this trip uses.",
            renderVisual: (el) => {
                el.innerHTML = `${title(`Transport leg ${legNo}: ${from} → ${to}`)}
                    <div class="scene-body">
                        <div class="tp-layers ${ksRevealClass()}">
                            <div class="tp-layer tp-layer-rsa"><span class="tp-layer-name">RSA-OAEP envelope</span><span class="tp-layer-note">holds the 32-byte AES key · ${w.encrypted_aes_key_size} bytes · opens only with the ${L.to}'s private key</span></div>
                            <div class="tp-layer tp-layer-gcm"><span class="tp-layer-name">AES-256-GCM</span><span class="tp-layer-note">nonce ${w.nonce_size} B · ciphertext ${w.aes_ciphertext_size.toLocaleString()} B · tag ${w.tag_size} B · header "${escapeHtml(w.aad_utf8)}"</span>
                                <div class="tp-layer tp-layer-ckks"><span class="tp-layer-name">${escapeHtml(pay.name)} · CKKS ciphertext</span><span class="tp-layer-note">${size} bytes from the ${escapeHtml(pay.origin)} chapter · sha256 ${escapeHtml(pay.sha)}</span></div>
                            </div>
                        </div>
                        <div class="transport-track">
                            <span class="transport-endpoint">${escapeHtml(from)}</span>
                            <span class="transport-endpoint">${escapeHtml(to)}</span>
                        </div>
                    </div>`;
            },
        },
        {
            ...keyStep,
            next: "Next: AES-256 expands this key into 15 round keys.",
            renderVisual: (el) => {
                const kb = bytesOfHex(w.aes_key_hex);
                el.innerHTML = `${title(leg === "leg1" ? "The AES key: from PBKDF2" : "The AES key: fresh and random")}
                    <div class="scene-body"><div id="tpKey"></div>${renderChecks(keyStep.checks)}</div>`;
                return renderByteMatrix(el.querySelector("#tpKey"), kb, {
                    cols: 8, skipAnimation: ksSkip(), cellClass: () => "bm-seg-key",
                    equation: (i) => `k_{${i}} = \\mathtt{${kb[i]}}`,
                });
            },
        },
        {
            what: `The 32-byte key becomes 60 four-byte words w₀…w₅₉ = 15 round keys K₀…K₁₄ (one to start, one per round). Your browser re-ran the expansion: all 60 words ${chk.wordsOk ? "match ✓" : "DIFFER ✕"}, all 15 round keys ${chk.roundKeysOk ? "match ✓" : "DIFFER ✕"}.`,
            why: "AES never reuses the raw key in every round. Each round gets its own 16 bytes, derived from earlier words through the S-box and a round constant, so every key bit influences every round differently.",
            formal: "w_i = w_{i−8} ⊕ f(w_{i−1}); f = SubWord(RotWord(·)) ⊕ Rcon (i ≡ 0 mod 8), SubWord (i ≡ 4 mod 8), identity otherwise",
            next: "Next: the nonce and the counter blocks AES will encrypt.",
            renderVisual: (el) => {
                const words = t.key_expansion.words;
                const notes = Object.fromEntries(t.key_expansion.derivations.map((dv) => [dv.i, dv]));
                el.innerHTML = `${title("AES-256 key schedule")}
                    <div class="scene-body">
                        <div class="vector-caption">60 words, one row per round key (hover a word for how it was made). ${ksBadge(chk.wordsOk && chk.roundKeysOk, "browser recomputation matches", "browser recomputation differs")}</div>
                        <div id="tpSchedule" class="ks-tall"></div>
                        <div class="ks-legend"><span class="bm-seg-key">the key itself (w₀–w₇)</span><span class="bm-seg-salt">RotWord + SubWord + Rcon</span><span class="bm-seg-int">SubWord</span><span>w_{i−8} ⊕ w_{i−1}</span></div>
                    </div>`;
                return renderByteMatrix(el.querySelector("#tpSchedule"), words, {
                    cols: 4, skipAnimation: ksSkip(),
                    rowLabels: words.filter((_, i) => i % 4 === 0).map((_, r) => `K${r}`),
                    cellClass: (i) => (i < 8 ? "bm-seg-key" : i % 8 === 0 ? "bm-seg-salt" : i % 8 === 4 ? "bm-seg-int" : ""),
                    title: (i) => {
                        const dv = notes[i];
                        if (i < 8) return `w${i} = key bytes ${4 * i}–${4 * i + 3}`;
                        if (!dv) return `w${i} = w${i - 8} ⊕ w${i - 1} = ${words[i]}`;
                        return dv.kind === "SubWord"
                            ? `w${i}: SubWord(${dv.prev}) = ${dv.after_subword}; ⊕ w${i - 8} (${dv.w_i_minus_8}) = ${dv.result}`
                            : `w${i}: RotWord(${dv.prev}) = ${dv.after_rotword}; SubWord = ${dv.after_subword}; ⊕ Rcon ${dv.rcon} = ${dv.after_rcon}; ⊕ w${i - 8} (${dv.w_i_minus_8}) = ${dv.result}`;
                    },
                    equation: (i) => {
                        if (i < 8) return `w_{${i}} = k_{${4 * i}..${4 * i + 3}} = \\mathtt{${words[i]}}`;
                        if (i % 8 === 0) return `w_{${i}} = w_{${i - 8}} \\oplus \\mathrm{SubWord}(\\mathrm{RotWord}(w_{${i - 1}})) \\oplus \\mathrm{Rcon}_{${i / 8}} = \\mathtt{${words[i]}}`;
                        if (i % 8 === 4) return `w_{${i}} = w_{${i - 8}} \\oplus \\mathrm{SubWord}(w_{${i - 1}}) = \\mathtt{${words[i]}}`;
                        return `w_{${i}} = w_{${i - 8}} \\oplus w_{${i - 1}} = \\mathtt{${words[i]}}`;
                    },
                });
            },
        },
        {
            what: `Nonce: 12 random bytes ${t.nonce_hex}. J₀ = nonce ‖ 00000001. The payload's ${nBlocks.toLocaleString()} 16-byte blocks use counters J₀+1 … J₀+${nBlocks.toLocaleString()}; AES_K(J₀) itself is kept for the tag. Browser recomputed the first ${chk.blocks.length} counters: ${chk.blocks.every((b) => b.counterOk) ? "✓" : "✕"}.`,
            why: "GCM turns AES into a stream cipher: AES encrypts counters, never your data directly. A fresh random nonce per message means the same key never produces the same keystream twice; reusing one would leak the XOR of two messages.",
            formal: `J₀ = N ‖ 0³¹1; ctr_i = inc₃₂^i(J₀), i = 1…${nBlocks.toLocaleString()}`,
            next: "Next: how one counter becomes one ciphertext block.",
            renderVisual: (el) => {
                const j0 = bytesOfHex(t.j0_hex);
                el.innerHTML = `${title("Nonce and counter blocks")}
                    <div class="scene-body">
                        <div class="vector-caption">J₀, 16 bytes:</div>
                        <div id="tpJ0"></div>
                        <div class="ks-legend"><span class="bm-seg-salt">nonce (12 random bytes)</span><span class="bm-seg-int">32-bit counter</span></div>
                        <div class="tp-table ${ksRevealClass()}">
                            <div class="tp-row tp-headrow"><span>block</span><span>counter block</span><span>browser</span></div>
                            <div class="tp-row"><span>J₀ (tag)</span><span>${escapeHtml(t.j0_hex)}</span><span></span></div>
                            ${t.blocks.map((b, k) => `<div class="tp-row"><span>${b.index}</span><span>${escapeHtml(b.counter_hex)}</span><span class="${chk.blocks[k].counterOk ? "tp-ok" : "tp-bad"}">${chk.blocks[k].counterOk ? "✓" : "✕"}</span></div>`).join("")}
                            <div class="tp-gap">… ${(nBlocks - t.blocks.length).toLocaleString()} more counters, up to J₀ + ${nBlocks.toLocaleString()} …</div>
                        </div>
                    </div>`;
                return renderByteMatrix(el.querySelector("#tpJ0"), j0, {
                    cols: 16, skipAnimation: ksSkip(), cellClass: (i) => (i < 12 ? "bm-seg-salt" : "bm-seg-int"),
                    equation: (i) => (i < 12 ? `N_{${i}} \\leftarrow \\text{random} = \\mathtt{${j0[i]}}` : `\\text{counter byte } ${i - 12} = \\mathtt{${j0[i]}}`),
                });
            },
        },
        {
            what: `Counter mode, block 1: counter 1 → AES_K → keystream ${ksShort(chk.ks1Hex)}, XORed with the first 16 bytes of ${pay.name} → C₁ = ${ksShort(t.blocks[0].ciphertext_hex)}. The other ${(nBlocks - 1).toLocaleString()} blocks work the same way with the next counters.`,
            why: `Only the counters pass through AES; the payload is just XORed with the result. So the ciphertext is exactly as long as the input (${size} bytes, no padding), and every block can be computed in parallel.`,
            formal: "C_i = P_i ⊕ AES_K(ctr_i)",
            next: "Next: zoom into the AES_K box.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Counter mode, node by node")}<div class="scene-body"><div class="ks-graph"></div></div>`;
                return graphInto(el.querySelector(".ks-graph"), { lit: ["nonce", "key", "p"], flow: TP_CTR_FLOW });
            },
        },
        {
            what: `Inside AES_K(counter 1): the 16 counter bytes fill a 4×4 state column by column, and AddRoundKey XORs round key K₀ (the first 16 key bytes) into it. Browser: input state ${chk.inputOk ? "✓" : "✕"}, K₀ ⊕ state ${chk.initOk ? "✓" : "✕"}.`,
            why: "AES works on a 4×4 grid of bytes. Everything that follows is 14 rounds of the same four operations on this grid.",
            formal: "s[r][c] = ctr₁[r + 4c]; s ← s ⊕ K₀",
            next: "Next: the 14 rounds, matrix by matrix.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Inside AES: the state matrix")}<div class="scene-body ks-zoom-host"></div>`;
                const zs = createSubZoomStage(el.querySelector(".ks-zoom-host"));
                const build = (inner, skip) => {
                    inner.innerHTML = `${aesCrumbs}
                        <div class="ks-matrix-trio">
                            <div><div class="poly-label">counter 1 as state</div><div id="tpIn"></div></div>
                            <div><div class="poly-label">round key K₀</div><div id="tpK0"></div></div>
                            <div><div class="poly-label">state ⊕ K₀ ${ksBadge(chk.initOk, "", "")}</div><div id="tpArk0"></div></div>
                        </div>`;
                    const ins = k1.input_state.flat(), rk = k1.round_key_0.flat(), out = k1.after_initial_add_round_key.flat();
                    const opts = (extra) => ({ cols: 4, skipAnimation: skip, ...extra });
                    return renderByteMatrix(inner.querySelector("#tpIn"), ins, opts({ equation: (i) => `s_{${i >> 2},${i & 3}} = \\mathrm{ctr}_{${(i >> 2) + 4 * (i & 3)}} = \\mathtt{${ins[i]}}` }))
                        .then(() => renderByteMatrix(inner.querySelector("#tpK0"), rk, opts({ cellClass: () => "bm-seg-key", equation: (i) => `K_0[${i >> 2}][${i & 3}] = \\mathtt{${rk[i]}}` })))
                        .then(() => renderByteMatrix(inner.querySelector("#tpArk0"), out, opts({ equation: (i) => `\\mathtt{${ins[i]}} \\oplus \\mathtt{${rk[i]}} = \\mathtt{${out[i]}}` })));
                };
                const lit = ["nonce", "j0", "ctr", "key", "p"];
                if (ksSkip()) { subZoomShow(zs, "inner", (inner) => build(inner, true)); return undefined; }
                let done;
                return graphInto(zs.outer, { lit, focus: "aes", flow: [["ctr>aes", "key>aes"]] })
                    .then(() => ksPause(500))
                    .then(() => subZoomInto(zs, '[data-node="aes"]', (inner) => { done = build(inner, false); }))
                    .then(() => done);
            },
        },
        {
            what: `14 rounds, each SubBytes → ShiftRows → MixColumns (skipped in round 14) → AddRoundKey with K_r. Your browser recomputed all ${k1.rounds.length * 4 - 1} stage matrices, each from its own previous result: ${chk.roundsOk ? "all match ✓" : "MISMATCH ✕"}. Output = keystream block 1 = ${chk.ks1Hex} ${chk.ks1Ok ? "✓" : "✕"}.`,
            why: "SubBytes is the only non-linear step: it breaks any algebraic shortcut. ShiftRows and MixColumns spread each byte across the whole grid, and AddRoundKey mixes the key in. After 14 rounds every output bit depends on every key bit and every input bit.",
            formal: "s ← ARK_r(MC(SR(SB(s)))), r = 1…13; s ← ARK_14(SR(SB(s))); MC column: [2 3 1 1; 1 2 3 1; 1 1 2 3; 3 1 1 2] over GF(2⁸)",
            next: "Next: the S-box table SubBytes looks bytes up in.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Inside AES: 14 rounds")}<div class="scene-body">${aesCrumbs}<div class="tp-rounds"></div></div>`;
                return tpPlayRounds(el.querySelector(".tp-rounds"), k1, chk, ksSkip());
            },
        },
        {
            what: `SubBytes' lookup table: 256 entries, S(x) = A·x⁻¹ ⊕ 0x63 in GF(2⁸). Your browser built it from that definition: all 256 ${chk.sboxOk ? "match ✓" : "DIFFER ✕"}. Highlighted: the 16 entries round 1 looked up.`,
            why: "A table built from field inversion has no simple equation linking input bits to output bits. That non-linearity is what defeats linear and differential cryptanalysis.",
            formal: "S(x) = A · x^254 ⊕ 0x63 over GF(2⁸) mod x⁸ + x⁴ + x³ + x + 1 (0 ↦ 0x63)",
            next: "Next: the keystream meets the payload.",
            renderVisual: (el) => {
                const cells = t.sbox.flat();
                const used = new Set(k1.rounds[0].start.flat().map((h) => parseInt(h, 16)));
                const hexDigits = "0123456789abcdef".split("");
                el.innerHTML = `${title("The AES S-box")}
                    <div class="scene-body">
                        <div class="vector-caption">Row = high hex digit of x, column = low digit. ${ksBadge(chk.sboxOk, "rebuilt in your browser", "browser S-box differs")}</div>
                        <div id="tpSbox"></div>
                    </div>`;
                return renderByteMatrix(el.querySelector("#tpSbox"), cells, {
                    cols: 16, revealBy: "row", skipAnimation: ksSkip(),
                    rowLabels: hexDigits.map((h) => `${h}_`), colLabels: hexDigits.map((h) => `_${h}`),
                    cellClass: (i) => (used.has(i) ? "bm-seg-salt" : ""),
                    title: (i) => `S(0x${i.toString(16).padStart(2, "0")}) = 0x${cells[i]}${used.has(i) ? " (used in round 1)" : ""}`,
                    equation: (r) => `S(\\mathtt{${hexDigits[r]}0}) \\ldots S(\\mathtt{${hexDigits[r]}f})`,
                });
            },
        },
        {
            what: `P_i ⊕ keystream_i = C_i for blocks 1–${t.blocks.length}. Your browser ran AES_K on each counter itself: keystreams ${chk.blocks.every((b) => b.keystreamOk) ? "✓" : "✕"}, XORs ${chk.blocks.every((b) => b.xorOk) ? "✓" : "✕"}, and these ${t.blocks.length * 16} bytes are the start of the real ${w.aes_ciphertext_size.toLocaleString()}-byte ciphertext (checked below).`,
            why: `That XOR is the entire encryption. P₁ is the first 16 bytes of the serialized CKKS ciphertext from the ${pay.origin} chapter; after the XOR they look random to anyone without K.`,
            formal: "C_i = P_i ⊕ AES_K(ctr_i); |C| = |P|",
            next: "Next: the tag that seals the ciphertext.",
            renderVisual: (el) => {
                const b = t.blocks[0];
                const P = bytesOfHex(b.plaintext_hex), K = bytesOfHex(b.keystream_hex), C = bytesOfHex(b.ciphertext_hex);
                const head = aesHex(aesB64Bytes(w.aes_ciphertext_b64).slice(0, t.blocks.length * 16));
                const headOk = head === t.blocks.map((x) => x.ciphertext_hex).join("");
                el.innerHTML = `${title("Keystream ⊕ payload")}
                    <div class="scene-body">
                        <div class="vector-caption">Block 1, byte by byte:</div>
                        <div id="tpXor"></div>
                        <div class="tp-table ${ksRevealClass()}">
                            <div class="tp-row tp-row4 tp-headrow"><span>block</span><span>P_i (payload)</span><span>AES_K(ctr_i)</span><span>C_i</span></div>
                            ${t.blocks.map((x, k) => `<div class="tp-row tp-row4"><span>${x.index} ${chk.blocks[k].keystreamOk && chk.blocks[k].xorOk ? "✓" : "✕"}</span><span>${escapeHtml(x.plaintext_hex)}</span><span>${escapeHtml(x.keystream_hex)}</span><span>${escapeHtml(x.ciphertext_hex)}</span></div>`).join("")}
                        </div>
                        ${renderChecks([{ label: `C₁‖C₂‖C₃ = first ${t.blocks.length * 16} bytes of the wire ciphertext (decoded from its base64 in your browser)`, ok: headOk }])}
                    </div>`;
                return renderByteMatrix(el.querySelector("#tpXor"), [...P, ...K, ...C], {
                    cols: 16, skipAnimation: ksSkip(), rowLabels: ["P₁", "keystream", "C₁"],
                    cellClass: (i) => (i < 16 ? "bm-seg-msg" : i < 32 ? "bm-seg-key" : ""),
                    equation: (i) => {
                        const j = i % 16;
                        if (i < 16) return `P_1[${j}] = \\mathtt{${P[j]}}`;
                        if (i < 32) return `\\mathrm{AES}_K(\\mathrm{ctr}_1)[${j}] = \\mathtt{${K[j]}}`;
                        return `\\mathtt{${P[j]}} \\oplus \\mathtt{${K[j]}} = \\mathtt{${C[j]}}`;
                    },
                });
            },
        },
        {
            what: `H = AES_K(0¹²⁸) = ${t.h_hex}. GHASH folds the ${g.aad_blocks} header blocks, all ${g.ciphertext_blocks.toLocaleString()} ciphertext blocks and 1 length block into S with X ← (X ⊕ block)·H in GF(2¹²⁸): ${g.multiplications.toLocaleString()} multiplications, ${g.elapsed_ms.toFixed(0)} ms in Python. Tag = AES_K(J₀) ⊕ S = ${t.tag_hex}. Browser (BigInt): H ${chk.hOk ? "✓" : "✕"}, shown multiplications ${chk.ghashOk ? "✓" : "✕"}, length block ${chk.lenOk ? "✓" : "✕"}, AES_K(J₀) ${chk.ekj0Ok ? "✓" : "✕"}, tag ${chk.tagOk ? "✓" : "✕"}.`,
            why: "The tag is a fingerprint of the header and every ciphertext byte that only the key holder can compute. The receiver recomputes it before decrypting anything: one changed bit anywhere gives a different tag, and the message is rejected.",
            formal: "X₀ = 0, X_i = (X_{i−1} ⊕ B_i) · H in GF(2¹²⁸) mod x¹²⁸ + x⁷ + x² + x + 1; S = X_last; tag = AES_K(J₀) ⊕ S",
            next: "Next: sealing the AES key for the recipient with RSA-OAEP.",
            renderVisual: (el) => {
                const rows = [];
                chk.ghash.forEach((st, k) => {
                    if (k && !st.contiguous) rows.push(`<div class="tp-gap">… ${(g.ciphertext_blocks - t.blocks.length).toLocaleString()} more ciphertext blocks, same step each …</div>`);
                    rows.push(`<div class="tp-row tp-row5"><span>${escapeHtml(st.source)} ${st.index}</span><span>${escapeHtml(st.block_hex)}</span><span>${escapeHtml(st.xor_hex)}</span><span>${escapeHtml(st.x_hex)}</span><span class="${st.ok ? "tp-ok" : "tp-bad"}">${st.ok ? "✓" : "✕"}</span></div>`);
                });
                el.innerHTML = `${title("GHASH and the tag")}
                    <div class="scene-body">
                        <div class="vector-caption">Header (authenticated, not encrypted): "${escapeHtml(w.aad_utf8)}" · H = ${escapeHtml(t.h_hex)} ${ksBadge(chk.hOk, "", "")}</div>
                        <div class="tp-table ${ksRevealClass()}">
                            <div class="tp-row tp-row5 tp-headrow"><span>block</span><span>B_i</span><span>X_{i−1} ⊕ B_i</span><span>X_i = (…) · H</span><span>browser</span></div>
                            ${rows.join("")}
                        </div>
                        <div class="tp-tag ${ksRevealClass()}">
                            <div class="tp-row tp-row3"><span>S</span><span>${escapeHtml(g.s_hex)}</span><span></span></div>
                            <div class="tp-row tp-row3"><span>AES_K(J₀)</span><span>${escapeHtml(chk.ekj0Hex)}</span><span class="${chk.ekj0Ok ? "tp-ok" : "tp-bad"}">${chk.ekj0Ok ? "✓" : "✕"}</span></div>
                            <div class="tp-row tp-row3 tp-final"><span>tag = S ⊕ AES_K(J₀)</span><span>${escapeHtml(chk.tagHex)}</span><span class="${chk.tagOk ? "tp-ok" : "tp-bad"}">${chk.tagOk ? "✓" : "✕"}</span></div>
                        </div>
                    </div>`;
            },
        },
        {
            what: `The AES key is sealed with RSA-OAEP under the ${L.to}'s public key (n: ${rsa.bit_lengths.n} bits, e = ${rsa.e}), giving ${w.encrypted_aes_key_size} bytes. To show what is inside, your browser opens it with the ${L.to}'s private key d (c^d mod n in BigInt) and undoes the OAEP padding step by step.`,
            why: "RSA only encrypts a number smaller than n, and it is slow, so it carries just the 32-byte AES key. OAEP mixes in a random seed first, so sealing the same key twice gives different envelopes, and a damaged envelope is detected when it is opened.",
            formal: "EM = c^d mod n = 00 ‖ maskedSeed ‖ maskedDB; seed = maskedSeed ⊕ MGF1(maskedDB, 32); DB = maskedDB ⊕ MGF1(seed, 223) = SHA-256(\"\") ‖ 00…00 ‖ 01 ‖ k",
            next: "Next: the packet on the wire.",
            renderVisual: (el) => {
                el.innerHTML = `${title("RSA-OAEP key envelope")}
                    <div class="scene-body">
                        <div class="vector-caption">c = what travels (${w.encrypted_aes_key_size} bytes, base64):</div>
                        <div class="bignum-box">${escapeHtml(w.encrypted_aes_key_b64)}</div>
                        <div class="ks-verify" id="tpOaepChecks">${tpCheck("tpOaepRsa", "browser: c^d mod n running")}</div>
                        <div class="tp-oaep"><div><div class="poly-label">EM = c^d mod n (256 bytes)</div><div id="tpEm" class="ks-tall"></div></div>
                            <div><div class="poly-label">DB after unmasking (223 bytes)</div><div id="tpDb" class="ks-tall"></div></div></div>
                        <div class="ks-legend"><span class="bm-seg-one">00</span><span class="bm-seg-salt">masked seed / seed</span><span class="bm-seg-msg">lHash = SHA-256("")</span><span class="bm-seg-zero">zero padding</span><span class="bm-seg-int">01 separator</span><span class="bm-seg-key">the AES key</span></div>
                    </div>`;
                return oaepOpen(w.encrypted_aes_key_b64, rsa).then((o) => {
                    if (!el.querySelector("#tpEm")) return undefined;
                    if (o.error) { tpSetCheck(el, "tpOaepRsa", false, `browser: ${o.error}`); return undefined; }
                    const box = el.querySelector("#tpOaepChecks");
                    box.innerHTML = renderChecks([
                        { label: `c^d mod n computed in your browser (${o.ms.toFixed(0)} ms); first byte is 00`, ok: o.firstByteOk },
                        { label: "DB starts with SHA-256(\"\") (no OAEP label)", ok: o.lHashOk },
                        { label: `${o.one - 32} zero bytes, then the 01 separator`, ok: o.zerosOk },
                        { label: `the key inside = ${w.aes_key_hex}`, ok: o.keyHex === w.aes_key_hex },
                    ]);
                    const em = o.em.map((b) => b.toString(16).padStart(2, "0"));
                    const db = o.db.map((b) => b.toString(16).padStart(2, "0"));
                    const dbCls = (i) => (i < 32 ? "bm-seg-msg" : i < o.one ? "bm-seg-zero" : i === o.one ? "bm-seg-int" : "bm-seg-key");
                    return renderByteMatrix(el.querySelector("#tpEm"), em, {
                        cols: 16, revealBy: "row", skipAnimation: true, cellClass: (i) => (i === 0 ? "bm-seg-one" : i < 33 ? "bm-seg-salt" : ""),
                        title: (i) => (i === 0 ? "leading 00" : i < 33 ? `maskedSeed[${i - 1}]` : `maskedDB[${i - 33}]`),
                    }).then(() => renderByteMatrix(el.querySelector("#tpDb"), db, {
                        cols: 16, revealBy: "row", skipAnimation: ksSkip(), cellClass: dbCls,
                        title: (i) => `DB[${i}] = maskedDB[${i}] ⊕ MGF1(seed)[${i}] = 0x${db[i]}`,
                        equation: (r) => `\\mathrm{DB}[${16 * r}..${Math.min(16 * r + 15, db.length - 1)}] = \\mathrm{maskedDB} \\oplus \\mathrm{MGF1}(\\mathrm{seed})`,
                    }));
                });
            },
        },
        {
            what: wrapEv.description,
            why: `Everything the ${L.to} needs travels together. Only the header is readable on the wire, and the tag covers it too, so it cannot be swapped. Total on the wire: ${(w.encrypted_aes_key_size + w.nonce_size + w.aes_ciphertext_size + w.tag_size).toLocaleString()} bytes plus the ${t.aad_len}-byte header.`,
            formal: wrapEv.formal,
            next: `Next: the ${L.to} unwraps it, and your browser does too.`,
            renderVisual: (el) => {
                const field = (name, bytes, note) => `<div class="tp-field"><span class="tp-field-name">${escapeHtml(name)}</span><span class="tp-field-size">${bytes}</span><span class="tp-field-note">${escapeHtml(note)}</span></div>`;
                el.innerHTML = `${title(`On the wire: ${from} → ${to}`)}
                    <div class="scene-body">
                        <div class="transport-track">
                            <span class="transport-endpoint">${escapeHtml(from)}</span>
                            <div class="transport-packet ${ksSkip() ? "transport-packet-arrived" : "transport-packet-outbound"}"></div>
                            <span class="transport-endpoint">${escapeHtml(to)}</span>
                        </div>
                        <div class="tp-fields ${ksRevealClass()}">
                            ${field("header (AAD)", `${t.aad_len} B`, `"${w.aad_utf8}", readable, covered by the tag`)}
                            ${field("RSA-OAEP(k)", `${w.encrypted_aes_key_size} B`, `sealed for the ${L.to} · pk sha256 ${ksShort(w.recipient_public_key_der_sha256)}`)}
                            ${field("nonce", `${w.nonce_size} B`, w.nonce_hex)}
                            ${field("ciphertext", `${w.aes_ciphertext_size.toLocaleString()} B`, `sha256 ${ksShort(w.aes_ciphertext_sha256)}`)}
                            ${field("tag", `${w.tag_size} B`, w.tag_hex)}
                        </div>
                        <div class="vector-caption">The full ciphertext, exactly as sent (base64):</div>
                        <div class="ciphertext-box">${escapeHtml(w.aes_ciphertext_b64)}</div>
                    </div>`;
            },
        },
        {
            what: unwrapEv.description,
            why: `The ${L.to}'s private key opens the envelope, then AES-GCM recomputes the tag over the header and ciphertext and releases the plaintext only if it matches. Your browser repeats the whole unwrap with WebCrypto, independent of Python, on the exact bytes sent.`,
            formal: unwrapEv.formal,
            next: "Next: proof that the tag really catches tampering.",
            renderVisual: (el) => {
                const arrivedOk = u.integrity_preserved && u.tag_verified;
                el.innerHTML = `${title(`${to} unwraps`)}
                    <div class="scene-body">
                        <div class="transport-track">
                            <span class="transport-endpoint">${escapeHtml(from)}</span>
                            <div class="transport-packet transport-packet-arrived"></div>
                            <span class="transport-endpoint">${escapeHtml(to)}</span>
                        </div>
                        <div class="tp-unwrap">
                            <div><div class="poly-label">${escapeHtml(L.to)} (Python, cryptography)</div>
                                ${renderChecks([
                                    { label: "RSA-OAEP opened with its private key", ok: u.aes_key_matches_pbkdf2 ?? u.aes_key_matches_client },
                                    { label: `GCM tag ${ksShort(u.tag_hex)} verified`, ok: u.tag_verified },
                                    { label: `${u.size_bytes.toLocaleString()} bytes, sha256 = what was sent`, ok: arrivedOk },
                                ])}</div>
                            <div><div class="poly-label">your browser (WebCrypto)</div>
                                <div class="ks-verify">
                                    ${tpCheck("tpBKey", "RSA-OAEP decrypt of the envelope")}
                                    ${tpCheck("tpBGcm", "AES-GCM decrypt + tag check of the full ciphertext")}
                                    ${tpCheck("tpBSha", "SHA-256 of the decrypted bytes")}
                                </div></div>
                        </div>
                        <div class="tp-table">
                            <div class="tp-row tp-row3 tp-headrow"><span>where</span><span>SHA-256 of ${escapeHtml(pay.name)}</span><span></span></div>
                            <div class="tp-row tp-row3"><span>${escapeHtml(pay.origin)} chapter</span><span>${escapeHtml(pay.sha)}</span><span></span></div>
                            <div class="tp-row tp-row3"><span>sent (${escapeHtml(L.from)})</span><span>${escapeHtml(u.sent_payload_sha256)}</span><span class="${u.sent_payload_sha256 === pay.sha ? "tp-ok" : "tp-bad"}">${u.sent_payload_sha256 === pay.sha ? "✓" : "✕"}</span></div>
                            <div class="tp-row tp-row3"><span>received (${escapeHtml(L.to)})</span><span>${escapeHtml(u.payload_sha256)}</span><span class="${u.payload_sha256 === pay.sha ? "tp-ok" : "tp-bad"}">${u.payload_sha256 === pay.sha ? "✓" : "✕"}</span></div>
                            <div class="tp-row tp-row3"><span>your browser</span><span id="tpBShaVal">…</span><span id="tpBShaOk"></span></div>
                        </div>
                    </div>`;
                return unwrap().then((b) => {
                    if (!el.querySelector("#tpBKey")) return;
                    if (b.error) { tpSetCheck(el, "tpBKey", false, `browser: ${b.error}`); return; }
                    tpSetCheck(el, "tpBKey", b.keyOk, `RSA-OAEP → k = ${ksShort(b.keyHex)} ${b.keyOk ? "(same key)" : "(DIFFERENT)"}`);
                    tpSetCheck(el, "tpBGcm", true, `tag accepted, ${b.size.toLocaleString()} bytes decrypted in ${b.ms.toFixed(0)} ms`);
                    tpSetCheck(el, "tpBSha", b.shaOk, `sha256 ${ksShort(b.sha)} ${b.shaOk ? "= the CKKS ciphertext sent" : "≠ what was sent"}`);
                    el.querySelector("#tpBShaVal").textContent = b.sha;
                    const okEl = el.querySelector("#tpBShaOk");
                    okEl.className = b.shaOk ? "tp-ok" : "tp-bad";
                    okEl.textContent = b.shaOk ? "✓" : "✕";
                });
            },
        },
        {
            what: `Tamper test on this exact payload: bit ${tamper.bit} of ciphertext byte ${tamper.flipped_byte_index.toLocaleString()} flipped (0x${tamper.byte_before} → 0x${tamper.byte_after}): ${tamper.rejected ? `rejected (${tamper.error})` : "NOT rejected"}. Bit ${tamper.tag_flip.bit} of tag byte ${tamper.tag_flip.flipped_byte_index} flipped: ${tamper.tag_flip.rejected ? "rejected" : "NOT rejected"}. Untouched payload decrypts: ${tamper.untampered_decrypts ? "✓" : "✕"}. Your browser repeats both flips below.`,
            why: "Without the tag, a changed byte would slip through and silently corrupt the CKKS ciphertext, so the result would be garbage and nobody would know. With GCM, one flipped bit changes the recomputed tag, and the message is rejected before any of it is used.",
            formal: "C' = C ⊕ e (e ≠ 0) ⇒ GHASH_H(A, C') ≠ GHASH_H(A, C) ⇒ tag' ≠ tag ⇒ reject",
            next: L.next,
            renderVisual: (el) => {
                const row = (label, flip, id) => `
                    <div class="tp-flip">
                        <div class="tp-flip-head">${escapeHtml(label)} byte ${flip.flipped_byte_index.toLocaleString()} of ${flip.field_size.toLocaleString()}, bit ${flip.bit}</div>
                        <div class="tp-flip-bits"><span>0x${escapeHtml(flip.byte_before)}</span><span class="tp-bits">${tpBits(flip.byte_before, flip.bit)}</span><span>→</span><span class="tp-bits">${tpBits(flip.byte_after, flip.bit)}</span><span>0x${escapeHtml(flip.byte_after)}</span></div>
                        ${renderChecks([{ label: `server (Python): ${flip.rejected ? `rejected with ${flip.error}` : "accepted!"}`, ok: flip.rejected }])}
                        <div class="ks-verify">${tpCheck(id, "browser (WebCrypto): decrypting the flipped copy")}</div>
                    </div>`;
                el.innerHTML = `${title("Tamper test")}
                    <div class="scene-body">
                        <div class="tp-flips ${ksRevealClass()}">
                            ${row("ciphertext", tamper, "tpFlipCt")}
                            ${row("tag", tamper.tag_flip, "tpFlipTag")}
                        </div>
                        ${renderChecks([{ label: "untouched payload decrypts (server)", ok: tamper.untampered_decrypts }])}
                    </div>`;
                return unwrap().then((b) => {
                    if (!el.querySelector("#tpFlipCt")) return;
                    if (b.error) { tpSetCheck(el, "tpFlipCt", false, `browser: ${b.error}`); return; }
                    tpSetCheck(el, "tpFlipCt", b.ctFlipRejected, `browser (WebCrypto): ${b.ctFlipRejected ? "rejected (OperationError)" : "accepted!"}`);
                    tpSetCheck(el, "tpFlipTag", b.tagFlipRejected, `browser (WebCrypto): ${b.tagFlipRejected ? "rejected (OperationError)" : "accepted!"}`);
                });
            },
        },
    ];
}
