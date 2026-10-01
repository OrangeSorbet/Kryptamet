import pickle
import time

import numpy as np

from data.features import text_stylometric
from hecrypto import ckks_math as C

rng = np.random.default_rng()


def _slots(n=C.SLOTS):
    return rng.normal(0, 3, n)


def test_negacyclic_exact():
    a, b = C._uniform(), C._uniform()
    ref = [0] * C.N
    for i, ai in enumerate(int(v) for v in a):
        for j, bj in enumerate(int(v) for v in b):
            k = i + j
            ref[k % C.N] += ai * bj if k < C.N else -ai * bj
    assert [r % C.Q for r in ref] == [int(v) for v in C.negacyclic_mul(a, b)]
    print("PASS: negacyclic_mul exact mod Q vs pure-Python reference")


def test_encode_decode():
    z = _slots()
    err = np.abs(C.decode(C.encode(z)) - z).max()
    assert err < 1e-4, err
    print(f"PASS: encode/decode round-trip, max err {err:.2e}")


def test_encrypt_decrypt():
    s, pk, _ = C.keygen()
    z = _slots()
    ct, *_ = C.encrypt(C.encode(z), pk)
    err = np.abs(C.decode(C.decrypt(ct, s)) - z).max()
    assert err < 1e-4, err
    print(f"PASS: encrypt/decrypt round-trip, max err {err:.2e}")


def test_rotate():
    s, pk, _ = C.keygen()
    gk = C.gen_galois_keys(s)
    z = _slots()
    # Encrypt at Delta^2, the scale rotations run at in the pipeline: base-2^15 key-switch
    # noise (~2^24 per slot) would swamp a Delta = 2^25 message but is invisible at 2^50.
    ct, *_ = C.encrypt(C.encode(z, C.SCALE ** 2), pk)
    for k in C.ROTATION_STEPS:
        got = C.decode(C.decrypt(C.rotate(ct, k, gk), s), C.SCALE ** 2)
        err = np.abs(got - np.roll(z, -k)).max()
        assert err < 1e-3, (k, err)
    print(f"PASS: rotate by {C.ROTATION_STEPS} shifts slots cyclically (slot j <- slot j+k)")


def test_mul_plain():
    s, pk, _ = C.keygen()
    x, w = _slots(), _slots()
    ct, *_ = C.encrypt(C.encode(x), pk)
    got = C.decode(C.decrypt(C.mul_plain(ct, C.encode(w)), s), C.SCALE ** 2)
    err = np.abs(got - x * w).max()
    assert err < 1e-2, err
    print(f"PASS: mul_plain is elementwise product, max err {err:.2e}")


def _check_deep_dive(label, x, w, b, expected, tol=5e-3):
    t = time.perf_counter()
    r = C.run_full_deep_dive(x, w, b)
    dt = time.perf_counter() - t
    d = r["decode"]
    assert abs(d["score"] - expected) < tol, (label, d["score"], expected)
    assert abs(d["plaintext_score"] - expected) < 1e-6
    assert len(r["evaluate"]["rotations"]) == 7
    assert all(len(p) == C.N for p in (r["encrypt"]["c0"], r["keygen"]["secret_key_s"], r["decrypt"]["m_prime"]))
    assert len(r["decrypt"]["recovered_vector"]) == C.SLOTS
    assert all(isinstance(v, str) for v in r["encrypt"]["c0"])  # exact past 2**53
    print(f"PASS: {label}: score {d['score']:.6f} vs plaintext {expected:.6f}, "
          f"abs err {abs(d['score'] - expected):.2e}, {dt * 1000:.0f} ms, {r['params']['n_chunks']} chunk(s)")


def test_deep_dive_random():
    for d in (8, 500):
        x, w, b = rng.normal(0, 1, d), rng.normal(0, 1, d), float(rng.normal(0, 3))
        _check_deep_dive(f"random d={d}", x, w, b, float(np.dot(w, x) + b))


def test_deep_dive_real_models():
    text = "Congratulations! You have won a free prize. Call now to claim your reward before it expires."
    for name in ("human_vs_ai_text", "sms_spam"):
        with open(f"models/saved/{name}_logreg.pkl", "rb") as f:
            bundle = pickle.load(f)
        model = bundle["model"]
        if name == "human_vs_ai_text":
            x = text_stylometric.extract([text])[0]
        else:
            x = bundle["vectorizer"].transform([text]).toarray()[0]
        expected = float(model.decision_function([x])[0])
        _check_deep_dive(f"{name} (d={len(x)})", x, model.coef_[0], model.intercept_[0], expected)


def main():
    test_negacyclic_exact()
    test_encode_decode()
    test_encrypt_decrypt()
    test_rotate()
    test_mul_plain()
    test_deep_dive_random()
    test_deep_dive_real_models()


if __name__ == "__main__":
    main()
