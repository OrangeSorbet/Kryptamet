import cmath
import random
import numpy as np

N = 256
Q = 2 ** 40
SCALE = 2 ** 20

_M = 2 * N
_roots = [cmath.exp(2j * cmath.pi * (2 * k + 1) / _M) for k in range(N)]
_V = np.array([[_roots[j] ** k for k in range(N)] for j in range(N)], dtype=complex)
_V_inv = np.linalg.inv(_V)


def encode(vector):
    n = N // 2
    v = np.zeros(n, dtype=complex)
    v[:len(vector)] = vector
    full = np.concatenate([v, np.conj(v[::-1])])
    coeffs = _V_inv @ full
    real_coeffs = np.round(coeffs.real * SCALE).astype(np.int64)
    real_coeffs = ((real_coeffs + Q // 2) % Q) - Q // 2
    return real_coeffs.tolist()


def decode(coeffs):
    n = N // 2
    arr = np.array(coeffs, dtype=np.float64)
    vals = _V @ arr
    approx = vals.real / SCALE
    return approx[:n].tolist()


def negacyclic_mul(a, b):
    result = [0] * N
    for i in range(N):
        ai = a[i]
        if ai == 0:
            continue
        for j in range(N):
            bj = b[j]
            if bj == 0:
                continue
            idx = i + j
            prod = ai * bj
            if idx < N:
                result[idx] = (result[idx] + prod) % Q
            else:
                result[idx - N] = (result[idx - N] - prod) % Q
    return result


def ternary_poly():
    return [random.choice([-1, 0, 1]) for _ in range(N)]


def error_poly(sigma=3.2):
    return [int(round(random.gauss(0, sigma))) for _ in range(N)]


def keygen():
    s = ternary_poly()
    e = error_poly()
    a = [random.randrange(0, Q) for _ in range(N)]
    neg_a = [(-x) % Q for x in a]
    b_raw = negacyclic_mul(neg_a, s)
    b = [(b_raw[i] + e[i]) % Q for i in range(N)]
    return s, (b, a), e


def encrypt(m_coeffs, pk):
    b, a = pk
    u = ternary_poly()
    e1 = error_poly()
    e2 = error_poly()
    c0_raw = negacyclic_mul(b, u)
    c0 = [(c0_raw[i] + e1[i] + m_coeffs[i]) % Q for i in range(N)]
    c1_raw = negacyclic_mul(a, u)
    c1 = [(c1_raw[i] + e2[i]) % Q for i in range(N)]
    return c0, c1, u, e1, e2


def decrypt(c0, c1, s):
    cs = negacyclic_mul(c1, s)
    m_prime = [(c0[i] + cs[i]) % Q for i in range(N)]
    m_prime = [((x + Q // 2) % Q) - Q // 2 for x in m_prime]
    return m_prime


def run_full_deep_dive(vector):
    """Runs the entire real CKKS algorithm on a real input vector and returns
    every intermediate polynomial (as full N=256 coefficient arrays) for grid
    visualization. All values are genuinely computed, nothing is illustrative.
    """
    m_coeffs = encode(vector)
    s, (b, a), e = keygen()
    c0, c1, u, e1, e2 = encrypt(m_coeffs, (b, a))
    m_prime = decrypt(c0, c1, s)
    recovered = decode(m_prime)

    return {
        "params": {"N": N, "Q": Q, "scale": SCALE},
        "original_vector": list(vector),
        "encode": {"m_coeffs": m_coeffs},
        "keygen": {"secret_key_s": s, "error_e": e, "public_key_b": b, "public_key_a": a},
        "encrypt": {"ephemeral_u": u, "error_e1": e1, "error_e2": e2, "c0": c0, "c1": c1},
        "decrypt": {"m_prime": m_prime, "recovered_vector": recovered[:len(vector)]},
    }