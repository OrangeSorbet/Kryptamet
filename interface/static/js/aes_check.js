// Browser-side re-computation of the transport layer, so the Transport
// chapters check the backend's AES-256-GCM trace (hecrypto/aes_trace.py)
// instead of just displaying it:
//   checkAesGcmTrace(trace)  -- S-box, key schedule, all 14 rounds of
//       keystream block 1, every shown counter/keystream/ciphertext block,
//       H, AES_K(J0), each GHASH step (BigInt GF(2^128)) and the tag.
//   oaepOpen(encB64, rsa)    -- c^d mod n with BigInt, then the OAEP decode
//       (MGF1-SHA256 via WebCrypto digest) that reveals the AES key inside.
//   browserUnwrap(wrap, rsa) -- WebCrypto RSA-OAEP + AES-GCM decrypt of the
//       full wire payload, its SHA-256, and the same bit flips the server made.
const aesBytes = (hex) => (String(hex).match(/../g) || []).map((b) => parseInt(b, 16));
const aesHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const aesB64Bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function aesGfMul(a, b) {
    let r = 0;
    while (b) {
        if (b & 1) r ^= a;
        a = a & 0x80 ? ((a << 1) ^ 0x1b) & 0xff : a << 1;
        b >>= 1;
    }
    return r;
}

// FIPS-197 S-box from its definition: GF(2^8) inverse, then the affine map.
const AES_SBOX = (() => {
    const s = [];
    for (let x = 0; x < 256; x++) {
        let inv = x ? 1 : 0;
        if (x) for (let i = 0; i < 254; i++) inv = aesGfMul(inv, x);
        let v = inv;
        for (let k = 1; k < 5; k++) v ^= ((inv << k) | (inv >> (8 - k))) & 0xff;
        s.push(v ^ 0x63);
    }
    return s;
})();
const AES_RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
const MIX_COEFFS = [[2, 3, 1, 1], [1, 2, 3, 1], [1, 1, 2, 3], [3, 1, 1, 2]];

function aesExpandKey(key) {
    const w = [];
    for (let i = 0; i < 8; i++) w.push(key.slice(4 * i, 4 * i + 4));
    for (let i = 8; i < 60; i++) {
        let t = [...w[i - 1]];
        if (i % 8 === 0) {
            t = [...t.slice(1), t[0]].map((b) => AES_SBOX[b]);
            t[0] ^= AES_RCON[i / 8 - 1];
        } else if (i % 8 === 4) {
            t = t.map((b) => AES_SBOX[b]);
        }
        w.push(w[i - 8].map((b, k) => b ^ t[k]));
    }
    return w;
}

// State matrices are [row][col]; byte i of a block sits at row i%4, col i/4.
const aesRoundKey = (w, r) => [0, 1, 2, 3].map((row) => [0, 1, 2, 3].map((c) => w[4 * r + c][row]));
const aesBlockToState = (bytes) => [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => bytes[r + 4 * c]));
const aesStateToBlock = (s) => [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => s[r][c]));
const aesSubBytes = (s) => s.map((row) => row.map((b) => AES_SBOX[b]));
const aesShiftRows = (s) => s.map((row, r) => [...row.slice(r), ...row.slice(0, r)]);
const aesMixColumns = (s) => s.map((_, r) => [0, 1, 2, 3].map((c) =>
    MIX_COEFFS[r].reduce((acc, k, j) => acc ^ aesGfMul(s[j][c], k), 0)));
const aesAddRoundKey = (s, k) => s.map((row, r) => row.map((b, c) => b ^ k[r][c]));

function aesEncryptBlock(w, block) {
    let s = aesAddRoundKey(aesBlockToState(block), aesRoundKey(w, 0));
    for (let r = 1; r <= 14; r++) {
        s = aesShiftRows(aesSubBytes(s));
        if (r < 14) s = aesMixColumns(s);
        s = aesAddRoundKey(s, aesRoundKey(w, r));
    }
    return aesStateToBlock(s);
}

const aesInc32 = (block) => {
    const out = [...block];
    for (let i = 15; i >= 12; i--) { out[i] = (out[i] + 1) & 0xff; if (out[i]) break; }
    return out;
};

const GCM_R = 0xe1n << 120n;
function gf128Mul(x, y) {
    let z = 0n, v = y;
    for (let i = 127n; i >= 0n; i--) {
        if ((x >> i) & 1n) z ^= v;
        v = v & 1n ? (v >> 1n) ^ GCM_R : v >> 1n;
    }
    return z;
}
const big128 = (hex) => BigInt("0x" + hex);
const hex128 = (n) => n.toString(16).padStart(32, "0");

