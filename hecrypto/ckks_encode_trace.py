"""Step-by-step, real-valued trace of how TenSEAL/SEAL CKKS turns a feature vector into a ciphertext.

Everything is either READ from SEAL through TenSEAL's bundled bindings (`tenseal.sealapi`, the context's
SEALContext, the ciphertext object) or COMPUTED here by Kryptamet and then cross-checked against SEAL.
Each step carries a `source` field saying which.
"""
import base64
import hashlib
import os
import struct
import tempfile
import time
from functools import lru_cache

import numpy as np
import tenseal.sealapi as sealapi

from hecrypto.encrypt import encrypt_vector

_COMPR = {0: "none", 1: "zlib", 2: "zstd"}


def _is_prime(n):
    # Deterministic Miller-Rabin: these bases are exact for all n < 3.3e24 (covers 64-bit).
    if n < 2:
        return False
    bases = (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37)
    for p in bases:
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d, r = d // 2, r + 1
    for a in bases:
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


@lru_cache(maxsize=None)
def _bitrev(n):
    bits = n.bit_length() - 1
    return np.array([int(format(i, f"0{bits}b")[::-1], 2) for i in range(n)])


@lru_cache(maxsize=None)
def _seal_psi(q, n):
    # SEAL's NTTTables use the *minimal* primitive 2n-th root of unity mod q (util::try_minimal_primitive_root).
    for g in range(2, 1 << 16):
        r = pow(g, (q - 1) // (2 * n), q)
        if pow(r, n, q) == q - 1:
            break
    r2, x, best = r * r % q, r, r
    for _ in range(n - 1):
        x = x * r2 % q
        best = min(best, x)
    return best


def _cyclic_dft(a, w, q):
    """sum_t a[t] * w^(t*k) mod q for all k, radix-2 over Python ints (object arrays)."""
    n = len(a)
    powers = [1] * n
    for k in range(1, n):
        powers[k] = powers[k - 1] * w % q
    powers = np.array(powers, dtype=object)
    a = np.array(a, dtype=object)[_bitrev(n)]
    length = 2
    while length <= n:
        a = a.reshape(-1, length)
        half = length // 2
        u, v = a[:, :half], a[:, half:] * powers[:: n // length][:half] % q
        a = np.concatenate([(u + v) % q, (u - v) % q], axis=1).reshape(-1)
        length *= 2
    return a


def _seal_intt(ntt_vals, q):
    """Undo SEAL's negacyclic NTT: input is SEAL's NTT form (bit-reversed order, value j = m(psi^(2*brv(j)+1)))."""
    n = len(ntt_vals)
    psi_inv = pow(_seal_psi(q, n), -1, q)
    y = _cyclic_dft(np.array(ntt_vals, dtype=object)[_bitrev(n)], psi_inv * psi_inv % q, q)
    n_inv, out, p = pow(n, -1, q), [0] * n, 1
    for i in range(n):
        out[i] = int(y[i]) * p % q * n_inv % q
        p = p * psi_inv % q
    return out


def _centered(v, q):
    return v - q if v > q // 2 else v


def _slot_roots(n):
    """Index map: slot j <-> 2N-th root zeta^(3^j mod 2N) (SEAL's CKKSEncoder uses generator 3), conjugate at zeta^-(3^j)."""
    e = np.empty(n // 2, dtype=np.int64)
    acc = 1
    for j in range(n // 2):
        e[j] = acc
        acc = acc * 3 % (2 * n)
    return e


def _inverse_embedding(z, n):
    """sigma^-1: slots -> real polynomial coefficients. m_k = (1/N) sum_{odd e} v_e zeta^(-e k), via one FFT."""
    e = _slot_roots(n)
    v = np.zeros(n, dtype=complex)  # v[t] = value at zeta^(2t+1)
    v[(e - 1) // 2] = z
    v[(2 * n - e - 1) // 2] = np.conj(z)
    k = np.arange(n)
    return (np.fft.fft(v) / n * np.exp(-1j * np.pi * k / n)).real


def _embedding(m, n):
    """sigma: polynomial coefficients -> slot values m(zeta^(3^j))."""
    k = np.arange(n)
    v = np.fft.ifft(m * np.exp(1j * np.pi * k / n)) * n  # v[t] = m(zeta^(2t+1))
    return v[(_slot_roots(n) - 1) // 2]


def _read_ciphertext_coeffs(context, ct):
    """Real ciphertext coefficient data from SEAL (TenSEAL's Ciphertext has no working array accessor,
    so round-trip it through SEAL's own save/load into a sealapi Ciphertext)."""
    fd, path = tempfile.mkstemp(suffix=".sealct")
    os.close(fd)
    try:
        ct.save(path)
        loaded = sealapi.Ciphertext()
        loaded.load(context.seal_context().data, path)
    finally:
        os.remove(path)
    arr = loaded.dyn_array()
    return [arr.at(i) for i in range(arr.size())]


def trace_ckks_encryption(context, x, enc_vector=None):
    t_start = time.perf_counter()
    x = np.asarray(x, dtype=float).ravel()
    seal_ctx = context.seal_context().data
    key_cd, first_cd = seal_ctx.key_context_data(), seal_ctx.first_context_data()
    n = key_cd.parms().poly_modulus_degree()
    slots = n // 2
    assert 0 < len(x) <= slots, f"vector length {len(x)} must be in 1..{slots}"
    scale = float(context.global_scale)
    t_enc = 0.0
    if enc_vector is None:
        t0 = time.perf_counter()
        enc_vector = encrypt_vector(context, x.tolist())
        t_enc = time.perf_counter() - t0
    ct = enc_vector.ciphertext()[0]
    all_primes = [m.value() for m in key_cd.parms().coeff_modulus()]
    data_primes = [m.value() for m in first_cd.parms().coeff_modulus()]
    bit_sizes = [q.bit_length() for q in all_primes]
    total_bits = key_cd.total_coeff_modulus_bit_count()

    params = {
        "source": "read from SEAL (context.seal_context(): key_context_data().parms())",
        "N": n, "slots": slots, "coeff_mod_bit_sizes": bit_sizes, "total_modulus_bits": total_bits,
        "scale": scale, "scale_bits": int(np.log2(scale)),
        "security": f"128-bit classical security per the HomomorphicEncryption.org standard: N={n} allows at most "
                    f"218 total modulus bits and this context uses {total_bits}. SEAL itself enforces this "
                    f"(sec_level=tc128) and would refuse to build the context otherwise.",
    }

    # TenSEAL's CKKSVector::encrypt calls pt.replicate(slot_count) before encoding: the vector is repeated
    # cyclically to fill all N/2 slots (NOT zero-padded). np.resize has exactly that semantics; the decrypted
    # polynomial check in `roundtrip` confirms it against the real ciphertext.
    z = np.resize(x, slots)
    nz = np.flatnonzero(x)
    slot_packing = {
        "source": "computed by Kryptamet, replicating TenSEAL's CKKSVector::encrypt (pt.replicate(slot_count)); "
                  "confirmed against the real ciphertext in the roundtrip step",
        "d": len(x), "slots": slots, "zero_padded_slots": 0,
        "replication": {"full_copies": slots // len(x), "partial_copy_len": slots % len(x),
                        "rule": "slot[j] = x[j mod d] for j = 0..N/2-1"},
        "note": "TenSEAL does not zero-pad: it repeats x cyclically across all slots so that rotations "
                "(used by sum/dot/matmul) see a periodic vector. Only x[0..d-1] is returned on decryption.",
        "nonzero": [[int(i), float(x[i])] for i in nz], "first_16_slots": z[:16].tolist(),
    }

    scaling = {
        "source": "computed by Kryptamet (Python float multiply by 2**40 is exact; Python round())",
        "delta": scale, "delta_expr": f"2**{params['scale_bits']}",
        "values": [{"index": int(i), "x": float(x[i]), "x_times_delta": float(x[i] * scale),
                    "rounded": str(round(x[i] * scale))} for i in nz],
        "note": "Per-slot rounding is shown for intuition. CKKS itself rounds only AFTER the inverse embedding "
                "(next step): the integer polynomial m(X) has coefficients round(delta * sigma^-1(z)).",
    }

    t0 = time.perf_counter()
    m_real = _inverse_embedding(z, n) * scale
    m_int = np.rint(m_real)
    m = [int(v) for v in m_int]
    embed_err = float(np.max(np.abs(_embedding(m_int, n) / scale - z)))
    assert embed_err < 1e-6, f"canonical embedding round-trip error too large: {embed_err}"

    # Cross-check against SEAL: encode the same vector with SEAL's own CKKSEncoder, undo its NTT, compare.
    pt = sealapi.Plaintext()
    sealapi.CKKSEncoder(seal_ctx).encode(z.tolist(), scale, pt)
    seal_m_mod = [_seal_intt([pt.data(i * n + j) for j in range(n)], q) for i, q in enumerate(data_primes)]
    seal_m = [_centered(v, data_primes[0]) for v in seal_m_mod[0]]
    rns_consistent = all(seal_m_mod[i][j] == seal_m[j] % q for i, q in enumerate(data_primes) for j in range(n))
    diffs = np.abs(np.array(seal_m, dtype=object) - np.array(m, dtype=object))
    max_diff, n_mismatch = int(max(diffs)), int(sum(1 for d in diffs if d != 0))

    # Prove our INTT reproduces SEAL's: SEAL's own transform_from_ntt on a copy of the real ciphertext
    # vs. our INTT of the NTT-form data (c0 mod q0).
    ct_ntt = _read_ciphertext_coeffs(context, ct)
    ct_coef_obj = enc_vector.copy().ciphertext()[0]
    sealapi.Evaluator(seal_ctx).transform_from_ntt_inplace(ct_coef_obj)
    ct_coef = _read_ciphertext_coeffs(context, ct_coef_obj)
    assert ct.is_ntt_form(), "copy() must not alias the original ciphertext"
    L = ct.coeff_modulus_size()
    q0 = data_primes[0]
    intt_ok = _seal_intt(ct_ntt[:n], q0) == ct_coef[:n]
    assert intt_ok, "Kryptamet's INTT does not reproduce SEAL's transform_from_ntt"
    t_embed = time.perf_counter() - t0

    canonical_embedding = {
        "source": "computed by Kryptamet, then verified against SEAL's CKKSEncoder output",
        "label": ("Standard CKKS encoding computed by Kryptamet: m(X) = round(delta * sigma^-1(z)) for the replicated "
                  "slot vector z, where sigma^-1 is "
                  "the inverse canonical embedding over the 2N-th roots of unity zeta = e^(i*pi/N), with slot j "
                  "evaluated at zeta^(3^j mod 2N) and its conjugate at zeta^-(3^j) (conjugate symmetry makes m "
                  "real). This slot order is SEAL's CKKSEncoder ordering (generator 3; SEAL stores it bit-reversed "
                  "internally via matrix_reps_index_map), confirmed during development with complex inputs "
                  "(conjugate ordering does not match). Verified on every call: SEAL's CKKSEncoder was run on the same vector, "
                  "its NTT-form plaintext was read and inverse-NTT'd (our INTT is itself checked against SEAL's "
                  "transform_from_ntt), and the coefficients are compared below. Evaluated with numpy FFT, O(N log N)."),
        "slot_index_generator": 3,
        "coeffs_first_256": [str(v) for v in m[:256]],
        "coeffs_all": [str(v) for v in m],
        "max_abs_coeff": str(max(abs(v) for v in m)),
        "reembed_max_abs_error": embed_err,
        "reembed_note": "max |sigma(m)/delta - z| over all N/2 slots (error from rounding to integers)",
        "seal_check": {
            "seal_coeffs_first_16": [str(v) for v in seal_m[:16]],
            "coeffs_differing_from_seal": n_mismatch, "max_abs_diff_vs_seal": max_diff,
            "seal_residues_consistent_across_primes": rns_consistent,
            "intt_matches_seal_transform_from_ntt": intt_ok,
            "matches_seal": max_diff <= 1,
            "note": "Any +-1 differences come from floating-point rounding in the two FFT implementations "
                    "(SEAL's vs numpy's) landing on opposite sides of .5; the polynomial is otherwise identical.",
        },
    }

    rns = {
        "source": "read from SEAL (key_context_data().parms().coeff_modulus()); primality and q = 1 mod 2N "
                  "re-verified by Kryptamet (deterministic Miller-Rabin)",
        "primes": [{"q": str(q), "bits": q.bit_length(), "is_prime": _is_prime(q), "one_mod_2N": q % (2 * n) == 1,
                    "role": "special (key-switching) prime" if i == len(all_primes) - 1 else "data prime"}
                   for i, q in enumerate(all_primes)],
        "data_primes": [str(q) for q in data_primes],
        "special_prime": str(all_primes[-1]),
        "m_mod_q_first_16": [{"q": str(q), "coeffs": [str(v % q) for v in m[:16]]} for q in data_primes],
        "note": "The special prime is only used inside key switching (relinearization/rotation); ciphertexts "
                "live modulo the data primes q0*q1*q2. Each coefficient is stored as its residue mod every q_i "
                "(Chinese Remainder Theorem), so every number fits in a 64-bit word.",
    }

    encryption = {
        "source": "equation from SEAL's public-key encryption (TenSEAL's default ENCRYPTION_TYPE.ASYMMETRIC, not "
                  "overridden by create_context); sizes and coefficients read from the real ciphertext",
        "equation": ["c0 = pk0*u + e0 + m  (mod q_i, for each data prime)",
                     "c1 = pk1*u + e1      (mod q_i)"],
        "details": "pk = (pk0, pk1) = (-a*s + e, a). u: random ternary polynomial (coefficients in {-1,0,1}); "
                   "e0, e1: discrete Gaussian errors, sigma ~ 3.2 (SEAL's default noise standard deviation). "
                   "TenSEAL does not expose u, e0 or e1.",
        "ciphertext_polys": ct.size(), "primes_at_level": L, "N": n, "is_ntt_form": ct.is_ntt_form(),
        "ciphertext_scale": ct.scale, "coefficients_total": ct.size() * L * n,
        "c0_mod_q0_first_8": [str(v) for v in ct_coef[:8]],
        "c1_mod_q0_first_8": [str(v) for v in ct_coef[L * n: L * n + 8]],
        "c_note": "c0, c1 coefficients (mod q0) after SEAL's transform_from_ntt; SEAL keeps them in NTT form.",
    }

    raw = enc_vector.serialize()
    off = raw.find(b"\x5e\xa1")
    magic, hsize, vmaj, vmin, compr, _, blob_size = struct.unpack_from("<HBBBBHQ", raw, off)
    theoretical = ct.size() * L * n * 8
    serialization = {
        "source": "real bytes from enc_vector.serialize(); header parsed by Kryptamet",
        "size_bytes": len(raw), "theoretical_uncompressed_bytes": theoretical,
        "theoretical_expr": f"{ct.size()} polys x {L} primes x {n} coeffs x 8 bytes",
        "ratio": len(raw) / theoretical,
        "seal_header": {"offset": off, "magic": hex(magic), "header_size": hsize, "seal_version": f"{vmaj}.{vmin}",
                        "compr_mode": _COMPR.get(compr, str(compr)), "compr_mode_code": compr,
                        "seal_blob_size": blob_size},
        "zstd_frame_magic_found": raw[off + hsize: off + hsize + 4] == b"\x28\xb5\x2f\xfd",
        "compression_note": (f"TenSEAL wraps SEAL's serialized ciphertext in a protobuf ({off} bytes before SEAL's "
                             f"0xA15E header). SEAL's header says compr_mode={_COMPR.get(compr, compr)}. Residues "
                             f"mod the 40-bit primes leave ~24 zero bits per 64-bit word, which is most of what "
                             f"compression recovers; the rest is uniformly random and incompressible."),
        "base64": base64.b64encode(raw).decode("ascii"),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }

    dec = np.array(enc_vector.decrypt())[: len(x)]
    dpt = sealapi.Plaintext()
    context.data.decryptor().decrypt(ct, dpt)
    dec_poly = [_centered(v, q0) for v in _seal_intt([dpt.data(j) for j in range(n)], q0)]
    noise = max(abs(a - b) for a, b in zip(dec_poly, seal_m))
    all_slots_err = float(np.max(np.abs(np.array(sealapi.CKKSEncoder(seal_ctx).decode_double(dpt)) - z)))
    rt_err = float(np.max(np.abs(dec - x)))
    assert rt_err < 1e-4, f"decryption round-trip error too large: {rt_err}"
    assert all_slots_err < 1e-4, f"encrypted slots do not match the replicated vector: {all_slots_err}"
    roundtrip = {
        "source": "real decryption with the context's secret key (TenSEAL decrypt + SEAL Decryptor)",
        "decrypted_first_16": dec[:16].tolist(), "max_abs_error": rt_err,
        "decrypted_poly_first_16": [str(v) for v in dec_poly[:16]],
        "max_abs_noise_coeff": noise,
        "noise_note": "c0 + c1*s = m + e (mod q0): the decrypted polynomial differs from the encoded m(X) "
                      "by the small encryption noise e; dividing by delta shrinks it to ~noise/2**40.",
        "all_slots_vs_replicated_max_abs_error": all_slots_err,
        "all_slots_note": "All N/2 decrypted slots (SEAL decode of the decrypted plaintext) vs x repeated "
                          "cyclically: confirms TenSEAL's replication, not zero-padding.",
    }

    return {
        "params": params, "slot_packing": slot_packing, "scaling": scaling,
        "canonical_embedding": canonical_embedding, "rns": rns, "encryption": encryption,
        "serialization": serialization, "roundtrip": roundtrip,
        "timings_ms": {"encryption": t_enc * 1e3, "embedding_and_seal_checks": t_embed * 1e3,
                       "total_excluding_encryption": (time.perf_counter() - t_start - t_enc) * 1e3},
    }
