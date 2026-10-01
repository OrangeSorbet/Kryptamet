"""From-scratch educational CKKS: every polynomial TenSEAL hides, computed for real.

Ring R_Q = Z_Q[X]/(X^N + 1), N = 256 (128 complex slots), one modulus Q = 2**60,
no rescaling. A ciphertext is a pair (c0, c1) with c0 + c1*s ~= Delta * m.

Polynomials are numpy uint64 arrays holding coefficients mod Q. Q is a power of
two (as in the original HEAAN), so uint64 wrap-around (mod 2**64) followed by
masking to 60 bits is exact mod Q -- np.convolve on uint64 gives exact
negacyclic products with no floats and no Python-int loops.
"""
import numpy as np

N = 256
SLOTS = N // 2
Q = 2 ** 60
# Delta = 2**25: after ct x pt the scale is Delta^2 = 2**50, leaving |slot values| < 2**9 = 512
# before wrap-around mod Q. Delta = 2**20 kept fresh noise * ||w|| near 1e-2 on real models;
# 2**25 brings it to ~1e-4.
SCALE = 2 ** 25
BASE_BITS = 15                      # gadget base 2**15 for key switching
DIGITS = 60 // BASE_BITS            # 4 digits cover a 60-bit coefficient
ROTATION_STEPS = (64, 32, 16, 8, 4, 2, 1)

_MASK = np.uint64(Q - 1)
_rng = np.random.default_rng()

# Slot j sits at the root zeta^(5^j) (zeta = e^(i*pi/N), a primitive 2N-th root);
# its conjugate at zeta^(-5^j). These 256 exponents are exactly the odd residues
# mod 2N, i.e. all roots of X^N + 1. With this ordering the automorphism
# X -> X^(5^k) moves slot j+k into slot j: a cyclic rotation by k.
_EXPS = [pow(5, j, 2 * N) for j in range(SLOTS)]
_EXPS += [(-p) % (2 * N) for p in _EXPS]
_V = np.exp(1j * np.pi * ((np.outer(_EXPS, np.arange(N)) % (2 * N)) / N))  # V[r, i] = root_r ** i


def _ring(poly):
    return np.asarray(poly).astype(np.uint64) & _MASK


