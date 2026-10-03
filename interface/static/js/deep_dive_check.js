// Browser-side re-computation of the CKKS deep-dive (hecrypto/ckks_math.py,
// /api/ckks_deep_dive): every polynomial relation is re-checked exactly with
// BigInt negacyclic products mod Q = 2^60, and every decryption is decoded at
// the slot roots ζ^(5^j) and compared with values the browser computes from
// the plaintext x and w. Coefficients arrive as decimal strings (they pass
// JS's 2^53 safe-int range). Each check runs once, on first use (memoized).
const DD_N = 256, DD_SLOTS = 128, DD_Q_BITS = 60;
const ddMod = (v) => BigInt.asUintN(DD_Q_BITS, v);
const ddCenter = (v) => { v = ddMod(v); return v > (1n << 59n) ? v - (1n << 60n) : v; };
const ddPoly = (arr) => arr.map((v) => BigInt(v));
const ddAdd = (...ps) => ps[0].map((_, k) => ps.reduce((s, p) => s + p[k], 0n));
const ddEq = (a, b) => a.every((v, k) => ddMod(v) === ddMod(b[k]));

// Negacyclic product in Z[X]/(X^N + 1); inputs are centered, so ternary and
// small-error polynomials stay small and zero coefficients are skipped.
function ddMul(a, b) {
    const n = a.length, acc = new Array(n).fill(0n);
    for (let i = 0; i < n; i++) {
        const ai = a[i];
        if (ai === 0n) continue;
        for (let j = 0; j < n; j++) {
            const k = i + j;
            if (k < n) acc[k] += ai * b[j]; else acc[k - n] -= ai * b[j];
        }
    }
    return acc.map(ddMod);
}

// slot j = Re m(ζ^(5^j)) / scale, ζ = e^(iπ/N): the decode the client uses.
const DD_COS = Array.from({ length: 2 * DD_N }, (_, t) => Math.cos((Math.PI * t) / DD_N));
const DD_EXP = Array.from({ length: DD_SLOTS }, (_, j) => { let e = 1; for (let k = 0; k < j; k++) e = (e * 5) % (2 * DD_N); return e; });
function ddDecode(poly, scale) {
    const c = poly.map((v) => Number(ddCenter(BigInt(v))));
    return DD_EXP.map((e) => c.reduce((s, ci, i) => s + ci * DD_COS[(i * e) % (2 * DD_N)], 0) / scale);
}

const ddMaxErr = (a, b) => a.reduce((m, v, k) => Math.max(m, Math.abs(v - b[k])), 0);
const ddDec = (ct, s) => ddAdd(ddPoly(ct.c0), ddMul(ddPoly(ct.c1), s)).map(ddMod);

