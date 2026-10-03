// Key Setup chapter: every key the pipeline creates, built step by step
// from the real run (events ckks_keygen, rsa_keygen_client/_server,
// passphrase, pbkdf2). RSA identities are re-checked in the browser with
// BigInt, the SHA-256 block inside HMAC is recomputed round by round
// (sha256_check.js), and the final key is re-derived with WebCrypto.
// Components: byte_matrix.js, pbkdf2_graph.js, split_view.js (PBKDF2 = step 7, its nodes 7.1-7.9).
const ksShort = (hex, n = 8) => (String(hex).length > n * 2 + 2 ? `${String(hex).slice(0, n * 2)}…` : String(hex));
const ksSpeedMs = (ms) => ms * Math.pow(0.8, (window.stepSpeed || 5) - 1);
const ksPause = (ms) => new Promise((r) => setTimeout(r, ksSpeedMs(ms)));
const ksBadge = (ok, yes, no) => `<span class="${ok ? "badge-match" : "badge-mismatch"}">${ok ? "✓" : "✕"} ${escapeHtml(ok ? yes : no)}</span>`;
const ksRevealClass = () => (window.sceneAlreadyVisited ? "ks-reveal ks-instant" : "ks-reveal");
const ksSkip = () => !!window.sceneAlreadyVisited;

// --- BigInt helpers for RSA -----------------------------------------------
function biGcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function biModPow(b, e, m) {
    let r = 1n;
    b %= m;
    while (e > 0n) {
        if (e & 1n) r = (r * b) % m;
        b = (b * b) % m;
        e >>= 1n;
    }
    return r;
}

function rsaBrowserChecks(r) {
    const [p, q, n, e, d, lam] = [r.p, r.q, r.n, r.e, r.d, r.lambda].map(BigInt);
    const p1 = p - 1n, q1 = q - 1n;
    return {
        primes: [
            { label: "2^(p−1) mod p = 1 (Fermat test: p is prime)", ok: biModPow(2n, p1, p) === 1n },
            { label: "2^(q−1) mod q = 1 (Fermat test: q is prime)", ok: biModPow(2n, q1, q) === 1n },
            { label: "p · q = n", ok: p * q === n },
        ],
        exponents: [
            { label: "lcm(p−1, q−1) = λ(n)", ok: (p1 * q1) / biGcd(p1, q1) === lam },
            { label: "gcd(e, λ(n)) = 1", ok: biGcd(e, lam) === 1n },
            { label: "(e · d) mod λ(n) = 1", ok: (e * d) % lam === 1n },
            { label: "d mod (p−1) = dmp1 (CRT speed-up)", ok: d % p1 === BigInt(r.dmp1) },
            { label: "d mod (q−1) = dmq1 (CRT speed-up)", ok: d % q1 === BigInt(r.dmq1) },
            { label: "q · iqmp mod p = 1 (CRT speed-up)", ok: (q * BigInt(r.iqmp)) % p === 1n },
        ],
    };
}

function renderChecks(checks) {
    return `<div class="ks-checks">${checks.map((c) => `<div class="ks-check ${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "✕"} ${escapeHtml(c.label)}</div>`).join("")}</div>`;
}

function renderRsaKeypair(el, rsa, checks, full, extraHtml) {
    const b = rsa.bit_lengths;
    const row = (name, formula, value, bits, wide) => `
        <div class="rsa-row${wide ? " rsa-wide" : ""}">
            <div class="rsa-head"><span class="rsa-name">${name}</span><span class="rsa-formula">${escapeHtml(formula)}</span><span class="rsa-bits">${bits} bits · ${value.length} digits</span></div>
            <div class="bignum-box">${escapeHtml(value)}</div>
        </div>`;
    const rows = [
        row("p", "random prime", rsa.p, b.p),
        row("q", "random prime", rsa.q, b.q),
        row("n", "p · q  (public)", rsa.n, b.n, !full),
    ];
    if (full) rows.push(
        row("λ(n)", "lcm(p−1, q−1)  (secret)", rsa.lambda, b.lambda),
        row("e", "fixed public exponent", rsa.e, b.e),
        row("d", "e⁻¹ mod λ(n)  (private key)", rsa.d, b.d),
    );
    const list = full ? [...checks.primes, ...checks.exponents] : checks.primes;
    el.innerHTML = `
        <div class="scene-title">${escapeHtml(rsa.label === "client" ? "Client" : "Server")} RSA-${rsa.key_size} keypair${full ? "" : ": the primes"}</div>
        <div class="scene-body">
            <div class="rsa-grid${full ? " rsa-compact" : ""} ${ksRevealClass()}">${rows.join("")}</div>
            <div class="vector-caption">Re-checked just now in your browser (BigInt arithmetic on the numbers above):</div>
            ${renderChecks(list)}
            ${extraHtml || ""}
        </div>`;
}

// --- PBKDF2 graph model ------------------------------------------------------
function pbkdf2Graph(d) {
    const u = d.u_chain, last = u[u.length - 1];
    return {
        cols: 4, rows: 4,
        nodes: [
            { id: "salt", col: 2, row: 0, title: "salt · 16 random bytes", value: ksShort(d.salt_hex), full: d.salt_hex },
            { id: "P", col: 0, row: 1, title: "P · passphrase", value: `"${d.passphrase}"`, full: `${d.passphrase} = 0x${d.passphrase_hex}` },
            { id: "K", col: 1, row: 1, title: `K · P ${d.hmac_key.hashed_because_longer_than_64 ? "hashed, then " : ""}padded to 64 B`, value: ksShort(d.hmac_key.K_hex), full: d.hmac_key.K_hex },
            { id: "ipad", col: 2, row: 1, title: "K ⊕ ipad (0x36…)", value: ksShort(d.hmac_key.K_xor_ipad_hex), full: d.hmac_key.K_xor_ipad_hex },
            { id: "inner", col: 3, row: 1, title: "inner SHA-256", value: ksShort(d.u1.inner_digest_hex), full: d.u1.inner_digest_hex },
            { id: "opad", col: 2, row: 2, title: "K ⊕ opad (0x5c…)", value: ksShort(d.hmac_key.K_xor_opad_hex), full: d.hmac_key.K_xor_opad_hex },
            { id: "outer", col: 3, row: 2, title: "outer SHA-256 → U₁", value: ksShort(d.u1.outer_digest_hex), full: d.u1.outer_digest_hex },
            { id: "chain", col: 3, row: 3, title: `U₂ … U_${last.i.toLocaleString()} (HMAC each)`, value: ksShort(last.U_i), full: `U_${last.i} = ${last.U_i}` },
            { id: "xor", col: 2, row: 3, title: "T = U₁ ⊕ U₂ ⊕ … ⊕ U_c", value: ksShort(last.T_after_i), full: last.T_after_i },
            { id: "key", col: 1, row: 3, title: "AES-256 key (leg 1)", value: ksShort(d.transport_key_hex), full: d.transport_key_hex },
        ],
        edges: [
            { from: "P", to: "K", label: "pad with zeros to the 64-byte SHA-256 block size" },
            { from: "K", to: "ipad", label: "XOR every byte with 0x36" },
            { from: "K", to: "opad", label: "XOR every byte with 0x5c" },
            { from: "salt", to: "inner", label: "salt ‖ INT_32_BE(1) is the HMAC message" },
            { from: "ipad", to: "inner", label: "(K ⊕ ipad) is hashed first" },
            { from: "inner", to: "outer", label: "the inner digest is hashed again" },
            { from: "opad", to: "outer", label: "(K ⊕ opad) ‖ inner digest" },
            { from: "outer", to: "chain", label: "U_i = HMAC(P, U_{i−1})" },
            { from: "chain", to: "xor", label: "XOR every U_i into T" },
            { from: "xor", to: "key", label: "T is the 32-byte derived key" },
        ],
    };
}
const PBKDF2_FLOW = [["P>K"], ["K>ipad", "K>opad"], ["ipad>inner", "salt>inner"], ["inner>outer", "opad>outer"], ["outer>chain"], ["chain>xor"], ["xor>key"]];