def centered(poly):
    """Coefficients mod Q as signed ints in (-Q/2, Q/2]."""
    v = _ring(poly).astype(np.int64)
    return np.where(v > Q // 2, v - Q, v)


def encode(vec, scale=SCALE):
    z = np.zeros(SLOTS, dtype=complex)
    z[:len(vec)] = vec
    # The roots are orthogonal (V^H V = N*I), so V^-1 = V^H / N.
    coeffs = (_V.conj().T @ np.concatenate([z, z.conj()])).real / N
    return _ring(np.rint(coeffs * scale).astype(np.int64))


def decode(coeffs, scale=SCALE):
    return (_V[:SLOTS] @ centered(coeffs).astype(np.float64)).real / scale


def negacyclic_mul(a, b):
    full = np.append(np.convolve(_ring(a), _ring(b)), np.uint64(0))  # length 2N
    return (full[:N] - full[N:]) & _MASK                              # X^N = -1


def _ternary():
    return _ring(_rng.integers(-1, 2, N))


def _gauss(sigma=3.2):
    return _ring(np.rint(_rng.normal(0, sigma, N)).astype(np.int64))


def _uniform():
    return _rng.integers(0, Q, N, dtype=np.uint64)


def keygen():
    s, e, a = _ternary(), _gauss(), _uniform()
    b = (e - negacyclic_mul(a, s)) & _MASK
    return s, (b, a), e


def apply_galois(poly, g):
    """X -> X^g (g odd). Index i*g mod 2N; landing past N wraps with a sign flip."""
    p = _ring(poly)
    idx = (np.arange(N) * g) % (2 * N)
    out = np.zeros(N, dtype=np.uint64)
    lo = idx < N
    out[idx[lo]] = p[lo]
    out[idx[~lo] - N] = (np.uint64(Q) - p[~lo]) & _MASK
    return out


def gen_galois_keys(s, steps=ROTATION_STEPS):
    """BV key-switching keys from sigma_k(s) back to s: one (b_i, a_i) per gadget digit,
    b_i = -a_i*s + e_i + 2^(15i) * sigma_k(s)."""
    keys = {}
    for k in steps:
        s_rot = apply_galois(s, pow(5, k, 2 * N))
        keys[k] = []
        for i in range(DIGITS):
            a = _uniform()
            b = (_gauss() - negacyclic_mul(a, s) + s_rot * np.uint64(1 << (BASE_BITS * i))) & _MASK
            keys[k].append((b, a))
    return keys


def encrypt(m, pk):
    b, a = pk
    u, e1, e2 = _ternary(), _gauss(), _gauss()
    c0 = (negacyclic_mul(b, u) + e1 + _ring(m)) & _MASK
    c1 = (negacyclic_mul(a, u) + e2) & _MASK
    return (c0, c1), u, e1, e2


def decrypt(ct, s):
    return (ct[0] + negacyclic_mul(ct[1], s)) & _MASK


def add(x, y):
    return (x[0] + y[0]) & _MASK, (x[1] + y[1]) & _MASK


def add_plain(ct, pt):
    return (ct[0] + _ring(pt)) & _MASK, ct[1]


def mul_plain(ct, pt):
    return negacyclic_mul(ct[0], pt), negacyclic_mul(ct[1], pt)


def rotate(ct, steps, galois_keys):
    """Slot j <- slot j+steps. Apply X -> X^(5^steps) to both parts, then key-switch
    sigma(c1) (which now pairs with sigma(s)) back to s via its base-2^15 digits."""
    g = pow(5, steps, 2 * N)
    c0, c1 = apply_galois(ct[0], g), apply_galois(ct[1], g)
    out1 = np.zeros(N, dtype=np.uint64)
    for i, (kb, ka) in enumerate(galois_keys[steps]):
        digit = (c1 >> np.uint64(BASE_BITS * i)) & np.uint64((1 << BASE_BITS) - 1)
        c0 = c0 + negacyclic_mul(digit, kb)
        out1 = out1 + negacyclic_mul(digit, ka)
    return c0 & _MASK, out1 & _MASK


def _str(poly):
    """Centered coefficients as decimal strings: they reach 2**59, past JS's 2**53 safe-int range."""
    return [str(v) for v in centered(poly).tolist()]


def _ct_json(ct):
    return {"c0": _str(ct[0]), "c1": _str(ct[1])}


def run_full_deep_dive(x, w, b):
    """Encrypted linear score w.x + b: encode -> keygen -> encrypt -> evaluate -> decrypt -> decode.
    Returns every intermediate polynomial (full N-length, centered, as strings) for visualisation.
    Encode/encrypt/multiply are shown for one chunk: the one holding the most non-zero x values."""
    x, w, b = np.asarray(x, dtype=float), np.asarray(w, dtype=float), float(b)
    n_chunks = max(1, -(-len(x) // SLOTS))
    shown = int(np.argmax([np.count_nonzero(x[c * SLOTS:(c + 1) * SLOTS]) for c in range(n_chunks)]))
    s, pk, e = keygen()
    galois_keys = gen_galois_keys(s)

    for c in range(n_chunks):
        chunk = slice(c * SLOTS, (c + 1) * SLOTS)
        m, w_pt = encode(x[chunk]), encode(w[chunk])
        ct, u, e1, e2 = encrypt(m, pk)
        prod = mul_plain(ct, w_pt)                      # scale Delta^2, slot i = x_i * w_i
        if c == shown:
            first = {"m": m, "w": w_pt, "ct": ct, "u": u, "e1": e1, "e2": e2, "prod": prod}
        acc = prod if c == 0 else add(acc, prod)
    chunk_sum = acc

    rotations = []
    for step in ROTATION_STEPS:                         # after all 7 rounds every slot holds the full sum
        acc = add(acc, rotate(acc, step, galois_keys))
        rotations.append({"step": step, "galois": pow(5, step, 2 * N), **_ct_json(acc)})

    # Bias goes into every slot (a constant polynomial b*Delta^2), matching the Delta^2 scale.
    bias_pt = encode(np.full(SLOTS, b), SCALE ** 2)
    result_ct = add_plain(acc, bias_pt)
    m_prime = decrypt(result_ct, s)
    slots = decode(m_prime, SCALE ** 2)
    score = float(slots[0])
    plaintext_score = float(np.dot(w, x) + b)

    return {
        "params": {"N": N, "Q": str(Q), "scale": SCALE, "slots": SLOTS, "n_chunks": n_chunks,
                   "shown_chunk": shown, "decomposition_base": 2 ** BASE_BITS, "digits": DIGITS},
        "original_vector": x.tolist(),
        "weights": w.tolist(),
        "bias": b,
        "encode": {"m_coeffs": _str(first["m"]), "w_coeffs": _str(first["w"])},
        "keygen": {"secret_key_s": _str(s), "error_e": _str(e),
                   "public_key_b": _str(pk[0]), "public_key_a": _str(pk[1])},
        "encrypt": {"ephemeral_u": _str(first["u"]), "error_e1": _str(first["e1"]),
                    "error_e2": _str(first["e2"]), **_ct_json(first["ct"])},
        "evaluate": {"mul_plain": _ct_json(first["prod"]), "chunk_sum": _ct_json(chunk_sum),
                     "rotations": rotations, "bias_pt": _str(bias_pt), "add_bias": _ct_json(result_ct)},
        "decrypt": {"m_prime": _str(m_prime),
                    # fresh decrypt of the shown chunk's ciphertext (before evaluation), all slots
                    "recovered_vector": decode(decrypt(first["ct"], s)).tolist()},
        "decode": {"slots": slots[:8].tolist(), "score": score, "plaintext_score": plaintext_score,
                   "abs_error": abs(score - plaintext_score)},
    }
