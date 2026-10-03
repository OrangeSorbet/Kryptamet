// Transport chapters: "Transport → server" (leg 1, Enc(x) client → server)
// and "Transport ← client" (leg 2, Enc(score) server → client). One shared
// 14-step builder, driven by the real events legN_wrap / legN_unwrap and the
// AES-256-GCM trace from hecrypto/aes_trace.py. Everything shown is checked
// in the browser by aes_check.js: key schedule, all AES rounds, S-box,
// keystream, GHASH and tag (pure JS/BigInt), the RSA-OAEP envelope (BigInt +
// MGF1), and a WebCrypto unwrap + decrypt of the full wire payload with the
// same bit flips the client's tamper test made.
// Components: byte_matrix.js, pbkdf2_graph.js (generic node graph), split_view.js (counter mode = step 2, its nodes 2.1-2.7).
const TP_PARTY = { client: "Client (you)", server: "Server (compute node)" };

const TP_LEGS = {
    leg1: {
        wrap: "leg1_wrap", unwrap: "leg1_unwrap", from: "client", to: "server", recipientRsa: "rsa_keygen_server",
        payload: (r) => {
            const s = findEv(r, "ckks_encrypt").data_after.serialization;
            return { sha: s.sha256, size: s.size_bytes, name: "Enc(x)", desc: "your CKKS-encrypted feature vector", origin: "Encryption", fact: "ckks_ct_sha" };
        },
        inner: "the server computes on the CKKS ciphertext itself",
        next: "Next chapter: the server evaluates the model on Enc(x) without decrypting it.",
    },
    leg2: {
        wrap: "leg2_wrap", unwrap: "leg2_unwrap", from: "server", to: "client", recipientRsa: "rsa_keygen_client",
        payload: (r) => {
            const d = findEv(r, "compute_general_form").data_after;
            const name = r.class_names.length > 2 ? "Enc(scores)" : "Enc(score)";
            return { sha: d.output_ciphertext_sha256, size: d.output_ciphertext_size, name, desc: "the encrypted model output", origin: "Computation", fact: "result_ct_sha" };
        },
        inner: "the client needs the CKKS ciphertext back to decrypt it",
        next: "Next chapter: the client decrypts the result with its CKKS secret key.",
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
            { id: "aes", col: 2, row: 1, title: "AES_K · 14 rounds", value: "SubBytes, ShiftRows, MixColumns, AddRoundKey", full: `AES-256 of ${b.counter_hex}` },
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

// The 14 AES rounds, one round per unit, on the shared reveal controls (▶ ❚❚ ‹ › ↺, speed): each round
// shows its stage matrices (hover any cell for its formula) and adds its result to the list below.
function tpPlayRounds(host, k1, chk, skip) {
    host.innerHTML = `<div class="grid-ctl"></div><div class="tp-round-head"></div><div class="tp-stages"></div>
        <div class="tp-round-list"><div class="tp-round-row tp-round-headrow"><span>round</span><span>state after AddRoundKey (block order)</span><span>check</span></div></div>`;
    const head = host.querySelector(".tp-round-head");
    const stagesEl = host.querySelector(".tp-stages");
    const list = host.querySelector(".tp-round-list");
    const showRound = (u) => {
        const R = k1.rounds[u], rc = chk.rounds[u];
        head.innerHTML = `Round <strong>${R.round}</strong> of ${k1.rounds.length}${R.round === 14 ? " (no MixColumns in the last round)" : ""} ${ksBadge(rc.ok, "every matrix recomputed", "recomputation differs")}`;
        stagesEl.innerHTML = "";
        tpRoundStages(R).forEach((st) => {
            const box = document.createElement("div");
            box.className = "tp-stage";
            box.innerHTML = `<div class="poly-label">${escapeHtml(st.label)}</div><div></div>`;
            stagesEl.appendChild(box);
            renderByteMatrix(box.lastElementChild, st.cells.flat(), { cols: 4, skipAnimation: true, equation: st.eq, cellClass: st.cls });
        });
    };
    const ctrl = createRevealController({
        count: k1.rounds.length,
        delay: (u) => gridRevealDelay(u, 1, 2, 6000),
        show: (u) => {
            const R = k1.rounds[u], rc = chk.rounds[u];
            list.insertAdjacentHTML("beforeend", `<div class="tp-round-row" data-r="${u}"><span>r=${R.round}</span><span>${tpBlockHex(R.after_add_round_key)}</span><span class="${rc.ok ? "tp-ok" : "tp-bad"}">${rc.ok ? "✓" : "✕"}</span></div>`);
        },
        point: showRound,
        clear: () => { list.querySelectorAll(".tp-round-row[data-r]").forEach((r) => r.remove()); },
        finish: () => {},
        alive: () => host.isConnected,
        skip,
    });
    createGridControls(host.querySelector(".grid-ctl"), ctrl);
    ctrl.start();
    if (skip) showRound(k1.rounds.length - 1);
    return ctrl.done;
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
    const crumbs = (...parts) => `<div class="graph-crumbs">${parts.map((x) => `<span>${escapeHtml(x)}</span>`).join("<span>›</span>")}</div>`;
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
            eli5: {
                what: `This trip's AES key is ${srcRef("pbkdf2_key", ksShort(pb.derived_key_hex))}: the 32 bytes PBKDF2 made from your passphrase and the ${srcRef("pbkdf2_salt", "salt")} in Key Setup. ${same ? "✓ identical" : "✕ DIFFERENT"}.`,
                why: "AES needs both sides to hold the same key, but you can't just send it in the open. So the key travels inside an RSA envelope (step 4) that only the server can open; the server never learns the passphrase itself.",
                formal: "trip key = the PBKDF2 key.",
            },
            what: `The AES-256 key for this trip is the PBKDF2 key from Key Setup: ${srcRef("pbkdf2_key", w.aes_key_hex)}. Compared in your browser with the Key Setup value: ${same ? "identical ✓" : "DIFFERENT ✕"}.`,
            why: "The client and the server never meet to agree on a key. The client derives it from the passphrase; the RSA envelope (step 4) is how the server gets it without ever learning the passphrase.",
            formal: `k = PBKDF2-HMAC-SHA256(P, salt, ${pb.iterations.toLocaleString()}, 32) = ${w.aes_key_hex}`,
            checks: [{ label: "k = Key Setup's PBKDF2 output T", ok: same }],
        };
    } else {
        const kEv = findEv(result, "leg2_session_key");
        const leg1Key = findEv(result, "leg1_wrap").data_after.aes_key_hex;
        const fresh = w.aes_key_hex === kEv.data_after.aes_key_hex && w.aes_key_hex !== leg1Key;
        keyStep = {
            eli5: {
                what: `For the way back, the server made a brand-new key: 32 random bytes from its operating system, ${ksShort(w.aes_key_hex)}. ${fresh ? "✓ different from the first trip's key" : "✕ NOT new"}.`,
                why: "The server never learned your passphrase, so it can't rebuild the first key. A fresh key per message is safer anyway: one leaked key exposes only one message, and reusing a key with the same counter start would let attackers XOR two messages together.",
                formal: "return key = 32 fresh random bytes.",
            },
            what: `${kEv.description} Browser check: it is the key this trip uses, and it differs from the leg-1 key: ${fresh ? "✓" : "✕"}.`,
            why: kEv.why,
            formal: `${kEv.formal} = ${w.aes_key_hex}`,
            checks: [
                { label: "k₂ = the key leg 2 encrypts with", ok: w.aes_key_hex === kEv.data_after.aes_key_hex },
                { label: "k₂ ≠ the leg-1 PBKDF2 key", ok: w.aes_key_hex !== leg1Key },
            ],
        };
    }

    const steps = [
        {
            eli5: {
                what: `${legNo === 1 ? "Your CKKS ciphertext" : "The CKKS result (still locked)"}, ${size} bytes, travels from the ${L.from} to the ${L.to} in two layers. AES (Advanced Encryption Standard) scrambles the bytes and adds a 16-byte seal; RSA locks the 32-byte AES key with the ${L.to}'s public key. The ${L.to} opens RSA with its private key, gets the AES key, checks the seal, unscrambles, and has the CKKS ${legNo === 1 ? "ciphertext" : "result"} back, still CKKS-locked.`,
                why: "CKKS hides the numbers but can't notice changes: flipped bits would silently give a wrong answer. AES-GCM (Galois/Counter Mode) makes any change detectable and keeps strangers out. Why two tools: AES is fast but needs a shared key; RSA needs no shared secret but is slow and fits only small data. So AES locks the big package and RSA locks only the small AES key (\"hybrid encryption\").",
                formal: legNo === 1 ? "send AES(CKKS ciphertext) + RSA_server-public(AES key)" : "send AES′(CKKS result) + RSA_client-public(AES′ key)",
                next: "Next: how AES scrambles the bytes, as a graph.",
            },
            what: `${from} → ${to}: ${pay.name} (${size} bytes, ${pay.desc}, SHA-256 ${ksShort(pay.sha)}) must cross the network. It is sealed in two layers: AES-256-GCM encrypts the bytes and adds a 16-byte tag, and RSA-OAEP locks the AES key so only the ${L.to} can open it.`,
            why: `CKKS already hides the values, but it does not stop tampering: bytes changed on the way would silently corrupt the result. This layer makes any change detectable and lets only the intended machine open the bytes. CKKS stays on the inside because ${L.inner}; nothing can be computed on AES bytes.`,
            formal: `wire = (RSA-OAEP_{pk_${L.to}}(k), nonce, AES-GCM_k(${pay.name}), tag)`,
            next: "Next: AES-256-GCM counter mode, as a graph of this trip's real values.",
            renderVisual: (el) => {
                el.innerHTML = `${title(`Transport leg ${legNo}: ${from} → ${to}`)}
                    <div class="scene-body tp-seq-row"><div>
                        <div class="tp-layers ${ksRevealClass()}">
                            <div class="tp-layer tp-layer-rsa"><span class="tp-layer-name">RSA-OAEP envelope</span><span class="tp-layer-note">holds the 32-byte AES key · ${w.encrypted_aes_key_size} bytes · opens only with the ${L.to}'s private key</span></div>
                            <div class="tp-layer tp-layer-gcm"><span class="tp-layer-name">AES-256-GCM</span><span class="tp-layer-note">nonce ${w.nonce_size} B · ciphertext ${w.aes_ciphertext_size.toLocaleString()} B · tag ${w.tag_size} B · header "${escapeHtml(w.aad_utf8)}"</span>
                                <div class="tp-layer tp-layer-ckks"><span class="tp-layer-name">${escapeHtml(pay.name)} · CKKS ciphertext</span><span class="tp-layer-note">${size} bytes from the ${escapeHtml(pay.origin)} chapter · sha256 ${escapeHtml(pay.sha)}</span></div>
                            </div>
                        </div>
                        </div>
                        <div><div class="vector-caption">Where this trip sits in the whole run (this leg highlighted):</div>
                        ${sequenceChartSvg(result, [leg])}</div>
                    </div>`;
            },
        },
        {
            ...keyStep,
            eli5: { ...keyStep.eli5, next: "Next: 2.2, AES stretches the key into 15 round keys." },
            next: "Next: 2.2, AES-256 expands this key into 15 round keys.",
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
            eli5: {
                what: (() => { const kx = t.key_expansion, d0 = kx.derivations[0]; return `AES stretches the 32-byte key into 60 words of 4 bytes (15 round keys of 16 bytes, one per round plus one at the start). The key itself gives words w0-w7. Each new word = the word before it ⊕ the word 8 places back; every 8th word is first rotated, byte-swapped and nudged by a round constant. Example: w8 from w7 = ${d0.prev}: rotate → ${d0.after_rotword}, swap bytes → ${d0.after_subword}, ⊕ constant → ${d0.after_rcon}, ⊕ w0 = ${kx.words[8]}. ${chk.wordsOk && chk.roundKeysOk ? "✓" : "✕"} all 60 recomputed.`; })(),
                why: "Each round mixes in a different key piece, so every key bit affects the result many times in many ways. The rotations, byte swaps and constants make the round keys look unrelated to each other, so learning one round key doesn't reveal the rest.",
                formal: "32-byte key → 60 words → 15 round keys.",
                next: "Next: 2.3, the counter numbers AES will scramble.",
            },
            eli1: {
                what: "Toy with 4-bit words: w0 = 1010, w1 = 0110. Rule: next word = (word before, rotated one place left) ⊕ (word two back). w1 rotated = 1100; 1100 ⊕ 1010 = 0110 = w2.",
                why: "The real schedule does this with 32-bit words, looking 8 words back, plus a byte swap and a constant every 8th word.",
                formal: "toy: rot(0110) ⊕ 1010 = 0110.",
                next: "Next: the counters.",
            },
            what: `The 32-byte key becomes 60 four-byte words w₀…w₅₉ = 15 round keys K₀…K₁₄ (one to start, one per round). Your browser re-ran the expansion: all 60 words ${chk.wordsOk ? "match ✓" : "DIFFER ✕"}, all 15 round keys ${chk.roundKeysOk ? "match ✓" : "DIFFER ✕"}.`,
            why: "AES never reuses the raw key in every round. Each round gets its own 16 bytes, derived from earlier words through the S-box and a round constant, so every key bit influences every round differently.",
            formal: "w_i = w_{i−8} ⊕ f(w_{i−1}); f = SubWord(RotWord(·)) ⊕ Rcon (i ≡ 0 mod 8), SubWord (i ≡ 4 mod 8), identity otherwise",
            next: "Next: 2.3, the nonce and the counter blocks AES will encrypt.",
            renderVisual: (el) => {
                const words = t.key_expansion.words;
                const notes = Object.fromEntries(t.key_expansion.derivations.map((dv) => [dv.i, dv]));
                el.innerHTML = `${title("AES-256 key schedule")}
                    <div class="scene-body">
                        <div class="vector-caption">60 words, one row per round key (hover a word for how it was made). ${ksBadge(chk.wordsOk && chk.roundKeysOk, "browser recomputation matches", "browser recomputation differs")}</div>
                        <div id="tpSchedule"></div>
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
            eli5: {
                what: `AES never scrambles your data directly. It scrambles counters: a random 12-byte start (the nonce, "number used once", ${w.nonce_hex}) followed by a 4-byte count. Count 1 (J0) is kept for the seal; counts 2, 3, … are used for the ${nBlocks.toLocaleString()} blocks of 16 bytes (${size} bytes ÷ 16, rounded up).`,
                why: "Scrambling counters makes a stream of random-looking bytes as long as needed, and every 16-byte block can be done in parallel. The nonce must never repeat with the same key: two messages with the same keystream could be XORed against each other to leak both.",
                formal: "counter i = nonce ‖ (i as 4 bytes).",
                next: "Next: 2.4, inside one AES scramble.",
            },
            eli1: {
                what: `Toy: start S = 500, counters 501, 502, 503, …. Real: ${w.nonce_hex} followed by 00000001, 00000002, 00000003, ….`,
                why: "Only the last 4 bytes count up; the random start makes every message's counters different.",
                formal: "toy: 500 + i.",
                next: "Next: one scramble.",
            },
            what: `Nonce: 12 random bytes ${t.nonce_hex}. J₀ = nonce ‖ 00000001. The payload's ${nBlocks.toLocaleString()} 16-byte blocks use counters J₀+1 … J₀+${nBlocks.toLocaleString()}; AES_K(J₀) itself is kept for the tag. Browser recomputed the first ${chk.blocks.length} counters: ${chk.blocks.every((b) => b.counterOk) ? "✓" : "✕"}.`,
            why: "GCM turns AES into a stream cipher: AES encrypts counters, never your data directly. A fresh random nonce per message means the same key never produces the same keystream twice; reusing one would leak the XOR of two messages.",
            formal: `J₀ = N ‖ 0³¹1; ctr_i = inc₃₂^i(J₀), i = 1…${nBlocks.toLocaleString()}`,
            next: "Next: 2.4, inside the AES_K box.",
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
            eli5: {
                what: `Counter mode in one picture: AES scrambles each counter with the key into 16 random-looking bytes (the keystream), and those are XORed with the next 16 bytes of your package. ${nBlocks.toLocaleString()} blocks, all the same way. Each box is one stage, with this run's real value.`,
                why: "XOR with random-looking bytes hides the data; XOR again with the same bytes brings it back, because x ⊕ k ⊕ k = x. So only someone who can rebuild the keystream (who has the key) can undo it. Steps 2.1-2.7 walk through the boxes.",
                formal: "locked block = data block ⊕ AES_key(counter).",
                next: "Next: 2.1, the key.",
            },
            what: `Counter mode, block 1: counter 1 → AES_K → keystream ${ksShort(chk.ks1Hex)}, XORed with the first 16 bytes of ${pay.name} → C₁ = ${ksShort(t.blocks[0].ciphertext_hex)}. The other ${(nBlocks - 1).toLocaleString()} blocks work the same way with the next counters.`,
            why: `Only the counters pass through AES; the payload is just XORed with the result. So the ciphertext is exactly as long as the input (${size} bytes, no padding), and every block can be computed in parallel. Steps 2.1-2.7 go through the boxes in order, with this graph on the right (hover a box for its value, an arrow for what it does).`,
            formal: "C_i = P_i ⊕ AES_K(ctr_i)",
            next: "Next: 2.1, the AES key this trip uses.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Counter mode, node by node")}<div class="scene-body"><div class="ks-graph"></div></div>`;
                return graphInto(el.querySelector(".ks-graph"), { lit: ["nonce", "key", "p"], flow: TP_CTR_FLOW });
            },
        },
        {
            eli5: {
                what: (() => { const s0 = k1.input_state[0][0], r0 = k1.round_key_0[0][0], a0 = k1.after_initial_add_round_key[0][0]; return `AES writes the 16 counter bytes into a 4×4 grid (column by column) called the state, then XORs round key 0 into it, byte by byte. First byte: 0x${s0} ⊕ 0x${r0} = 0x${a0}. ✓ both grids recomputed.`; })(),
                why: "Everything AES does is 14 rounds of reshaping this one grid. Mixing the key in before the first round means even round 1 already depends on the key.",
                formal: "state = counter ⊕ round key 0.",
                next: "Next: 2.5, the byte-swap table every round uses.",
            },
            eli1: {
                what: (() => { const s0 = parseInt(k1.input_state[0][0], 16), r0 = parseInt(k1.round_key_0[0][0], 16), b = (v) => v.toString(2).padStart(8, "0"); return `In bits: ${b(s0)} ⊕ ${b(r0)} = ${b(s0 ^ r0)} (= 0x${(s0 ^ r0).toString(16).padStart(2, "0")}). Same bits give 0, different bits give 1.`; })(),
                why: "All 16 bytes get the same treatment, each with its own key byte.",
                formal: "bitwise XOR.",
                next: "Next: the swap table.",
            },
            what: `Inside AES_K(counter 1): the 16 counter bytes fill a 4×4 state column by column, and AddRoundKey XORs round key K₀ (the first 16 key bytes) into it. Browser: input state ${chk.inputOk ? "✓" : "✕"}, K₀ ⊕ state ${chk.initOk ? "✓" : "✕"}.`,
            why: "AES works on a 4×4 grid of bytes. Everything that follows is 14 rounds of the same four operations on this grid.",
            formal: "s[r][c] = ctr₁[r + 4c]; s ← s ⊕ K₀",
            next: "Next: 2.5, the S-box table SubBytes looks bytes up in.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Inside AES: the state matrix")}<div class="scene-body"></div>`;
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
                return build(el.querySelector(".scene-body"), ksSkip());
            },
        },
        {
            eli5: {
                what: (() => { const R = k1.rounds[0]; return `14 rounds, each with four moves on the grid: SubBytes (replace every byte via the S-box table), ShiftRows (row r slides left by r places), MixColumns (each column's 4 bytes are blended into 4 new ones), AddRoundKey (XOR that round's key). Round 1, first byte: 0x${R.start[0][0]} → S-box → 0x${R.after_sub_bytes[0][0]} → … → 0x${R.after_add_round_key[0][0]}. The last round skips MixColumns. Result: keystream block ${ksShort(k1.ciphertext_hex)}. ${chk.roundsOk ? "✓" : "✕"} every round recomputed.`; })(),
                why: "Each move does one job. SubBytes makes it non-linear (no algebra shortcut), ShiftRows and MixColumns spread every byte over the whole grid, AddRoundKey ties it to the key. After 14 rounds every output byte depends on every input byte and every key byte.",
                formal: "14 × (SubBytes, ShiftRows, MixColumns, AddRoundKey).",
                next: "Next: 2.7, the scrambled counters meet your data.",
            },
            eli1: {
                what: "ShiftRows on a toy grid: rows (a b c d), (e f g h), (i j k l), (m n o p) become (a b c d), (f g h e), (k l i j), (p m n o): row 0 stays, row 1 slides 1, row 2 slides 2, row 3 slides 3.",
                why: "After sliding, each column holds one byte from every original column, so MixColumns then blends bytes that came from everywhere.",
                formal: "toy: row r slides left r places.",
                next: "Next: XOR with your data.",
            },
            what: `14 rounds, each SubBytes → ShiftRows → MixColumns (skipped in round 14) → AddRoundKey with K_r. Your browser recomputed all ${k1.rounds.length * 4 - 1} stage matrices, each from its own previous result: ${chk.roundsOk ? "all match ✓" : "MISMATCH ✕"}. Output = keystream block 1 = ${chk.ks1Hex} ${chk.ks1Ok ? "✓" : "✕"}.`,
            why: "SubBytes is the only non-linear step: it breaks any algebraic shortcut. ShiftRows and MixColumns spread each byte across the whole grid, and AddRoundKey mixes the key in. After 14 rounds every output bit depends on every key bit and every input bit.",
            formal: "s ← ARK_r(MC(SR(SB(s)))), r = 1…13; s ← ARK_14(SR(SB(s))); MC column: [2 3 1 1; 1 2 3 1; 1 1 2 3; 3 1 1 2] over GF(2⁸)",
            next: "Next: 2.7, the keystream meets the payload.",
            renderVisual: (el) => {
                el.innerHTML = `${title("Inside AES: 14 rounds")}<div class="scene-body">${aesCrumbs}<div class="tp-rounds"></div></div>`;
                return tpPlayRounds(el.querySelector(".tp-rounds"), k1, chk, ksSkip());
            },
        },
        {
            eli5: {
                what: (() => { const v = k1.after_initial_add_round_key[0][0]; return `The S-box ("substitution box"): a fixed table that replaces each of the 256 possible byte values with another. Byte 0x${v} is looked up at row ${v[0]}, column ${v[1]}: 0x${t.sbox[parseInt(v[0], 16)][parseInt(v[1], 16)]}. ${chk.sboxOk ? "✓" : "✕"} table rebuilt from its definition.`; })(),
                why: "Every other AES step is \"straight-line\" maths (XOR, shifts, mixing), which clever algebra could untangle. The S-box is built from division in a special 256-number arithmetic, followed by a bit shuffle: a non-straight-line step that blocks those shortcuts. It is fixed and public; the secrecy is only in the key.",
                formal: "byte xy → table[x][y].",
                next: "Next: 2.6, the 14 rounds that use it.",
            },
            eli1: {
                what: (() => { const v = k1.after_initial_add_round_key[0][0]; return `A byte in hex is 2 digits, like ${v}. First digit (${v[0]}) = row, second (${v[1]}) = column. Row ${v[0]}, column ${v[1]} of the table holds ${t.sbox[parseInt(v[0], 16)][parseInt(v[1], 16)]}, so ${v} becomes ${t.sbox[parseInt(v[0], 16)][parseInt(v[1], 16)]}.`; })(),
                why: "Like a secret-decoder table, except everyone has the same table.",
                formal: "lookup, row then column.",
                next: "Next: the rounds.",
            },
            what: `SubBytes' lookup table: 256 entries, S(x) = A·x⁻¹ ⊕ 0x63 in GF(2⁸). Your browser built it from that definition: all 256 ${chk.sboxOk ? "match ✓" : "DIFFER ✕"}. Highlighted: the 16 entries round 1 looked up.`,
            why: "A table built from field inversion has no simple equation linking input bits to output bits. That non-linearity is what defeats linear and differential cryptanalysis.",
            formal: "S(x) = A · x^254 ⊕ 0x63 over GF(2⁸) mod x⁸ + x⁴ + x³ + x + 1 (0 ↦ 0x63)",
            next: "Next: 2.6, the 14 rounds, matrix by matrix.",
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
            eli5: {
                what: (() => { const b = t.blocks[0]; return `Each 16-byte block of your package is XORed with its scrambled counter. Block 1: data ${ksShort(b.plaintext_hex)} ⊕ keystream ${ksShort(b.keystream_hex)} = ${ksShort(b.ciphertext_hex)}. ${chk.blocks.every((x) => x.keystreamOk && x.xorOk) ? "✓" : "✕"} first blocks recomputed.`; })(),
                why: "That XOR is the actual hiding: without the key the keystream is unpredictable, so the result looks random. The output is exactly as long as the input (no padding), because XOR works byte by byte.",
                formal: "locked bytes = data ⊕ keystream.",
                next: "Next: 3, the seal that detects tampering.",
            },
            eli1: {
                what: (() => { const b = t.blocks[0], P = parseInt(b.plaintext_hex.slice(0, 2), 16), K = parseInt(b.keystream_hex.slice(0, 2), 16), s = (v) => v.toString(2).padStart(8, "0"); return `First byte: ${s(P)} ⊕ ${s(K)} = ${s(P ^ K)}. Undo: ${s(P ^ K)} ⊕ ${s(K)} = ${s(P)}, the original.`; })(),
                why: "XOR twice with the same keystream byte always gives the original back.",
                formal: "(p ⊕ k) ⊕ k = p.",
                next: "Next: the seal.",
            },
            what: `P_i ⊕ keystream_i = C_i for blocks 1–${t.blocks.length}. Your browser ran AES_K on each counter itself: keystreams ${chk.blocks.every((b) => b.keystreamOk) ? "✓" : "✕"}, XORs ${chk.blocks.every((b) => b.xorOk) ? "✓" : "✕"}, and these ${t.blocks.length * 16} bytes are the start of the real ${w.aes_ciphertext_size.toLocaleString()}-byte ciphertext (checked below).`,
            why: `That XOR is the entire encryption. P₁ is the first 16 bytes of the serialized CKKS ciphertext from the ${pay.origin} chapter; after the XOR they look random to anyone without K.`,
            formal: "C_i = P_i ⊕ AES_K(ctr_i); |C| = |P|",
            next: "Next: 3, the tag that seals the ciphertext.",
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
            eli5: {
                what: `The seal (tag), GHASH: a secret value H = AES_key(all zeros) = ${ksShort(t.h_hex)} is made from the key. Then a running total X starts at 0, and for each 16-byte block (${g.aad_blocks} of header, ${g.ciphertext_blocks.toLocaleString()} of locked bytes, 1 of lengths): X = (X ⊕ block) × H, in a special 128-bit arithmetic. That's ${g.multiplications.toLocaleString()} multiplications. Finally tag = X ⊕ AES_key(J0) = ${t.tag_hex}. ${chk.tagOk ? "✓" : "✕"} recomputed.`,
                why: "Every block passes through the total, so changing any bit anywhere changes the tag. Only the key holder knows H and AES_key(J0), so nobody else can compute a matching tag for altered data. Including the header and lengths means those can't be swapped or cut either.",
                formal: "tag = GHASH_H(header, locked bytes, lengths) ⊕ AES_key(J0).",
                next: "Next: 4, locking the AES key itself.",
            },
            eli1: {
                what: (() => { const H = 5, q = 11, run = (bs) => bs.reduce((x, b) => ((x + b) * H) % q, 0); return `Toy checksum with secret H = 5, keep remainders mod 11, blocks 3, 1, 4: X = (0 + 3)×5 = 15 → 4; (4 + 1)×5 = 25 → 3; (3 + 4)×5 = 35 → 2. Tag = ${run([3, 1, 4])}. Change block 2 to 2: tag = ${run([3, 2, 4])}.`; })(),
                why: "Without knowing H, nobody can predict the new tag for changed blocks. The real GHASH uses 128-bit blocks and its own multiplication, but the running-total idea is the same.",
                formal: "toy: X = (X + block) × H mod 11.",
                next: "Next: locking the key.",
            },
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
            eli5: {
                what: `The ${L.from} locks the 32-byte AES key with the ${L.to}'s public RSA key (${srcRef(L.to === "server" ? "rsa_n_server" : "rsa_n_client", "n")}, e = ${rsa.e}). First OAEP padding (Optimal Asymmetric Encryption Padding) builds a 256-byte block: DB = fingerprint of an empty label ‖ zeros ‖ 01 ‖ the key; a random 32-byte seed masks DB, and DB masks the seed (MGF1, a SHA-256-based mask generator); EM = 00 ‖ masked seed ‖ masked DB. Then c = EM^e mod n: ${w.encrypted_aes_key_size} bytes.`,
                why: `Plain RSA on the bare key would give the same output every time and has known attacks. The random seed makes every envelope different; the fixed structure inside lets the receiver detect a damaged or forged envelope. Only the ${L.to}'s private key d undoes ^e.`,
                formal: "c = OAEP(AES key, random seed)^e mod n.",
                next: "Next: 5, the envelope on the wire.",
            },
            eli1: {
                what: `Toy with the server pair from Key Setup (n = 91, e = 5): message 2, padded with a random digit r as 10·r + 2. r = 1: 12⁵ mod 91 = ${Number(12n ** 5n % 91n)}. r = 4: 42⁵ mod 91 = ${Number(42n ** 5n % 91n)}. Same message, different envelopes.`,
                why: "That's what the random seed in OAEP does, with a much more careful layout.",
                formal: `toy: 2 → ${Number(12n ** 5n % 91n)} or ${Number(42n ** 5n % 91n)}.`,
                next: "Next: the wire.",
            },
            what: `The ${L.from} seals the 32-byte AES key with RSA-OAEP under the ${L.to}'s public key (n: ${rsa.bit_lengths.n} bits, e = ${rsa.e}): EM = 00 ‖ maskedSeed ‖ maskedDB, c = EM^e mod n, ${w.encrypted_aes_key_size} bytes.`,
            why: "RSA only encrypts a number smaller than n, and it is slow, so it carries just the 32-byte AES key (hybrid encryption). OAEP mixes in a random seed first, so sealing the same key twice gives different envelopes, and a damaged envelope is detected when it is opened.",
            formal: "DB = SHA-256(\"\") ‖ 00…00 ‖ 01 ‖ k; seed random; maskedDB = DB ⊕ MGF1(seed); maskedSeed = seed ⊕ MGF1(maskedDB); c = (00 ‖ maskedSeed ‖ maskedDB)^e mod n",
            next: "Next: the packet on the wire.",
            renderVisual: (el) => {
                el.innerHTML = `${title(`${from} seals the AES key (RSA-OAEP)`)}
                    <div class="scene-body">
                        <div class="vector-caption">the ${escapeHtml(L.to)}'s public key: n (${rsa.bit_lengths.n} bits), e = ${rsa.e}</div>
                        <div class="bignum-box">${srcLinkHtml(L.to === "server" ? "rsa_n_server" : "rsa_n_client", rsa.n)}</div>
                        <div class="vector-caption">c = the sealed AES key that travels (${w.encrypted_aes_key_size} bytes, base64):</div>
                        <div class="bignum-box">${escapeHtml(w.encrypted_aes_key_b64)}</div>
                    </div>`;
            },
        },
        {
            eli5: {
                what: `This is everything that actually travels: a readable header ("${w.aad_utf8}", ${t.aad_len} bytes), the RSA-locked AES key (${w.encrypted_aes_key_size} B), the nonce (${w.nonce_size} B), ${w.aes_ciphertext_size.toLocaleString()} locked bytes and the ${w.tag_size}-byte tag. Total ${(t.aad_len + w.encrypted_aes_key_size + w.nonce_size + w.aes_ciphertext_size + w.tag_size).toLocaleString()} bytes.`,
                why: `Anyone watching the network sees all of this. The nonce and header aren't secret; they're needed to unlock and are covered by the tag, so they can't be changed. Without the ${L.to}'s private key the rest is useless.`,
                formal: "envelope = (header, locked key, nonce, locked bytes, tag).",
                next: `Next: 6, the ${L.to} opens the AES key with its private key.`,
            },
            what: wrapEv.description,
            why: `Everything the ${L.to} needs travels together. Only the header is readable on the wire, and the tag covers it too, so it cannot be swapped. Total on the wire: ${(w.encrypted_aes_key_size + w.nonce_size + w.aes_ciphertext_size + w.tag_size).toLocaleString()} bytes plus the ${t.aad_len}-byte header.`,
            formal: wrapEv.formal,
            next: `Next: the ${L.to} opens the RSA envelope.`,
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
            eli5: {
                what: `The ${L.to} computes EM = c^d mod n with its private key d. Then it undoes the masks in reverse: seed = masked seed ⊕ MGF1(masked DB), DB = masked DB ⊕ MGF1(seed). DB must start with the fingerprint of an empty label, then zeros, then 01; the last 32 bytes are the AES key.`,
                why: "e and d undo each other (e·d leaves remainder 1 mod λ(n)), so (key^e)^d gives the padded block back. If anything is wrong (another key, a changed byte), the fixed structure won't appear and the envelope is refused before the key is used.",
                formal: "EM = c^d mod n → unmask → AES key.",
                next: "Next: 7, the AES key opens the package.",
            },
            eli1: {
                what: `Toy: envelope ${Number(12n ** 5n % 91n)}, private d = 5: ${Number(12n ** 5n % 91n)}⁵ mod 91 = ${Number((12n ** 5n % 91n) ** 5n % 91n)}. Drop the pad digit (1): message 2.`,
                why: "Unlocking with d gives the padded block; removing the known structure leaves the key.",
                formal: `toy: ${Number(12n ** 5n % 91n)}⁵ mod 91 = 12 → 2.`,
                next: "Next: open the package.",
            },
            what: `The ${L.to} computes EM = c^d mod n with its private exponent d, then undoes OAEP: seed = maskedSeed ⊕ MGF1(maskedDB, 32), DB = maskedDB ⊕ MGF1(seed, 223), checks lHash, the zero run and the 01 separator, and takes the last 32 bytes as the AES key. Your browser does the same in BigInt.`,
            why: "e·d ≡ 1 (mod λ(n)), so (k^e)^d ≡ k (mod n). The OAEP structure checks reject a wrong key or a modified envelope before the AES key is used.",
            formal: "EM = c^d mod n = 00 ‖ maskedSeed ‖ maskedDB; seed = maskedSeed ⊕ MGF1(maskedDB, 32); DB = maskedDB ⊕ MGF1(seed, 223) = SHA-256(\"\") ‖ 00…00 ‖ 01 ‖ k",
            next: "Next: AES-GCM decrypts the payload with k.",
            renderVisual: (el) => {
                el.innerHTML = `${title(`${to} opens the AES key (RSA private key)`)}
                    <div class="scene-body">
                        <div class="vector-caption">c = what travels (${w.encrypted_aes_key_size} bytes, base64):</div>
                        <div class="bignum-box">${escapeHtml(w.encrypted_aes_key_b64)}</div>
                        <div class="ks-verify" id="tpOaepChecks">${tpCheck("tpOaepRsa", "browser: c^d mod n running")}</div>
                        <div class="tp-oaep"><div><div class="poly-label">EM = c^d mod n (256 bytes)</div><div id="tpEm"></div></div>
                            <div><div class="poly-label">DB after unmasking (223 bytes)</div><div id="tpDb"></div></div></div>
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
            eli5: {
                what: `With that AES key the ${L.to} first recomputes the tag over the header and the locked bytes and compares it with the tag that arrived (${ksShort(u.tag_hex)}). Only if they match does it rebuild the same counters and keystream and XOR them away. Out comes the CKKS ${legNo === 1 ? "ciphertext" : "result"}, ${u.size_bytes.toLocaleString()} bytes, still locked by CKKS.`,
                why: `Checking the tag first means tampered bytes are never used. XOR undoes itself, so the same keystream turns the bytes back. The SHA-256 fingerprint after the trip equals the one from ${srcRef(pay.fact, pay.origin)}, so not one byte changed.`,
                formal: "check tag → unscramble → CKKS bytes, unchanged.",
                next: "Next: 8, proof that the seal catches tampering.",
            },
            what: unwrapEv.description,
            why: `The ${L.to}'s private key opens the envelope, then AES-GCM recomputes the tag over the header and ciphertext and releases the plaintext only if it matches. Your browser repeats the whole unwrap with WebCrypto, independent of Python, on the exact bytes sent.`,
            formal: unwrapEv.formal,
            next: "Next: proof that the tag really catches tampering.",
            renderVisual: (el) => {
                const arrivedOk = u.integrity_preserved && u.tag_verified;
                el.innerHTML = `${title(`${to} opens the payload (AES-GCM) → CKKS ciphertext`)}
                    <div class="scene-body">
                        <div class="transport-track">
                            <span class="transport-endpoint">${escapeHtml(from)}</span>
                            <div class="transport-packet transport-packet-arrived"></div>
                            <span class="transport-endpoint">${escapeHtml(to)}</span>
                        </div>
                        <div class="tp-unwrap">
                            <div><div class="poly-label">${escapeHtml(L.to)} (Python, cryptography)</div>
                                ${renderChecks([
                                    { label: "RSA-OAEP opened with its private key", ok: u.aes_key_matches_pbkdf2 ?? u.aes_key_matches_server },
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
                            <div class="tp-row tp-row3"><span>${escapeHtml(pay.origin)} chapter</span><span>${srcLinkHtml(pay.fact, pay.sha)}</span><span></span></div>
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
            eli5: {
                what: `Tamper test on this exact package: bit ${tamper.bit} of locked byte ${tamper.flipped_byte_index.toLocaleString()} was flipped (0x${tamper.byte_before} → 0x${tamper.byte_after}), and separately one bit of the tag. Unlocking ${tamper.rejected && tamper.tag_flip.rejected ? "refused both" : "DID NOT refuse"}.`,
                why: "Without the tag, a flipped bit would turn into a silently wrong CKKS ciphertext and a wrong answer nobody notices. With it, the recomputed tag no longer matches and nothing is used. This shows the seal working on this real package, not just in theory.",
                formal: "one flipped bit → rejected.",
                next: L.next,
            },
            what: `Tamper test on this exact payload: bit ${tamper.bit} of ciphertext byte ${tamper.flipped_byte_index.toLocaleString()} flipped (0x${tamper.byte_before} → 0x${tamper.byte_after}): ${tamper.rejected ? `rejected (${tamper.error})` : "NOT rejected"}. Bit ${tamper.tag_flip.bit} of tag byte ${tamper.tag_flip.flipped_byte_index} flipped: ${tamper.tag_flip.rejected ? "rejected" : "NOT rejected"}. Untouched payload decrypts: ${tamper.untampered_decrypts ? "✓" : "✕"}. Your browser repeats both flips below.`,
            why: "Without the tag, a changed byte would slip through and silently corrupt the CKKS ciphertext, so the result would be garbage and nobody would know. With GCM, one flipped bit changes the recomputed tag, and the message is rejected before any of it is used.",
            formal: "C' = C ⊕ e (e ≠ 0) ⇒ GHASH_H(A, C') ≠ GHASH_H(A, C) ⇒ tag' ≠ tag ⇒ reject",
            next: L.next,
            renderVisual: (el) => {
                const row = (label, flip, id) => `
                    <div class="tp-flip">
                        <div class="tp-flip-head">${escapeHtml(label)} byte ${flip.flipped_byte_index.toLocaleString()} of ${flip.field_size.toLocaleString()}, bit ${flip.bit}</div>
                        <div class="tp-flip-bits"><span>0x${escapeHtml(flip.byte_before)}</span><span class="tp-bits">${tpBits(flip.byte_before, flip.bit)}</span><span>→</span><span class="tp-bits">${tpBits(flip.byte_after, flip.bit)}</span><span>0x${escapeHtml(flip.byte_after)}</span></div>
                        ${renderChecks([{ label: `client (Python): ${flip.rejected ? `rejected with ${flip.error}` : "accepted!"}`, ok: flip.rejected }])}
                        <div class="ks-verify">${tpCheck(id, "browser (WebCrypto): decrypting the flipped copy")}</div>
                    </div>`;
                el.innerHTML = `${title("Tamper test")}
                    <div class="scene-body">
                        <div class="tp-flips ${ksRevealClass()}">
                            ${row("ciphertext", tamper, "tpFlipCt")}
                            ${row("tag", tamper.tag_flip, "tpFlipTag")}
                        </div>
                        ${renderChecks([{ label: "untouched payload decrypts (client)", ok: tamper.untampered_decrypts }])}
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
    // Graph order (TP_CTR_FLOW): key and nonce -> J0 -> counter -> AES_K -> keystream ⊕ payload -> C.
    // node(i, focus, lit, flow): step i in the split view; `lit` = boxes already reached when it starts.
    const node = (i, focus, lit, flow) => subStep(steps[i], { graph, focus, lit, flow, caption: `leg ${legNo} · AES-256-GCM counter mode, block 1` });
    const ctr = ["key", "nonce", "j0", "ctr"];
    return [
        steps[0],                                                           // 1: why seal
        steps[4],                                                           // 2: counter mode graph
        node(1, ["key"], [], []),                                           // 2.1 the AES key
        node(2, ["key"], ["key"], []),                                      // 2.2 key schedule
        node(3, ["nonce", "j0", "ctr"], ["key"], [["nonce>j0"], ["j0>ctr"]]),  // 2.3 nonce, J0, counters
        node(5, ["aes"], ctr, [["ctr>aes", "key>aes"]]),                    // 2.4 inside AES
        node(7, ["aes"], [...ctr, "aes"], []),                              // 2.5 S-box (the rounds use it)
        node(6, ["aes"], [...ctr, "aes"], []),                              // 2.6 14 rounds
        node(8, ["ks", "xor", "p", "c"], [...ctr, "aes"], [["aes>ks"], ["ks>xor", "p>xor"], ["xor>c"]]),  // 2.7 keystream ⊕ payload
        ...steps.slice(9),                                                  // 3-7: tag, RSA-OAEP, wire, unwrap, tamper
    ];
}