function checkAesGcmTrace(t) {
    const same = (state, hexMatrix) => state.every((row, r) => row.every((b, c) => b === parseInt(hexMatrix[r][c], 16)));
    const sboxOk = AES_SBOX.every((v, i) => v === parseInt(t.sbox[i >> 4][i & 15], 16));
    const w = aesExpandKey(aesBytes(t.key_hex));
    const wordsOk = w.every((x, i) => aesHex(x) === t.key_expansion.words[i]);
    const roundKeysOk = t.key_expansion.round_keys.every((m, r) => same(aesRoundKey(w, r), m));

    // Keystream block 1: every stage of every round, continuing from the browser's own state.
    const k1 = t.keystream1_rounds;
    const ctr1 = aesInc32(aesBytes(t.j0_hex));
    const inputOk = same(aesBlockToState(ctr1), k1.input_state);
    let s = aesAddRoundKey(aesBlockToState(ctr1), aesRoundKey(w, 0));
    const initOk = same(s, k1.after_initial_add_round_key) && same(aesRoundKey(w, 0), k1.round_key_0);
    const rounds = k1.rounds.map((R) => {
        const start = same(s, R.start);
        const sb = aesSubBytes(s), sr = aesShiftRows(sb);
        const mc = R.round < 14 ? aesMixColumns(sr) : sr;
        const out = aesAddRoundKey(mc, aesRoundKey(w, R.round));
        const ok = {
            start, sub: same(sb, R.after_sub_bytes), shift: same(sr, R.after_shift_rows),
            mix: R.round < 14 ? same(mc, R.after_mix_columns) : R.after_mix_columns === null,
            key: same(aesRoundKey(w, R.round), R.round_key), add: same(out, R.after_add_round_key),
        };
        s = out;
        return { round: R.round, ...ok, ok: Object.values(ok).every(Boolean) };
    });
    const ks1Hex = aesHex(aesStateToBlock(s));
    const ks1Ok = ks1Hex === k1.ciphertext_hex;

    // Counter blocks, keystreams and ciphertext blocks shown in the trace.
    let ctr = aesBytes(t.j0_hex);
    const blocks = t.blocks.map((b) => {
        ctr = aesInc32(ctr);
        const ks = aesEncryptBlock(w, ctr);
        const p = aesBytes(b.plaintext_hex);
        const c = p.map((x, i) => x ^ ks[i]);
        return {
            index: b.index,
            counterOk: aesHex(ctr) === b.counter_hex,
            keystreamOk: aesHex(ks) === b.keystream_hex,
            xorOk: aesHex(c) === b.ciphertext_hex,
        };
    });
    const headOk = t.blocks.map((b) => b.ciphertext_hex).join("") === t.ciphertext_head_hex.slice(0, t.blocks.length * 32);

    // H, AES_K(J0), GHASH steps and the tag.
    const hHex = aesHex(aesEncryptBlock(w, new Array(16).fill(0)));
    const ekj0Hex = aesHex(aesEncryptBlock(w, aesBytes(t.j0_hex)));
    const H = big128(hHex);
    const g = t.ghash;
    const ghash = g.steps.map((st, k) => {
        const xor = big128(st.x_prev_hex) ^ big128(st.block_hex);
        const x = gf128Mul(xor, H);
        const prev = g.steps[k - 1];
        const contiguous = !prev || (prev.source === st.source && prev.index + 1 === st.index)
            || (prev.source === "aad" && st.source === "ciphertext" && prev.index === g.aad_blocks && st.index === 1);
        return {
            ...st, contiguous,
            ok: hex128(xor) === st.xor_hex && hex128(x) === st.x_hex && (!contiguous || !prev || prev.x_hex === st.x_prev_hex),
        };
    });
    const lenHex = (8 * t.aad_len).toString(16).padStart(16, "0") + (8 * t.ciphertext_len).toString(16).padStart(16, "0");
    const S = g.steps[g.steps.length - 1].x_hex;
    const tagHex = hex128(big128(ekj0Hex) ^ big128(S));
    const checks = {
        sboxOk, wordsOk, roundKeysOk, inputOk, initOk, ks1Ok, headOk,
        roundsOk: rounds.every((r) => r.ok),
        blocksOk: blocks.every((b) => b.counterOk && b.keystreamOk && b.xorOk),
        hOk: hHex === t.h_hex, ekj0Ok: ekj0Hex === t.ek_j0_hex,
        ghashOk: ghash.every((x) => x.ok), lenOk: lenHex === g.len_block_hex && S === g.s_hex,
        tagOk: tagHex === t.tag_hex,
    };
    return { ...checks, allOk: Object.values(checks).every(Boolean), rounds, blocks, ghash, ks1Hex, hHex, ekj0Hex, tagHex, words: w };
}