const _ddCache = new WeakMap();
function ddChecks(dd) {
    if (_ddCache.has(dd)) return _ddCache.get(dd);
    const p = dd.params, d1 = p.scale, d2 = p.scale * p.scale, base = p.shown_chunk * DD_SLOTS;
    const chunk = (v) => Array.from({ length: DD_SLOTS }, (_, j) => v[base + j] ?? 0);
    const xs = chunk(dd.original_vector), ws = chunk(dd.weights);
    const s = ddPoly(dd.keygen.secret_key_s);
    // Per-slot sum over all chunks of x_i·w_i: what the encrypted chunk sum must hold.
    const S = Array.from({ length: DD_SLOTS }, (_, j) => {
        let t = 0;
        for (let c = j; c < dd.original_vector.length; c += DD_SLOTS) t += dd.original_vector[c] * dd.weights[c];
        return t;
    });
    const once = (f) => { let v; return () => (v === undefined ? (v = f()) : v); };
    const timed = (f) => () => { const t = performance.now(); const r = f(); r.ms = performance.now() - t; return r; };
    const k = dd.keygen, e = dd.encrypt, ev = dd.evaluate;

    const C = {
        xs, ws, S,
        encode: once(timed(() => {
            const mx = ddDecode(dd.encode.m_coeffs, d1), mw = ddDecode(dd.encode.w_coeffs, d1);
            return { mx, mw, xErr: ddMaxErr(mx, xs), wErr: ddMaxErr(mw, ws) };
        })),
        secret: once(() => {
            const counts = { "-1": 0, 0: 0, 1: 0 };
            s.forEach((v) => { counts[String(v)] = (counts[String(v)] ?? 0) + 1; });
            return { counts, ok: counts["-1"] + counts[0] + counts[1] === DD_N };
        }),
        publicKey: once(timed(() => {
            const as = ddMul(ddPoly(k.public_key_a), s);
            return { ok: ddEq(ddPoly(k.public_key_b), ddAdd(ddPoly(k.error_e), as.map((v) => -v))) };
        })),
        c0: once(timed(() => ({ ok: ddEq(ddPoly(e.c0), ddAdd(ddMul(ddPoly(k.public_key_b), ddPoly(e.ephemeral_u)), ddPoly(e.error_e1), ddPoly(dd.encode.m_coeffs))) }))),
        c1: once(timed(() => ({ ok: ddEq(ddPoly(e.c1), ddAdd(ddMul(ddPoly(k.public_key_a), ddPoly(e.ephemeral_u)), ddPoly(e.error_e2))) }))),
        fresh: once(timed(() => {
            const slots = ddDecode(ddDec(e, s), d1);
            return { slots, err: ddMaxErr(slots, xs), serverOk: ddMaxErr(slots, dd.decrypt.recovered_vector) < 1e-9 };
        })),
        mul: once(timed(() => {
            const w = ddPoly(dd.encode.w_coeffs);
            const ok = ddEq(ddPoly(ev.mul_plain.c0), ddMul(ddPoly(e.c0), w)) && ddEq(ddPoly(ev.mul_plain.c1), ddMul(ddPoly(e.c1), w));
            const slots = ddDecode(ddDec(ev.mul_plain, s), d2);
            const want = xs.map((v, j) => v * ws[j]);
            return { ok, slots, want, err: ddMaxErr(slots, want) };
        })),
        chunkSum: once(timed(() => {
            const slots = ddDecode(ddDec(ev.chunk_sum, s), d2);
            return { slots, want: S, err: ddMaxErr(slots, S) };
        })),
        // Rotation r: decrypt and compare with the partial sums P_r[j] = P_{r-1}[j] + P_{r-1}[(j+k) mod 128].
        rotation: (r) => C._rot[r](),
        bias: once(timed(() => {
            const last = ev.rotations[ev.rotations.length - 1];
            const ok = ddEq(ddPoly(ev.add_bias.c0), ddAdd(ddPoly(last.c0), ddPoly(ev.bias_pt))) && ddEq(ddPoly(ev.add_bias.c1), ddPoly(last.c1));
            const biasSlots = ddDecode(ev.bias_pt, d2);
            return { ok, biasErr: ddMaxErr(biasSlots, biasSlots.map(() => dd.bias)), coeff0: ddCenter(BigInt(ev.bias_pt[0])) };
        })),
        decrypt: once(timed(() => {
            const m = ddDec(ev.add_bias, s);
            const slots = ddDecode(m, d2);
            return { ok: ddEq(ddPoly(dd.decrypt.m_prime), m), slots, score: slots[0] };
        })),
    };
    const partial = [S];
    ev.rotations.forEach((rot, r) => {
        const prev = partial[r];
        partial.push(prev.map((v, j) => v + prev[(j + rot.step) % DD_SLOTS]));
    });
    C._rot = ev.rotations.map((rot, r) => once(timed(() => {
        const slots = ddDecode(ddDec(rot, s), d2);
        let g = 1;
        for (let t = 0; t < rot.step; t++) g = (g * 5) % (2 * DD_N);
        return { slots, want: partial[r + 1], err: ddMaxErr(slots, partial[r + 1]), galoisOk: g === rot.galois };
    })));
    _ddCache.set(dd, C);
    return C;
}
