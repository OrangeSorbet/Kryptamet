// Browser-side re-computation of the CKKS encryption trace
// (hecrypto/ckks_encode_trace.py, event ckks_encrypt), so the Encryption
// chapter checks the numbers instead of just displaying them:
//   slot packing rule, Δ-rounding, the canonical embedding of the full
//   8192-coefficient m(X) at all N/2 slot roots (σ(m)/Δ must give x back),
//   Miller-Rabin + q ≡ 1 (mod 2N) for every prime, RNS residues (BigInt),
//   the TenSEAL/SEAL/zstd header bytes, SHA-256 of the ciphertext (WebCrypto),
//   and the decryption noise of the round trip.
function encCheckPacking(x, sp) {
    const d = x.length, slots = sp.slots;
    const rep = sp.replication;
    return {
        copiesOk: rep.full_copies === Math.floor(slots / d) && rep.partial_copy_len === slots % d && sp.zero_padded_slots === 0,
        first16Ok: sp.first_16_slots.every((v, j) => v === x[j % d]),
        nonzeroOk: sp.nonzero.every(([i, v]) => x[i] === v) && sp.nonzero.length === x.filter((v) => v !== 0).length,
    };
}

// Python rounds halves to even; an exact .5 is accepted either way.
function encCheckScaling(values, delta) {
    return values.map((v) => {
        const t = v.x * delta; // exact: delta is a power of two
        const f = Math.floor(t);
        const ok = t - f === 0.5 ? [f, f + 1].map(String).includes(v.rounded) : String(Math.round(t)) === v.rounded;
        return { ...v, ok: ok && t === v.x_times_delta };
    });
}

// σ(m)_j = m(ζ^(3^j mod 2N)), ζ = e^(iπ/N). Returns the worst |σ(m)_j/Δ − x[j mod d]|
// over all N/2 slots and the worst imaginary part (should be ~0 for real x).
const reembedCache = new Map();
function encReembed(coeffs, x, delta) {
    const key = coeffs[0] + ":" + coeffs.length + ":" + x.length;
    if (!reembedCache.has(key)) reembedCache.set(key, new Promise((resolve) => setTimeout(() => {
        const t0 = performance.now();
        const N = coeffs.length, M = 2 * N;
        const m = Float64Array.from(coeffs, Number);
        const cos = new Float64Array(M), sin = new Float64Array(M);
        for (let t = 0; t < M; t++) { cos[t] = Math.cos(Math.PI * t / N); sin[t] = Math.sin(Math.PI * t / N); }
        let maxErr = 0, maxImag = 0, p = 1;
        const d = x.length;
        for (let j = 0; j < N / 2; j++) {
            let re = 0, im = 0, idx = 0;
            for (let k = 0; k < N; k++) {
                re += m[k] * cos[idx];
                im += m[k] * sin[idx];
                idx += p;
                if (idx >= M) idx -= M;
            }
            maxErr = Math.max(maxErr, Math.abs(re / delta - x[j % d]));
            maxImag = Math.max(maxImag, Math.abs(im / delta));
            p = (p * 3) % M;
        }
        resolve({ maxErr, maxImag, ms: performance.now() - t0, slots: N / 2 });
    }, 30)));
    return reembedCache.get(key);
}

function encIsPrime(n) {
    if (n < 2n) return false;
    const bases = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]; // deterministic below 3.3e24
    for (const b of bases) if (n % b === 0n) return n === b;
    let d = n - 1n, s = 0;
    while (!(d & 1n)) { d >>= 1n; s++; }
    for (const a of bases) {
        let y = biModPow(a, d, n);
        if (y === 1n || y === n - 1n) continue;
        let composite = true;
        for (let r = 1; r < s; r++) {
            y = (y * y) % n;
            if (y === n - 1n) { composite = false; break; }
        }
        if (composite) return false;
    }
    return true;
}

function encCheckRns(rns, mCoeffs, N) {
    const primes = rns.primes.map((p) => {
        const q = BigInt(p.q);
        return { ...p, primeOk: encIsPrime(q), nttOk: q % BigInt(2 * N) === 1n, bitsOk: q.toString(2).length === p.bits };
    });
    const residues = rns.m_mod_q_first_16.map((r) => {
        const q = BigInt(r.q);
        return r.coeffs.map((c, i) => ((BigInt(mCoeffs[i]) % q) + q) % q === BigInt(c));
    });
    return { primes, residues, allOk: primes.every((p) => p.primeOk && p.nttOk && p.bitsOk) && residues.flat().every(Boolean) };
}

// TenSEAL's protobuf wrapper: field 1 = packed varint vector size, field 2 =
// the SEAL blob (SEAL header little-endian, then a zstd frame), field 3 =
// the scale as a float64. Parsed byte by byte.
function encVarint(bytes, i) {
    let v = 0, shift = 0;
    while (bytes[i] & 0x80) { v += (bytes[i] & 0x7f) * 2 ** shift; shift += 7; i++; }
    return { v: v + bytes[i] * 2 ** shift, next: i + 1 };
}

function encParseHeader(bytes, seal, d, delta) {
    const f1 = encVarint(bytes, 2);             // bytes[0] = 0x0a (field 1, LEN), bytes[1] = its length
    const f2 = encVarint(bytes, f1.next + 1);   // tag 0x12 (field 2, LEN), then the blob length
    const len = f2.v;
    const off = f2.next;
    const u16 = bytes[off] | (bytes[off + 1] << 8);
    let size = 0;
    for (let k = 7; k >= 0; k--) size = size * 256 + bytes[off + 8 + k];
    const zstdAt = off + bytes[off + 2];
    const zstd = [0x28, 0xb5, 0x2f, 0xfd].every((b, k) => bytes[zstdAt + k] === b);
    const tail = off + len;                     // tag 0x19 (field 3, fixed64), then 8 bytes
    const scale = new DataView(Uint8Array.from(bytes.slice(tail + 1, tail + 9)).buffer).getFloat64(0, true);
    const r = {
        vecSize: f1.v, protoLen: len, offset: off, magic: "0x" + u16.toString(16), headerSize: bytes[off + 2],
        version: `${bytes[off + 3]}.${bytes[off + 4]}`, comprMode: bytes[off + 5], size, zstdAt, zstd, tail, scale,
    };
    r.ok = bytes[0] === 0x0a && f1.v === d && bytes[f1.next] === 0x12 && off === seal.offset && len === seal.seal_blob_size
        && r.magic === seal.magic && r.headerSize === seal.header_size && r.version === seal.seal_version
        && r.comprMode === seal.compr_mode_code && size === len && zstd
        && bytes[tail] === 0x19 && scale === delta && tail + 9 === bytes.length;
    return r;
}

const encShaCache = new Map();
function encSha256(b64) {
    if (!encShaCache.has(b64)) encShaCache.set(b64, (async () => {
        if (!(window.crypto && crypto.subtle)) return { error: "WebCrypto unavailable (page is not a secure context)" };
        const bytes = aesB64Bytes(b64);
        return { hex: aesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))), bytes };
    })());
    return encShaCache.get(b64);
}

function encCheckRoundtrip(rt, mCoeffs, x) {
    const noise = rt.decrypted_poly_first_16.map((c, i) => Number(BigInt(c) - BigInt(mCoeffs[i])));
    return {
        noise,
        noiseOk: noise.every((e) => Math.abs(e) <= rt.max_abs_noise_coeff),
        slotsOk: rt.decrypted_first_16.every((v, j) => Math.abs(v - x[j % x.length]) <= rt.max_abs_error),
    };
}