// --- RSA-OAEP (RFC 8017 7.1.2) -------------------------------------------------
async function mgf1Sha256(seed, len) {
    const out = [];
    for (let counter = 0; out.length < len; counter++) {
        const input = new Uint8Array([...seed, counter >>> 24, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff]);
        out.push(...new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
    }
    return out.slice(0, len);
}

const oaepCache = new Map();
function oaepOpen(encB64, rsa) {
    if (!oaepCache.has(encB64)) oaepCache.set(encB64, oaepOpenUncached(encB64, rsa));
    return oaepCache.get(encB64);
}

async function oaepOpenUncached(encB64, rsa) {
    if (!(window.crypto && crypto.subtle)) return { error: "WebCrypto unavailable (page is not a secure context)" };
    const k = Number(rsa.key_size) / 8;
    const c = BigInt("0x" + aesHex(aesB64Bytes(encB64)));
    const t0 = performance.now();
    const m = biModPow(c, BigInt(rsa.d), BigInt(rsa.n));
    const em = aesBytes(m.toString(16).padStart(2 * k, "0"));
    const ms = performance.now() - t0;
    const maskedSeed = em.slice(1, 33), maskedDB = em.slice(33);
    const seed = (await mgf1Sha256(maskedDB, 32)).map((b, i) => b ^ maskedSeed[i]);
    const db = (await mgf1Sha256(seed, k - 33)).map((b, i) => b ^ maskedDB[i]);
    const lHash = aesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(0))));
    const one = db.indexOf(1, 32);
    return {
        em, maskedSeed, maskedDB, seed, db, ms, one,
        lHashOk: aesHex(db.slice(0, 32)) === lHash,
        zerosOk: db.slice(32, one).every((b) => b === 0),
        firstByteOk: em[0] === 0,
        keyHex: aesHex(db.slice(one + 1)),
    };
}

// --- WebCrypto unwrap of the real wire payload --------------------------------
function bigToB64url(n) {
    let h = BigInt(n).toString(16);
    if (h.length % 2) h = "0" + h;
    return btoa(String.fromCharCode(...aesBytes(h))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const unwrapCache = new Map();
function browserUnwrap(wrap, rsa, expectedSha, tamper) {
    if (!unwrapCache.has(wrap.aes_ciphertext_b64)) unwrapCache.set(wrap.aes_ciphertext_b64, browserUnwrapUncached(wrap, rsa, expectedSha, tamper));
    return unwrapCache.get(wrap.aes_ciphertext_b64);
}

async function browserUnwrapUncached(wrap, rsa, expectedSha, tamper) {
    if (!(window.crypto && crypto.subtle)) return { error: "WebCrypto unavailable (page is not a secure context)" };
    try {
        const t0 = performance.now();
        const jwk = { kty: "RSA", alg: "RSA-OAEP-256", ext: true };
        [["n", rsa.n], ["e", rsa.e], ["d", rsa.d], ["p", rsa.p], ["q", rsa.q], ["dp", rsa.dmp1], ["dq", rsa.dmq1], ["qi", rsa.iqmp]]
            .forEach(([k, v]) => { jwk[k] = bigToB64url(v); });
        const priv = await crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
        const rawKey = new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, aesB64Bytes(wrap.encrypted_aes_key_b64)));
        const aesKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
        const ct = aesB64Bytes(wrap.aes_ciphertext_b64);
        const sealed = new Uint8Array(ct.length + 16);
        sealed.set(ct);
        sealed.set(aesBytes(wrap.tag_hex), ct.length);
        const params = { name: "AES-GCM", iv: new Uint8Array(aesBytes(wrap.nonce_hex)), additionalData: new Uint8Array(aesBytes(wrap.aad_hex)), tagLength: 128 };
        const plain = new Uint8Array(await crypto.subtle.decrypt(params, aesKey, sealed));
        const sha = aesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", plain)));
        const ms = performance.now() - t0;
        // Same flips as the server's tamper test, on a copy of this exact payload.
        const rejects = async (offset, bit) => {
            const copy = sealed.slice();
            copy[offset] ^= 1 << bit;
            try { await crypto.subtle.decrypt(params, aesKey, copy); return false; } catch (e) { return true; }
        };
        const ctFlipRejected = await rejects(tamper.flipped_byte_index, tamper.bit);
        const tagFlipRejected = await rejects(ct.length + tamper.tag_flip.flipped_byte_index, tamper.tag_flip.bit);
        return {
            keyHex: aesHex(rawKey), keyOk: aesHex(rawKey) === wrap.aes_key_hex,
            size: plain.length, sha, shaOk: sha === expectedSha, ms,
            ctFlipRejected, tagFlipRejected,
        };
    } catch (e) {
        return { error: String(e) };
    }
}