// --- Steps -------------------------------------------------------------------
function buildKeySteps(result) {
    const ckksEv = findEv(result, "ckks_keygen");
    const ck = ckksEv.data_after;
    const rsaSEv = findEv(result, "rsa_keygen_client");
    const rsaCEv = findEv(result, "rsa_keygen_server");
    const rsaS = rsaSEv.data_after, rsaC = rsaCEv.data_after;
    const ppEv = findEv(result, "passphrase");
    const pbEv = findEv(result, "pbkdf2");
    const d = pbEv.data_after;
    const hk = d.hmac_key;
    const sha = d.inner_sha256_trace;
    const block = sha.blocks[sha.blocks.length - 1];
    const blockNo = sha.blocks.length;
    const shaCheck = checkSha256Block(block);
    const checksS = rsaBrowserChecks(rsaS), checksC = rsaBrowserChecks(rsaC);
    const allOk = (c) => [...c.primes, ...c.exponents].every((x) => x.ok);
    const p = result.ckks_params;
    const bits = p.coeff_mod_bit_sizes;
    const totalBits = bits.reduce((a, b) => a + b, 0);
    const pp = d.passphrase;
    const generated = !!ppEv.data_after.generated;
    const graph = pbkdf2Graph(d);
    const iters = d.iterations.toLocaleString();
    const partyName = (party) => (party === "client" ? "Client (you, the data owner)" : "Server (compute node)");
    const saltLen = d.salt_hex.length / 2;
    const msgLen = sha.message_hex.length / 2;
    const keyLen = hk.hashed_because_longer_than_64 ? 32 : hk.passphrase_len;
    const uLast = d.u_chain[d.u_chain.length - 1];

    // Textbook RSA on the real leg-1 key with the server's real keypair.
    const demoM = BigInt("0x" + d.transport_key_hex);
    const demoC = biModPow(demoM, BigInt(rsaC.e), BigInt(rsaC.n));
    const demoBack = biModPow(demoC, BigInt(rsaC.d), BigInt(rsaC.n));

    // K ⊕ pad, recomputed byte by byte.
    const kBytes = bytesOfHex(hk.K_hex);
    const xorBytes = (pad) => kBytes.map((b) => (parseInt(b, 16) ^ pad).toString(16).padStart(2, "0"));
    const ipadOk = xorBytes(0x36).join("") === hk.K_xor_ipad_hex;
    const opadOk = xorBytes(0x5c).join("") === hk.K_xor_opad_hex;

    const graphInto = (el, opts) => renderPbkdf2Graph(el, graph, { ...opts, skipAnimation: opts.skipAnimation ?? ksSkip() });
    const crumbs = (...parts) => `<div class="graph-crumbs">${parts.map((x) => `<span>${escapeHtml(x)}</span>`).join("<span>›</span>")}</div>`;
    const innerCrumbs = crumbs("PBKDF2", "U₁ = HMAC(P, salt ‖ INT(1))", `inner SHA-256 · block ${blockNo} of ${blockNo}`);

    // Segment of each byte in the padded inner-hash message.
    const paddedBytes = bytesOfHex(sha.padded_hex);
    const segOf = (i) => {
        if (i < 64) return "bm-seg-ipad";
        if (i < 64 + saltLen) return "bm-seg-salt";
        if (i < msgLen) return "bm-seg-int";
        if (i === msgLen) return "bm-seg-one";
        if (i >= paddedBytes.length - 8) return "bm-seg-len";
        return "bm-seg-zero";
    };
    const segEq = (i) => ({
        "bm-seg-ipad": `(K \\oplus \\mathrm{ipad})_{${i}}`,
        "bm-seg-salt": `\\mathrm{salt}_{${i - 64}}`,
        "bm-seg-int": `\\mathrm{INT}(1)_{${i - 64 - saltLen}}`,
        "bm-seg-one": "\\text{end marker } 1\\text{ bit}",
        "bm-seg-zero": "\\text{zero padding}",
        "bm-seg-len": `\\text{length} = ${sha.message_bit_length}\\text{ bits}`,
    })[segOf(i)] + ` = \\mathtt{${paddedBytes[i]}}`;
    const renderPadded = (el, skip) => {
        el.innerHTML = `${innerCrumbs}
            <div class="vector-caption">SHA-256 input: (K ⊕ ipad) ‖ salt ‖ INT(1) = ${msgLen} bytes, padded to ${paddedBytes.length} bytes = ${blockNo} blocks of 64 (rows ${blockNo > 1 ? "1–4 are block 1, 5–8 block 2" : "1–4"}):</div>
            <div class="ks-inner-matrix"></div>
            <div class="ks-legend">
                <span class="bm-seg-ipad">K ⊕ ipad (64 B)</span><span class="bm-seg-salt">salt (${saltLen} B)</span><span class="bm-seg-int">INT(1) (4 B)</span>
                <span class="bm-seg-one">0x80 end marker</span><span class="bm-seg-zero">zeros</span><span class="bm-seg-len">length ${sha.message_bit_length} bits (8 B)</span>
            </div>`;
        return renderByteMatrix(el.querySelector(".ks-inner-matrix"), paddedBytes, {
            cols: 16, cellClass: segOf, equation: segEq, title: (i) => `byte ${i}: 0x${paddedBytes[i]}`,
            rowLabels: paddedBytes.map((_, i) => i).filter((i) => i % 16 === 0).map((i) => `B${Math.floor(i / 64) + 1}`),
            skipAnimation: skip,
        });
    };

    const lockHandler = (el) => {
        const input = el.querySelector("#keyPassphraseInput");
        const lockBtn = el.querySelector("#lockKeyBtn");
        const randBtn = el.querySelector("#randomKeyBtn");
        const status = el.querySelector("#lockKeyStatus");
        const rerun = async (value, msg) => {
            lockBtn.disabled = true;
            randBtn.disabled = true;
            status.className = "overview-status";
            status.textContent = msg;
            const r = await runPipeline(result.model, result.input, value);
            lockBtn.disabled = false;
            randBtn.disabled = false;
            if (!r.ok) { status.className = "overview-status error"; status.textContent = r.error; return; }
            if (window.onPassphraseRelock) window.onPassphraseRelock();
        };
        lockBtn.addEventListener("click", () => {
            const val = input.value;
            if (!val.trim()) { status.className = "overview-status error"; status.textContent = "Type a passphrase first."; return; }
            rerun(val, "Re-running the whole pipeline with your passphrase...");
        });
        randBtn.addEventListener("click", () => rerun("", "Re-running with a new random passphrase from the client..."));
    };

    const webCryptoCheck = async () => {
        if (!(window.crypto && crypto.subtle)) return { ok: false, hex: "", error: "WebCrypto unavailable (page is not a secure context)" };
        try {
            const bytes = (hex) => new Uint8Array(bytesOfHex(hex).map((b) => parseInt(b, 16)));
            const base = await crypto.subtle.importKey("raw", bytes(d.passphrase_hex), "PBKDF2", false, ["deriveBits"]);
            const t0 = performance.now();
            const bitsBuf = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: bytes(d.salt_hex), iterations: d.iterations }, base, d.dklen * 8);
            const ms = performance.now() - t0;
            const hex = [...new Uint8Array(bitsBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
            return { ok: hex === d.derived_key_hex, hex, ms };
        } catch (e) {
            return { ok: false, hex: "", error: String(e) };
        }
    };

    const parties = [
        { party: ckksEv.party, name: "CKKS secret key", secret: true, note: `secret-key context · ${formatBytes(ck.secret_key_context.size_bytes)} · sha256 ${ksShort(ck.secret_key_context.sha256)}` },
        { party: rsaSEv.party, name: "RSA private key d (client)", secret: true, note: `${rsaS.bit_lengths.d}-bit d for a ${rsaS.bit_lengths.n}-bit n` },
        { party: pbEv.party, name: "passphrase → AES-256 key", secret: true, note: `"${pp}" (${generated ? "random" : "yours"}) → ${ksShort(d.derived_key_hex)}` },
        { party: rsaCEv.party, name: "RSA private key d (server)", secret: true, note: `${rsaC.bit_lengths.d}-bit d for a ${rsaC.bit_lengths.n}-bit n` },
        { party: ckksEv.party === "client" ? "server" : "client", name: "CKKS public context (received)", note: `public key + relinearization + Galois keys · ${formatBytes(ck.public_context.size_bytes)} · sha256 ${ksShort(ck.public_context.sha256)}` },
    ];

    const steps = [
        {
            eli5: {
                what: `Before anything is sent, keys are made on two computers. The client is you: you own the data, so you keep every key that can open something. The server only does the maths, so it gets keys that let it work on locked data, never open it.`,
                why: "A key is just a very large secret number. Who holds which key decides who can read what: the server must compute on your data without being able to read it, so it never gets a key that opens anything of yours.",
                formal: "You keep the opening keys; the server gets only working keys.",
                next: "Next: the settings the main lock (CKKS) is built with.",
            },
            what: `Before any data moves, the pipeline creates its keys on two machines. ${partyName("client")}: the CKKS secret key, an RSA private key and a passphrase-derived AES key. ${partyName("server")}: its own RSA private key, and it receives the ${formatBytes(ck.public_context.size_bytes)} CKKS public context.`,
            why: "A key is a large secret number. The client is you, the data owner, so it alone keeps the one key that can decrypt results. The server does the computing, so it only receives keys that let it compute on encrypted data, never read it. RSA and AES keys are a second, separate lock on the bytes while they travel over the network.",
            formal: `client: sk_CKKS, d_RSA(C), P → k_AES · server: pk+rlk+gk_CKKS, d_RSA(S) · exchanged: (n,e)_C → server, (n,e)_S → client`,
            next: "Next: the CKKS parameters every CKKS key is built on.",
            renderVisual: (el) => {
                // Send / receive chart of the whole run; the key exchange (the first three messages) is highlighted.
                const secrets = parties.filter((x) => x.secret);
                el.innerHTML = `
                    <div class="scene-title">Who sends what, and who keeps what</div>
                    <div class="scene-body">
                        ${sequenceChartSvg(result, ["ctx", "rsaC", "rsaS"])}
                        <div class="seq-secrets">${secrets.map((x) => `<span class="seq-secret"><strong>${escapeHtml(x.name)}</strong> · ${escapeHtml(partyName(x.party).split(" (")[0])} only</span>`).join("")}</div>
                        <p class="step-text muted">Every arrow is public: anyone on the network may see it. The highlighted three are the key exchange that happens first; legs 1 and 2 are the Transport chapters. The secrets below the chart never leave their machine.</p>
                    </div>`;
            },
        },
        {
            eli5: {
                what: `CKKS (Cheon-Kim-Kim-Song, the inventors' names) is set up with three settings. N = ${p.poly_modulus_degree}: every locked package is a formula with ${p.poly_modulus_degree} numbers, and it can carry ${ck.slots} of your values at once (half of N). q: the numbers inside are kept as remainders after dividing by q, a ${totalBits}-bit number built from ${bits.length} primes (${bits.join(", ")} bits). Δ = 2^${p.global_scale_bits}: the scale decimals are multiplied by.`,
                why: `Bigger N means more values per package and a harder puzzle for attackers, but slower maths. q must be big enough that the noise never wraps around; each middle ${bits[1]}-bit prime is used up once when a multiplication is "rescaled" (divided by about 2^${p.global_scale_bits} to bring the scale back). N = 8192 with a ${totalBits}-bit q is a standard choice that gives about 128-bit security.`,
                formal: `${ck.slots} values per package; ${totalBits}-bit q; scale 2^${p.global_scale_bits}.`,
                next: "Next: the keys made from these settings, and why there is a public one.",
            },
            eli1: {
                what: `In "How HE works" the toy lock had q = ${TOY.q}, Δ = ${TOY.delta} and held 1 number. The real one: q is a ${totalBits}-bit number (about ${Math.round(totalBits * 0.30103)} digits), Δ = 2^${p.global_scale_bits} = ${(2 ** p.global_scale_bits).toLocaleString()}, and one package holds ${ck.slots} numbers.`,
                why: `Toy noise was about 2 out of ${TOY.delta}, so answers were off in the 3rd decimal (0.252 instead of 0.25). With Δ = 2^${p.global_scale_bits}, the same noise is 2 out of a trillion: about 12 correct decimals.`,
                formal: `toy q = ${TOY.q} → real ${totalBits} bits; toy Δ = ${TOY.delta} → 2^${p.global_scale_bits}.`,
                next: "Next: the keys made from these settings.",
            },
            what: `CKKS context: ring degree N=${p.poly_modulus_degree} (${p.poly_modulus_degree / 2} SIMD slots), a ${bits.length}-prime modulus chain [${bits.join(", ")}] bits (${totalBits}-bit q), scale Δ = 2^${p.global_scale_bits}. KeyGen took ${(ckksEv.elapsed_sec * 1000).toFixed(0)} ms.`,
            why: "N sets both capacity and security: more slots and a bigger modulus budget, at the cost of slower operations. Each middle prime is used up by one rescale after a multiplication, and the scale is the fixed-point precision real numbers are encoded at.",
            formal: `N=${p.poly_modulus_degree}, q = ${bits.map((_, i) => `q${i}`).join("·")} (${bits.join("+")} bits), Δ=2^${p.global_scale_bits}`,
            next: "Next: the CKKS keys generated from these parameters, and how big they are.",
            facts: [{ id: "ckks_params", label: `CKKS parameters: N = ${p.poly_modulus_degree}, primes [${bits.join(", ")}] bits, scale 2^${p.global_scale_bits}`, value: `Δ = 2^${p.global_scale_bits}` }],
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">CKKS parameters</div>
                    <div class="scene-body ${ksRevealClass()}">
                        <div class="param-grid">
                            <div class="param-card"><div class="param-name">Ring degree N</div><div class="param-value">${p.poly_modulus_degree}</div><div class="param-note">polynomials have N coefficients</div></div>
                            <div class="param-card"><div class="param-name">SIMD slots</div><div class="param-value">${ck.slots}</div><div class="param-note">values packed per ciphertext</div></div>
                            <div class="param-card"><div class="param-name">Scale Δ</div><div class="param-value">2^${p.global_scale_bits}</div><div class="param-note">fixed-point precision</div></div>
                        </div>
                        <div class="vector-caption">Coefficient modulus chain -- ${totalBits} bits total:</div>
                        <div class="modulus-chain">${bits.map((b) => `<div class="modulus-prime">${b}-bit</div>`).join("")}</div>
                    </div>`;
                el.querySelectorAll(".modulus-prime").forEach((m, i) => { m.style.flex = String(bits[i]); });
            },
        },
        {
            eli5: {
                what: `You made a secret key s that never leaves your computer (${formatBytes(ck.secret_key_context.size_bytes)}) and a public bundle for the server (${formatBytes(ck.public_context.size_bytes)}). The bundle holds three things: the public key (lets anyone lock), the relinearization key, and the rotation (Galois) keys.`,
                why: `Only you lock and unlock, so strictly you wouldn't need a public key: CKKS also works with the secret key alone ("symmetric" mode). TenSEAL, the library used here, makes one by default. What the server really needs are the two helper keys: rotation keys let it slide values around inside a locked package to add them up, and the relinearization key tidies up after multiplying two locked values (not used by these models). Rotation keys are ${(ck.galois_keys_bytes / ck.public_context.size_bytes * 100).toFixed(0)}% of the bundle.`,
                formal: "Secret key stays home; public key + helper keys travel.",
                next: "Next: your RSA key, a second lock just for the trip over the network.",
            },
            eli1: {
                what: `Toy version: secret key s = ${TOY.s}, public key (pk0, pk1) = (${TOY.pk0}, ${TOY.pk1}), made as pk0 = −pk1·s + e mod ${TOY.q} with noise e = ${TOY.e}. The real s is ${p.poly_modulus_degree} small numbers (each −1, 0 or 1), and pk0, pk1 are formulas with ${p.poly_modulus_degree} big numbers each.`,
                why: `The public key lets anyone lock, but it hides s under the noise: from (${TOY.pk0}, ${TOY.pk1}) the obvious calculation gives ${TOY.crackNoisy}, not ${TOY.s}. Rotation keys are the same idea: s, rearranged, locked under s, so the server can rearrange locked values without learning s.`,
                formal: `toy: s = ${TOY.s}, pk = (${TOY.pk0}, ${TOY.pk1}).`,
                next: "Next: your RSA key.",
            },
            what: ckksEv.description,
            why: ckksEv.why,
            formal: ckksEv.formal,
            next: ckksEv.next_step,
            facts: [{ id: "ckks_pk", label: "The CKKS public bundle (public key + helper keys) the server receives", value: `${formatBytes(ck.public_context.size_bytes)} · sha256 ${ksShort(ck.public_context.sha256)}` }],
            renderVisual: (el) => {
                const rows = [
                    { name: "secret-key context (client only)", bytes: ck.secret_key_context.size_bytes, sha: ck.secret_key_context.sha256, cls: "secret" },
                    { name: "public context without Galois keys", bytes: ck.public_context_without_galois.size_bytes, sha: ck.public_context_without_galois.sha256, cls: "" },
                    { name: "Galois (rotation) keys alone", bytes: ck.galois_keys_bytes, sha: "", cls: "galois" },
                    { name: "public context sent to the server", bytes: ck.public_context.size_bytes, sha: ck.public_context.sha256, cls: "public" },
                ];
                const max = Math.max(...rows.map((r) => r.bytes));
                el.innerHTML = `
                    <div class="scene-title">CKKS keys: secret vs public</div>
                    <div class="scene-body">
                        <div class="size-bars">${rows.map((r) => `
                            <div class="size-bar-row">
                                <span class="size-bar-name">${escapeHtml(r.name)}</span>
                                <span class="size-bar"><span class="size-bar-fill ${r.cls}"></span></span>
                                <span class="size-bar-val">${r.bytes.toLocaleString()} B</span>
                                ${r.sha ? `<span class="size-bar-sha">sha256 ${escapeHtml(r.sha)}</span>` : ""}
                            </div>`).join("")}
                        </div>
                        <p class="step-text muted">Galois keys are ${(ck.galois_keys_bytes / ck.public_context.size_bytes * 100).toFixed(1)}% of what the server receives: one key-switching key per rotation step, each a pair of polynomials with ${p.poly_modulus_degree} coefficients across the modulus chain.</p>
                    </div>`;
                const fills = el.querySelectorAll(".size-bar-fill");
                requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach((f, i) => { f.style.width = `${Math.max(0.4, rows[i].bytes / max * 100)}%`; })));
            },
        },
        {
            eli5: {
                what: `For the trip over the network you also need RSA (Rivest-Shamir-Adleman, the inventors). You picked two random prime numbers p and q (about ${rsaS.bit_lengths.p} bits each; a prime divides only by 1 and itself) and multiplied them: n = p × q, a ${rsaS.n.length}-digit number.`,
                why: "Multiplying two primes takes a computer microseconds. Going back, finding p and q from n alone, would take every computer on Earth longer than the age of the universe at this size. RSA's lock rests on that one-way street: n is public, p and q stay secret.",
                formal: "n = p × q: easy to make, practically impossible to undo.",
                next: "Next: turning p and q into a public lock (e) and a private key (d).",
            },
            eli1: {
                what: `Toy RSA: p = 5, q = 11, so n = 5 × 11 = 55.`,
                why: `Splitting 55 back into 5 × 11 is easy because 55 is tiny. Your real n has ${rsaS.n.length} digits: nobody can split it.`,
                formal: "toy: n = 5 × 11 = 55.",
                next: "Next: the toy lock and key.",
            },
            what: `The client picked two random primes, p (${rsaS.bit_lengths.p} bits, ${rsaS.p.length} digits) and q (${rsaS.bit_lengths.q} bits), and multiplied them: n = p·q has ${rsaS.bit_lengths.n} bits (${rsaS.n.length} decimal digits).`,
            why: "RSA rests on one fact: multiplying two huge primes takes a microsecond, but splitting n back into p and q is out of reach for any computer at this size. n will be public; p and q stay secret on the client.",
            formal: `n = p · q; browser: p·q = n ${checksS.primes[2].ok ? "✓" : "✕"}, Fermat(p) ${checksS.primes[0].ok ? "✓" : "✕"}, Fermat(q) ${checksS.primes[1].ok ? "✓" : "✕"}`,
            next: "Next: the client turns p and q into its public and private exponents.",
            facts: [{ id: "rsa_n_client", label: "Your RSA public modulus n = p × q", value: rsaS.n }],
            renderVisual: (el) => renderRsaKeypair(el, rsaS, checksS, false),
        },
        {
            eli5: {
                what: `From p and q you make two numbers. e = ${rsaS.e} is public: anyone may use (n, e) to lock a message m as m^e mod n (multiply m by itself e times, keep the remainder after dividing by n). d is private: c^d mod n unlocks. d is computed from λ(n), the "cycle length" of n, which needs p and q.`,
                why: `e and d are chosen so e × d leaves remainder 1 when divided by λ(n). That makes unlocking undo locking exactly: (m^e)^d = m^(e·d) comes back round to m. Without p and q nobody can compute λ(n), so nobody can find d. ${allOk(checksS) ? "✓" : "✕"} the maths checks out.`,
                formal: "Lock: c = m^e mod n. Unlock: m = c^d mod n.",
                next: "Next: the server makes its own RSA keys.",
            },
            eli1: {
                what: `Toy: p = 5, q = 11, n = 55. λ = lcm(4, 10) = 20 (lcm: the smallest number both divide). Pick e = 3 (shares no factor with 20). d = 7, because 3 × 7 = 21 = 20 + 1. Lock m = 2: 2³ = 8, 8 mod 55 = 8. Unlock: 8⁷ = 2,097,152, mod 55 = ${Number(8n ** 7n % 55n)}. Back to 2.`,
                why: "3 × 7 leaves remainder 1 after dividing by 20, so raising to 3 then to 7 goes all the way round the cycle and lands on the start. The real run does exactly this with numbers hundreds of digits long.",
                formal: `toy: 2³ mod 55 = 8; 8⁷ mod 55 = ${Number(8n ** 7n % 55n)}.`,
                next: "Next: the server's own toy-sized pair.",
            },
            what: `λ(n) = lcm(p−1, q−1) (${rsaS.bit_lengths.lambda} bits). Public exponent e = ${rsaS.e}; private exponent d = e⁻¹ mod λ(n) (${rsaS.bit_lengths.d} bits). Public key = (n, e), private key = d. Your browser re-checked ${[...checksS.primes, ...checksS.exponents].length} identities: ${allOk(checksS) ? "all hold" : "SOME FAILED"}.`,
            why: "Raising a number to e and then to d (mod n) gives it back unchanged, because e·d ≡ 1 mod λ(n). Computing λ(n), and so d, needs p and q -- which is why only the key's owner can undo what anyone can do with the public (n, e).",
            formal: rsaSEv.formal,
            next: rsaSEv.next_step,
            renderVisual: (el) => renderRsaKeypair(el, rsaS, checksS, true),
        },
        {
            eli5: {
                what: `The server made its own RSA pair the same way, and sent you its public part (n, e). Test with this run's real AES key: locked with the server's (n, e) and unlocked with its d, it comes back ${demoBack === demoM ? "exactly" : "WRONG"}.`,
                why: "Each side needs its own pair, so the other side can send it something only it can open: you lock for the server with the server's public key; the server locks the answer for you with yours.",
                formal: "Server: its own public lock (n, e) and private key d.",
                next: "Next: PBKDF2, which turns a passphrase into the AES key for the first trip.",
            },
            eli1: {
                what: `Toy server pair: p = 7, q = 13, n = 91, λ = lcm(6, 12) = 12, e = 5, d = 5 (5 × 5 = 25 = 2 × 12 + 1). Lock 2: 2⁵ = 32. Unlock: 32⁵ mod 91 = ${Number(32n ** 5n % 91n)}.`,
                why: "A different pair from yours: what is locked for the server can't be opened with your key, and the other way round.",
                formal: `toy: 2⁵ mod 91 = 32; 32⁵ mod 91 = ${Number(32n ** 5n % 91n)}.`,
                next: "Next: the passphrase.",
            },
            what: `${rsaCEv.description} Test on the real leg-1 AES key: m^e mod n, then ^d mod n, gives the key back ${demoBack === demoM ? "exactly ✓" : "WRONG ✕"}.`,
            why: rsaCEv.why,
            formal: `c = m^e mod n, m = c^d mod n (m = the ${d.dklen}-byte AES key); ${rsaCEv.formal}`,
            next: rsaCEv.next_step,
            facts: [{ id: "rsa_n_server", label: "The server's RSA public modulus n", value: rsaC.n }],
            renderVisual: (el) => renderRsaKeypair(el, rsaC, checksC, true, `
                <div class="vector-caption ks-wrap">Textbook RSA on the real ${d.dklen}-byte leg-1 AES key m = 0x${escapeHtml(d.transport_key_hex)} (the real envelope adds OAEP random padding first):</div>
                <div class="rsa-row"><div class="rsa-head"><span class="rsa-name">c</span><span class="rsa-formula">m^e mod n</span><span class="rsa-bits">${demoC.toString().length} digits</span></div><div class="bignum-box">${demoC.toString()}</div></div>
                <p class="step-text ks-wrap">c^d mod n = 0x${demoBack.toString(16).padStart(d.dklen * 2, "0")} ${ksBadge(demoBack === demoM, "equals m", "does not equal m")}</p>`),
        },
        {
            eli5: {
                what: `${generated ? "You didn't type a passphrase, so your computer made up" : "You chose"} the passphrase "${pp}". You can type your own or ask for a new random one; the whole run repeats with it.`,
                why: "AES (Advanced Encryption Standard), the fast lock for the trip, needs a key of exactly 32 random-looking bytes. People remember words, not 32 random bytes. PBKDF2 turns one into the other. (A purely random key would also work here; the passphrase shows how passwords become keys.)",
                formal: `Passphrase = "${pp}".`,
                next: "Next: 7.2, its bytes and a random salt.",
            },
            what: `${generated ? "No passphrase was typed, so the client generated a random one" : "You chose the passphrase"}: "${pp}" (${ppEv.data_after.length} characters). PBKDF2 will stretch it into the ${d.dklen}-byte AES key for the first network trip.`,
            why: "People can remember passphrases, but they are short and guessable; AES-256 needs exactly 32 random-looking bytes. PBKDF2 bridges that gap. Try your own passphrase or a fresh random one: the whole pipeline re-runs and every number in this chapter changes.",
            formal: `P = "${pp}" = 0x${d.passphrase_hex} (${d.passphrase_hex.length / 2} bytes, UTF-8)`,
            next: "Next: 7.2, the random salt that gets mixed in with it.",
            relock: true,
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">The passphrase</div>
                    <div class="scene-body">
                        <div class="ks-passphrase ${generated ? "" : "yours"}">
                            <span class="ks-passphrase-label">${generated ? "random (client-generated)" : "yours"}</span>
                            <span class="ks-passphrase-value">${escapeHtml(pp)}</span>
                        </div>
                        <div class="ks-lock-row">
                            <input type="text" id="keyPassphraseInput" class="input-text" placeholder="Type your own passphrase" autocomplete="off">
                            <div class="ks-lock-btns">
                                <button id="lockKeyBtn" class="btn" type="button">Lock with my passphrase</button>
                                <button id="randomKeyBtn" class="btn ks-btn-alt" type="button">Use random passphrase</button>
                            </div>
                        </div>
                        <span id="lockKeyStatus" class="overview-status"></span>
                        <p class="step-text muted">${escapeHtml(ppEv.why)}</p>
                    </div>`;
                lockHandler(el);
            },
        },
        {
            eli5: {
                what: `Computers store text as numbers: every character becomes one byte, a number from 0 to 255 (${d.passphrase_hex.length / 2} bytes here). Next to it: the salt, ${saltLen} random bytes made fresh for this run.`,
                why: "Without a salt, the same passphrase would always give the same key, so attackers could compute keys for millions of common passwords once and reuse that list everywhere. The salt is public, but it makes every such list useless.",
                formal: "Passphrase bytes + random salt bytes.",
                next: "Next: 7.3, the key PBKDF2 mixes in, made from the passphrase.",
            },
            eli1: {
                what: `Your passphrase starts with "${pp[0]}". The computer stores "${pp[0]}" as the number ${pp.charCodeAt(0)} (written 0x${pp.charCodeAt(0).toString(16)} in hexadecimal, base 16). Salt: ${saltLen} random bytes, the first is ${parseInt(d.salt_hex.slice(0, 2), 16)}.`,
                why: "Hexadecimal writes each byte as exactly 2 symbols (0-9, a-f), which is why keys look like long strings of 0-9 and a-f.",
                formal: `"${pp[0]}" = ${pp.charCodeAt(0)} = 0x${pp.charCodeAt(0).toString(16)}.`,
                next: "Next: the PBKDF2 machine.",
            },
            what: `Salt: ${saltLen} fresh random bytes, 0x${d.salt_hex}. The passphrase bytes (${d.passphrase_hex.length / 2}) and the salt are the only inputs to PBKDF2 besides the iteration count, ${iters}.`,
            why: "Without salt, the same passphrase would always give the same key, so an attacker could pre-compute keys for millions of common passphrases once and reuse them. A random salt makes every run's key unique; it is not secret and travels with the ciphertext.",
            formal: `salt ← random(${saltLen} bytes); P = ${d.passphrase_hex.length / 2} bytes`,
            next: "Next: 7.3, the HMAC key K built from P.",
            facts: [{ id: "pbkdf2_salt", label: "The random PBKDF2 salt for this run", value: d.salt_hex }],
            renderVisual: (el) => {
                const pBytes = bytesOfHex(d.passphrase_hex);
                const sBytes = bytesOfHex(d.salt_hex);
                el.innerHTML = `
                    <div class="scene-title">Passphrase bytes and salt</div>
                    <div class="scene-body">
                        <div class="vector-caption">Passphrase "${escapeHtml(pp)}" as UTF-8 bytes:</div>
                        <div id="ksPBytes"></div>
                        <div class="vector-caption">Salt (random):</div>
                        <div id="ksSalt"></div>
                    </div>`;
                const pChar = (i) => (/^[0-7]/.test(pBytes[i]) ? ` = '${String.fromCharCode(parseInt(pBytes[i], 16))}'` : "");
                return renderByteMatrix(el.querySelector("#ksPBytes"), pBytes, {
                    cols: Math.min(16, pBytes.length), skipAnimation: ksSkip(),
                    title: (i) => `P[${i}] = 0x${pBytes[i]}${pChar(i)}`,
                    equation: (i) => `P_{${i}} = \\mathtt{0x${pBytes[i]}}`,
                }).then(() => renderByteMatrix(el.querySelector("#ksSalt"), sBytes, {
                    cols: Math.min(16, sBytes.length), skipAnimation: ksSkip(), cellClass: () => "bm-seg-salt",
                    equation: (i) => `\\mathrm{salt}_{${i}} \\leftarrow \\text{random byte} = \\mathtt{0x${sBytes[i]}}`,
                }));
            },
        },
        {
            eli5: {
                what: `PBKDF2 (Password-Based Key Derivation Function 2) turns a short passphrase into a strong 32-byte key by stirring it with the salt ${iters} times. Each box is one stage, with this run's real value.`,
                why: `Short passwords are easy to guess. Making every single guess cost ${iters} rounds of stirring makes trying millions of guesses hopelessly slow, while you only pay it once. Steps 7.1-7.9 walk through the boxes in order.`,
                formal: `Passphrase + salt, stirred ${iters} times → 32-byte key.`,
                next: "Next: 7.1, the passphrase.",
            },
            what: `PBKDF2-HMAC-SHA256 as a graph: P is padded into the HMAC key K, K is masked two ways (ipad, opad), two SHA-256 passes give U₁ = ${ksShort(d.u1.outer_digest_hex)}, then ${(d.iterations - 1).toLocaleString()} more HMACs give U₂…U_${d.iterations}, all XORed into T = ${ksShort(d.derived_key_hex)}.`,
            why: "Each box is a real intermediate value from this run (hover a box for its full value, an arrow for what it does). The packet shows the order data flows in. Steps 7.1-7.9 go through the boxes in that order, with this graph on the right and the current box highlighted.",
            formal: pbEv.formal,
            next: "Next: 7.1, the passphrase P.",
            renderVisual: (el) => {
                el.innerHTML = `<div class="scene-title">PBKDF2, node by node</div><div class="scene-body"><div class="ks-graph"></div></div>`;
                return graphInto(el.querySelector(".ks-graph"), { lit: ["P", "salt"], flow: PBKDF2_FLOW });
            },
        },
        {
            eli5: {
                what: `The passphrase bytes are topped up with zeros to 64 bytes, called K. Then K is scrambled two different ways with XOR: once with the byte 0x36 repeated (ipad, "inner pad") and once with 0x5c repeated (opad, "outer pad"). ${ipadOk && opadOk ? "✓" : "✕"} both recomputed.`,
                why: "HMAC (Hash-based Message Authentication Code), the stirring step inside PBKDF2, mixes the key in twice. Two different scrambles give two different keys from one, so the inner and outer mixing can't be lined up against each other. XOR (exclusive or) compares bits: same → 0, different → 1; doing it twice with the same pad gives the original back.",
                formal: "K, K ⊕ 0x36…, K ⊕ 0x5c…",
                next: "Next: 7.4, the first SHA-256 'blender'.",
            },
            eli1: {
                what: (() => { const b = parseInt(kBytes[0], 16), bin = (v) => v.toString(2).padStart(8, "0"); return `First byte of K: ${b} = ${bin(b)} in bits. XOR with 0x36 = ${bin(0x36)}: ${bin(b ^ 0x36)} = ${b ^ 0x36}. XOR with 0x5c = ${bin(0x5c)}: ${bin(b ^ 0x5c)} = ${b ^ 0x5c}.`; })(),
                why: "Go column by column: where the two bits match, write 0; where they differ, write 1. All 64 bytes of K get this treatment, twice.",
                formal: (() => { const b = parseInt(kBytes[0], 16); return `${b} ⊕ 54 = ${b ^ 0x36}; ${b} ⊕ 92 = ${b ^ 0x5c}.`; })(),
                next: "Next: the blender.",
            },
            what: `K = the ${keyLen} passphrase bytes${hk.hashed_because_longer_than_64 ? " (SHA-256 of the >64-byte passphrase)" : ""} followed by ${64 - keyLen} zero bytes. K ⊕ 0x36… and K ⊕ 0x5c… recomputed in your browser: ${ipadOk && opadOk ? "both match the client ✓" : "MISMATCH ✕"}.`,
            why: "HMAC is a hash with a key mixed in. It hashes the key twice, masked with two different constants (ipad = 0x36, opad = 0x5c repeated), so the inner and outer hashes use unrelated keys even though they come from the same K. The 64-byte size is SHA-256's block size.",
            formal: "HMAC(K, m) = SHA-256((K ⊕ opad) ‖ SHA-256((K ⊕ ipad) ‖ m)), ipad = 0x36^64, opad = 0x5c^64",
            next: "Next: 7.4, inside the inner SHA-256 box.",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">HMAC key: K, K ⊕ ipad, K ⊕ opad</div>
                    <div class="scene-body">
                        <div class="ks-matrix-trio">
                            <div><div class="poly-label">K (64 bytes)</div><div id="ksK"></div></div>
                            <div><div class="poly-label">K ⊕ ipad ${ksBadge(ipadOk, "", "")}</div><div id="ksIpad"></div></div>
                            <div><div class="poly-label">K ⊕ opad ${ksBadge(opadOk, "", "")}</div><div id="ksOpad"></div></div>
                        </div>
                        <div class="ks-legend"><span class="bm-seg-key">from the passphrase</span><span class="bm-seg-zero">zero padding</span></div>
                    </div>`;
                const cls = (i) => (i < keyLen ? "bm-seg-key" : "bm-seg-zero");
                const ip = bytesOfHex(hk.K_xor_ipad_hex), op = bytesOfHex(hk.K_xor_opad_hex);
                const opts = (extra) => ({ cols: 8, cellClass: cls, skipAnimation: ksSkip(), ...extra });
                return Promise.all([
                    renderByteMatrix(el.querySelector("#ksK"), kBytes, opts({ equation: (i) => (i < keyLen ? `K_{${i}} = P_{${i}} = \\mathtt{${kBytes[i]}}` : `K_{${i}} = \\mathtt{00}\\ \\text{(pad)}`) })),
                    renderByteMatrix(el.querySelector("#ksIpad"), ip, opts({ equation: (i) => `\\mathtt{${kBytes[i]}} \\oplus \\mathtt{36} = \\mathtt{${ip[i]}}` })),
                    renderByteMatrix(el.querySelector("#ksOpad"), op, opts({ equation: (i) => `\\mathtt{${kBytes[i]}} \\oplus \\mathtt{5c} = \\mathtt{${op[i]}}` })),
                ]);
            },
        },
        {
            eli5: {
                what: `SHA-256 (Secure Hash Algorithm, 256-bit output) is a blender: any input goes in, exactly 32 bytes come out, and the same input always gives the same output. Here the input is the inner-scrambled key + the ${srcRef("pbkdf2_salt", "salt")} + a counter (1), ${msgLen} bytes, topped up to ${paddedBytes.length} bytes (${blockNo} blocks of 64).`,
                why: "The blender works on whole 64-byte blocks, so the input is topped up: one end-marker bit, zeros, then the input's own length (8 bytes). Writing the length in stops two different inputs from padding to the same blocks.",
                formal: "Inner result = SHA-256(scrambled key + salt + counter).",
                next: "Next: 7.5, the last block is cut into 64 words.",
            },
            eli1: {
                what: `Padding with your real sizes: ${msgLen} bytes of input + 1 byte holding the end marker + ${paddedBytes.length - msgLen - 9} zero bytes + 8 bytes of length (${sha.message_bit_length} bits) = ${paddedBytes.length} bytes = ${blockNo} × 64.`,
                why: "The zeros are just filler, as many as needed to make the total a multiple of 64.",
                formal: `${msgLen} + 1 + ${paddedBytes.length - msgLen - 9} + 8 = ${paddedBytes.length}.`,
                next: "Next: cutting a block into words.",
            },
            what: `Inside the inner SHA-256: its input is (K ⊕ ipad) ‖ salt ‖ INT(1) = ${msgLen} bytes. SHA-256 pads it with 0x80, zeros and the ${sha.message_bit_length}-bit length to ${paddedBytes.length} bytes, then compresses ${blockNo} 64-byte blocks. The salt enters in block ${blockNo}.`,
            why: "SHA-256 only works on whole 64-byte blocks. The padding (a single 1 bit, zeros, then the message length) makes every message a whole number of blocks and makes two different messages never pad to the same bytes.",
            formal: `inner = SHA-256(${ksShort(hk.K_xor_ipad_hex, 4)} ‖ ${d.salt_hex} ‖ 00000001) = ${sha.digest_hex}`,
            next: `Next: 7.5, block ${blockNo} is expanded into the 64-word message schedule.`,
            renderVisual: (el) => {
                el.innerHTML = `<div class="scene-title">Inside HMAC: the inner SHA-256</div><div class="scene-body"></div>`;
                return renderPadded(el.querySelector(".scene-body"), ksSkip());
            },
        },
        {
            eli5: {
                what: `The last 64-byte block is cut into 16 words of 4 bytes (W0-W15), then stretched to 64 words: each new word mixes four earlier ones (two of them bit-shuffled). ${shaCheck.schedule.every((s) => s.ok) ? "✓" : "✕"} all 48 new words recomputed.`,
                why: "The blender runs 64 rounds and each round needs its own word. Building the extra words from earlier ones spreads every input bit into many rounds, so no part of the input can hide.",
                formal: "16 words → 64 words: W_t = σ1(W_t−2) + W_t−7 + σ0(W_t−15) + W_t−16.",
                next: "Next: 7.6, the 64 blending rounds.",
            },
            eli1: {
                what: (() => { const W = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3]; return `Toy with one-digit words W0-W15 = ${W.join(" ")}. New word W16 = (W14 + W9 + W1 + W0) mod 10 = (${W[14]} + ${W[9]} + ${W[1]} + ${W[0]}) mod 10 = ${(W[14] + W[9] + W[1] + W[0]) % 10}.`; })(),
                why: "The real rule picks the same four positions (t−2, t−7, t−15, t−16), scrambles two of them first and uses 32-bit words instead of digits.",
                formal: "toy: W16 = (W14 + W9 + W1 + W0) mod 10.",
                next: "Next: the rounds.",
            },
            what: `Block ${blockNo}'s 16 words W₀…W₁₅ are expanded to 64 schedule words W₀…W₆₃. Your browser recomputed all 48 derived words: ${shaCheck.schedule.every((s) => s.ok) ? "all match ✓" : "MISMATCH ✕"}.`,
            why: "The compression function runs 64 rounds and each round consumes one word. Expanding 16 words into 64 with rotations and shifts spreads every input bit across many rounds, so a one-bit change in the salt changes the whole digest.",
            formal: "W_t = M_t (t < 16); W_t = σ1(W_{t−2}) + W_{t−7} + σ0(W_{t−15}) + W_{t−16} mod 2³², σ0 = ROTR7 ⊕ ROTR18 ⊕ SHR3, σ1 = ROTR17 ⊕ ROTR19 ⊕ SHR10",
            next: "Next: 7.6, the 64 compression rounds, one row per round.",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">Inside HMAC: message schedule</div>
                    <div class="scene-body">
                        ${innerCrumbs}
                        <div class="vector-caption">W₀…W₆₃ (32-bit words, hex). The first 16 are block ${blockNo} itself. ${ksBadge(shaCheck.schedule.every((s) => s.ok), "browser recomputation matches", "browser recomputation differs")}</div>
                        <div id="ksSchedule"></div>
                    </div>`;
                const W = block.schedule;
                return renderByteMatrix(el.querySelector("#ksSchedule"), W, {
                    cols: 8, skipAnimation: ksSkip(),
                    rowLabels: [0, 1, 2, 3, 4, 5, 6, 7].map((r) => `W${r * 8}`),
                    cellClass: (t) => (t < 16 ? "bm-seg-msg" : ""),
                    title: (t) => `W${t} = ${W[t]}${t >= 16 ? (shaCheck.schedule[t].ok ? " ✓ recomputed" : " ✕") : " (message word)"}`,
                    equation: (t) => (t < 16
                        ? `W_{${t}} = M_{${t}} = \\mathtt{${W[t]}}`
                        : `W_{${t}} = \\sigma_1(W_{${t - 2}}) + W_{${t - 7}} + \\sigma_0(W_{${t - 15}}) + W_{${t - 16}} = \\mathtt{${W[t]}}`),
                });
            },
        },
        {
            eli5: {
                what: `64 rounds stir 8 registers, a to h (a register is one 32-bit working number). Each round mixes in one word and one fixed constant, and every register shifts down one place. ${shaCheck.rounds.every((r) => r.ok) && shaCheck.hAfterOk ? "✓" : "✕"} all 64 rounds recomputed. Out comes the inner result ${ksShort(sha.digest_hex)}.`,
                why: "After 64 rounds every output bit depends on every input bit, and the mixing (additions, bit rotations, choices) can't be run backwards. That's what makes a hash one-way.",
                formal: "64 rounds of stirring → 32-byte result.",
                next: "Next: 7.7, the second blender.",
            },
            eli1: {
                what: (() => { let a = 1, b = 2; const w = [3, 1, 4], out = []; w.forEach((x, i) => { const na = (a + b + x) % 100; b = a; a = na; out.push(`round ${i + 1}: a = ${a}, b = ${b}`); }); return `Toy with 2 registers (a = 1, b = 2) and words 3, 1, 4. Each round: new a = (a + b + word) mod 100, new b = old a. ${out.join("; ")}.`; })(),
                why: "Each round feeds the old values forward, so the final a depends on every word. The real blender has 8 registers, 64 rounds and much harsher mixing.",
                formal: "toy: a ← (a + b + W) mod 100, b ← a.",
                next: "Next: the second blend.",
            },
            what: `64 rounds scramble the 8 working registers a…h, starting from ${block.H_before[0]}… (${blockNo > 1 ? `the state after block ${blockNo - 1}` : "SHA-256's initial constants"}). Your browser recomputed T₁, T₂ and all 8 registers for every round: ${shaCheck.rounds.every((r) => r.ok) && shaCheck.hAfterOk ? "all 64 match ✓" : "MISMATCH ✕"}. Adding the start state gives the inner digest ${sha.digest_hex}.`,
            why: "Each round mixes one schedule word and one constant K_t into the registers with non-linear functions (Ch, Maj) and rotations (Σ0, Σ1). After 64 rounds every output bit depends on every input bit, which is what makes the hash one-way.",
            formal: "T1 = h + Σ1(e) + Ch(e,f,g) + K_t + W_t; T2 = Σ0(a) + Maj(a,b,c); (a..h) ← (T1+T2, a, b, c, d+T1, e, f, g); H' = H + (a..h)",
            next: "Next: 7.7, the inner digest feeds the outer SHA-256.",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">Inside HMAC: 64 compression rounds</div>
                    <div class="scene-body">
                        ${innerCrumbs}
                        <div class="vector-caption">Registers a…h after each round t (hover a row for its real T₁/T₂). ${ksBadge(shaCheck.rounds.every((r) => r.ok), "browser recomputation matches", "browser recomputation differs")}</div>
                        <div id="ksRounds"></div>
                    </div>`;
                const cells = block.rounds.flat();
                return renderByteMatrix(el.querySelector("#ksRounds"), cells, {
                    cols: 8, revealBy: "row", skipAnimation: ksSkip(),
                    colLabels: ["a", "b", "c", "d", "e", "f", "g", "h"],
                    rowLabels: block.rounds.map((_, t) => `t=${t}`),
                    title: (i) => { const r = shaCheck.rounds[Math.floor(i / 8)]; return `round ${r.t}: T1=${r.T1} T2=${r.T2} K=${r.K} W=${r.W} ${r.ok ? "✓" : "✕"}`; },
                    equation: (t) => {
                        const r = shaCheck.rounds[t];
                        return `\\begin{aligned} t=${t}:\\ T_1 &= h + \\Sigma_1(e) + \\mathrm{Ch}(e,f,g) + K_{${t}} + W_{${t}} = \\mathtt{${r.T1}} \\\\ T_2 &= \\Sigma_0(a) + \\mathrm{Maj}(a,b,c) = \\mathtt{${r.T2}} \\\\ a &\\leftarrow T_1 + T_2,\\ e \\leftarrow d + T_1 \\end{aligned}`;
                    },
                });
            },
        },
        {
            eli5: {
                what: `The inner result goes through the blender again, this time after the outer-scrambled key: U₁ = SHA-256(K ⊕ opad + inner result) = ${ksShort(d.u1.outer_digest_hex)}. ${d.u1.verified_against_hmac ? "✓" : "✕"} same as Python's own HMAC.`,
                why: "Blending once with the key in front has a known weakness: an attacker can extend the input and predict the new result without knowing the key. A second blend with a different key closes it.",
                formal: "U₁ = SHA-256(K ⊕ opad ‖ SHA-256(K ⊕ ipad ‖ salt ‖ 1)).",
                next: `Next: 7.8, the same thing again and again, ${iters} times.`,
            },
            what: `The outer SHA-256 hashes (K ⊕ opad) ‖ inner digest and gives U₁ = ${d.u1.outer_digest_hex}. Checked against Python's hmac module: ${d.u1.verified_against_hmac ? "match ✓" : "MISMATCH ✕"}.`,
            why: "The outer hash wraps the inner one with the other key mask. This two-layer construction is what makes HMAC safe even though SHA-256 alone could be extended by an attacker (a length-extension attack).",
            formal: `U₁ = SHA-256((K ⊕ opad) ‖ ${ksShort(d.u1.inner_digest_hex)}) = ${d.u1.outer_digest_hex}`,
            next: `Next: 7.8, U₁ is hashed again and again, ${iters} times in total.`,
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">HMAC outer hash → U₁</div>
                    <div class="scene-body">
                        <div class="vector-caption">Inner digest = start state + final registers (the outer hash's message, after K ⊕ opad):</div>
                        <div class="ks-digest"></div>
                        <div class="vector-caption">U₁ = SHA-256((K ⊕ opad) ‖ inner digest):</div>
                        <div class="ks-u1-matrix"></div>
                    </div>`;
                const u1 = bytesOfHex(d.u1.outer_digest_hex);
                return renderByteMatrix(el.querySelector(".ks-digest"), block.H_after, {
                    cols: 8, skipAnimation: ksSkip(), cellClass: () => "bm-seg-msg",
                    equation: (i) => `H'_{${i}} = H_{${i}} + \\mathrm{reg}_{${i}} \\bmod 2^{32} = \\mathtt{${block.H_after[i]}}`,
                }).then(() => renderByteMatrix(el.querySelector(".ks-u1-matrix"), u1, {
                    cols: 16, skipAnimation: ksSkip(), cellClass: () => "bm-seg-key",
                    equation: (i) => `U_1[${i}] = \\mathrm{SHA256}((K \\oplus \\mathrm{opad}) \\| \\mathrm{inner})[${i}] = \\mathtt{${u1[i]}}`,
                }));
            },
        },
        {
            eli5: {
                what: `U₁ is fed back in as the next message: U₂ = HMAC(passphrase, U₁), U₃ = HMAC(passphrase, U₂), … up to U_${uLast.i.toLocaleString()}. Each result is XORed into a running total T. The table shows real samples from the chain.`,
                why: `This is slow on purpose: anyone guessing passphrases must also do all ${iters} rounds for every single guess. XOR-ing every U into T means skipping any round changes the key.`,
                formal: "T = U₁ ⊕ U₂ ⊕ … ⊕ U_c.",
                next: "Next: 7.9, the total is the AES key.",
            },
            eli1: {
                what: "Toy with 3-bit values U₁ = 5 (101), U₂ = 3 (011), U₃ = 4 (100). T = 101 ⊕ 011 = 110, then 110 ⊕ 100 = 010 = 2.",
                why: "Each new U flips some bits of the total. Change any one U and T changes too, so all rounds count.",
                formal: `toy: 5 ⊕ 3 ⊕ 4 = ${5 ^ 3 ^ 4}.`,
                next: "Next: the finished key.",
            },
            what: `U₂ = HMAC(P, U₁), U₃ = HMAC(P, U₂), … up to U_${uLast.i.toLocaleString()}; each is XORed into T. The table shows ${d.u_chain.length} real samples of the chain; after the last, T = ${d.derived_key_hex}.`,
            why: `Every guess an attacker makes at the passphrase has to repeat all ${iters} HMACs (${(d.iterations * 2).toLocaleString()} SHA-256 compressions of the key blocks alone), so a guess that would take nanoseconds takes a noticeable fraction of a second. XORing all U_i together means no step can be skipped.`,
            formal: `U_i = HMAC(P, U_{i−1}); T = U₁ ⊕ U₂ ⊕ … ⊕ U_${d.iterations}`,
            next: "Next: 7.9, T is the AES-256 key -- and your browser derives it independently.",
            renderVisual: (el) => {
                const rows = [];
                d.u_chain.forEach((u, k) => {
                    const prev = d.u_chain[k - 1];
                    if (prev && u.i - prev.i > 1) rows.push(`<div class="uchain-gap">… ${(u.i - prev.i - 1).toLocaleString()} more HMACs …</div>`);
                    rows.push(`<div class="uchain-row"><span class="uchain-i">i=${u.i.toLocaleString()}</span><span class="uchain-u" data-i="${u.i}">${escapeHtml(u.U_i)}</span><span class="uchain-t" data-i="${u.i}">${escapeHtml(u.T_after_i)}</span></div>`);
                });
                el.innerHTML = `
                    <div class="scene-title">The ${iters}-link chain</div>
                    <div class="scene-body">
                        <div class="uchain-table ${ksRevealClass()}">
                            <div class="uchain-row uchain-headrow"><span>i</span><span>U_i</span><span>T = U₁ ⊕ … ⊕ U_i</span></div>
                            ${rows.join("")}
                        </div>
                    </div>`;
                attachFormulaHover(el.querySelector(".uchain-table"), ".uchain-u, .uchain-t", (c) => {
                    const i = +c.dataset.i, u = d.u_chain.find((v) => v.i === i);
                    return c.classList.contains("uchain-u")
                        ? { tex: i === 1 ? "U_1 = \\mathrm{HMAC}(P,\\ S \\,\\|\\, \\mathrm{INT}(1))" : `U_{${i}} = \\mathrm{HMAC}(P,\\ U_{${i - 1}})`, note: u.U_i }
                        : { tex: i === 1 ? "T_1 = U_1" : `T_{${i}} = T_{${i - 1}} \\oplus U_{${i}}`, note: u.T_after_i };
                });
            },
        },
        {
            eli5: {
                what: `The total T is the 32-byte AES key: ${ksShort(d.derived_key_hex)}. ${d.verified_hashlib_pbkdf2 && d.verified_cryptography_pbkdf2 ? "✓" : "✕"} two independent libraries derive the same key; a third, in your browser, is shown below.`,
                why: "This key locks your CKKS ciphertext with AES for the first trip. The server never sees the passphrase: it receives this key inside an RSA envelope only it can open.",
                formal: "AES key = T.",
                next: "Next: 8, every key and where it goes.",
            },
            what: `Derived key T = ${d.derived_key_hex} (${d.dklen} bytes). Client-side it equals hashlib ${d.verified_hashlib_pbkdf2 ? "✓" : "✕"}, the cryptography library ${d.verified_cryptography_pbkdf2 ? "✓" : "✕"}, and the key hecrypto/transport.py uses ${d.transport_key_matches_trace ? "✓" : "✕"}; your browser is re-deriving it with WebCrypto now.`,
            why: "An independent implementation (your browser's) running the same PBKDF2 on the same passphrase, salt and iteration count must produce the same 32 bytes. If a single bit differed anywhere in the chain, the keys would not match.",
            formal: `crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt, iterations:${d.iterations}}, P, ${d.dklen * 8})`,
            next: "Next: 8, a summary of every key and where it goes.",
            facts: [{ id: "pbkdf2_key", label: "The AES-256 key PBKDF2 made from your passphrase", value: d.derived_key_hex }],
            renderVisual: (el) => {
                const kb = bytesOfHex(d.derived_key_hex);
                el.innerHTML = `
                    <div class="scene-title">The AES-256 key</div>
                    <div class="scene-body">
                        <div id="ksFinal" data-fact-src="pbkdf2_key"></div>
                        <div class="ks-verify">
                            <div class="ks-check ${d.verified_hashlib_pbkdf2 ? "ok" : "bad"}">${d.verified_hashlib_pbkdf2 ? "✓" : "✕"} client: hashlib.pbkdf2_hmac</div>
                            <div class="ks-check ${d.verified_cryptography_pbkdf2 ? "ok" : "bad"}">${d.verified_cryptography_pbkdf2 ? "✓" : "✕"} client: cryptography PBKDF2HMAC</div>
                            <div class="ks-check" id="ksWebCrypto">… browser: WebCrypto PBKDF2 (${iters} iterations) running</div>
                        </div>
                    </div>`;
                const matrix = renderByteMatrix(el.querySelector("#ksFinal"), kb, {
                    cols: 8, skipAnimation: ksSkip(), cellClass: () => "bm-seg-key",
                    equation: (i) => `T_{${i}} = \\textstyle\\bigoplus_{j=1}^{${d.iterations}} U_j[${i}] = \\mathtt{${kb[i]}}`,
                });
                const check = webCryptoCheck().then((r) => {
                    const box = el.querySelector("#ksWebCrypto");
                    if (!box) return;
                    box.className = `ks-check ${r.ok ? "ok" : "bad"}`;
                    box.textContent = r.error
                        ? `✕ browser: ${r.error}`
                        : `${r.ok ? "✓" : "✕"} browser: WebCrypto PBKDF2 → ${r.hex} in ${r.ms.toFixed(0)} ms ${r.ok ? "(identical)" : "(DIFFERENT)"}`;
                });
                return Promise.all([matrix, check]);
            },
        },
        {
            eli5: {
                what: `Made: one CKKS key set (secret key stays with you; public bundle to the server), two RSA key pairs (one each), and one AES key from "${pp}".`,
                why: "Two different locks for two jobs. CKKS lets the server compute without ever seeing your data. RSA + AES protect the bytes while they travel and make tampering visible. Each key has exactly one job and one owner.",
                formal: "CKKS for computing; RSA + AES for travelling.",
                next: "Next chapter: your numbers get locked with CKKS.",
            },
            what: `Keys created: 1 CKKS key set (secret ${formatBytes(ck.secret_key_context.size_bytes)} context, public ${formatBytes(ck.public_context.size_bytes)} context), 2 RSA-${rsaS.key_size} keypairs, and 1 PBKDF2 AES-256 key from "${pp}".`,
            why: "Two layers protect your data: CKKS lets the server compute without reading anything, and RSA+AES protect the bytes on the wire. Each key has one job and lives only where that job happens.",
            formal: "leg 1: AES-256-GCM_{k_PBKDF2}(Enc_CKKS(x)), k_PBKDF2 wrapped with RSA-OAEP_{(n,e)_S} · leg 2: AES-256-GCM_{k_fresh}(Enc(score)), k_fresh wrapped with RSA-OAEP_{(n,e)_C}",
            next: "Next chapter: your feature vector is CKKS-encrypted with the public key.",
            renderVisual: (el) => {
                const rows = [
                    ["CKKS secret key", partyName(ckksEv.party), `${ck.secret_key_context.size_bytes.toLocaleString()} B context`, "stays on the client; decrypts the result (Result chapter)"],
                    ["CKKS public + Galois keys", `${partyName(ckksEv.party)} → server`, `${ck.public_context.size_bytes.toLocaleString()} B`, "lets the server compute Enc(x)·Wᵀ + b (Computation chapter)"],
                    ["server RSA keypair", partyName(rsaCEv.party), `n ${rsaC.bit_lengths.n} bits`, "public half wraps the leg-1 AES key; private half unwraps it"],
                    ["client RSA keypair", partyName(rsaSEv.party), `n ${rsaS.bit_lengths.n} bits`, "public half wraps the leg-2 AES key; private half unwraps it"],
                    ["PBKDF2 AES-256 key", partyName(pbEv.party), `${d.dklen} B · ${ksShort(d.derived_key_hex)}`, "encrypts Enc(x) for leg 1, client → server (Transport → server chapter)"],
                    ["fresh AES-256 key", "server, later", `${d.dklen} B, random`, "made by the server for leg 2 (the result's trip back); not derived from any passphrase"],
                ];
                el.innerHTML = `
                    <div class="scene-title">Every key, and where it goes</div>
                    <div class="scene-body">
                        <div class="ks-summary ${ksRevealClass()}">
                            ${rows.map((r) => `<div class="ks-summary-row"><span class="ks-summary-key">${escapeHtml(r[0])}</span><span>${escapeHtml(r[1])}</span><span class="ks-summary-size">${escapeHtml(r[2])}</span><span class="ks-summary-use">${escapeHtml(r[3])}</span></div>`).join("")}
                        </div>
                    </div>`;
            },
        },
    ];
    // Graph order (PBKDF2_FLOW): P, salt -> K -> ipad/opad -> inner SHA -> outer SHA -> chain -> T -> key.
    // node(i, focus, lit, flow): step i in the split view; `lit` = boxes already reached when it starts.
    const node = (i, focus, lit, flow) => subStep(steps[i], { graph, focus, lit, flow, caption: "PBKDF2-HMAC-SHA256, this run's real values" });
    const before = ["P", "salt", "K", "ipad", "opad"];
    return [
        ...steps.slice(0, 6),                                 // 1-6: keys, CKKS, RSA
        steps[8],                                             // 7: PBKDF2 graph
        node(6, ["P"], [], []),                               // 7.1 passphrase
        node(7, ["P", "salt"], ["P"], []),                    // 7.2 bytes + salt
        node(9, ["K", "ipad", "opad"], ["P", "salt"], [["P>K"], ["K>ipad", "K>opad"]]),   // 7.3 HMAC key
        node(10, ["inner"], before, [["ipad>inner", "salt>inner"]]),                       // 7.4 inner SHA-256 input
        node(11, ["inner"], [...before, "inner"], []),        // 7.5 message schedule
        node(12, ["inner"], [...before, "inner"], []),        // 7.6 64 rounds
        node(13, ["outer"], [...before, "inner"], [["inner>outer", "opad>outer"]]),        // 7.7 outer hash -> U1
        node(14, ["chain", "xor"], [...before, "inner", "outer"], [["outer>chain"], ["chain>xor"]]), // 7.8 chain
        node(15, ["key"], [...before, "inner", "outer", "chain", "xor"], [["xor>key"]]),   // 7.9 AES key
        steps[16],                                            // 8: every key
    ];
}
