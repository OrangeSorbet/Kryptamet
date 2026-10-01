import base64
import hashlib
import json
import time

import numpy as np

from hecrypto.ckks_context import create_context
from hecrypto.ckks_encode_trace import _is_prime, trace_ckks_encryption
from hecrypto.encrypt import encrypt_vector
from interface.app import CKKS_PARAMS


def check_trace(context, x, label):
    t0 = time.perf_counter()
    enc = encrypt_vector(context, x.tolist())
    t_enc = time.perf_counter() - t0
    t0 = time.perf_counter()
    tr = trace_ckks_encryption(context, x, enc)
    t_trace = time.perf_counter() - t0
    json.dumps(tr)
    n = tr["params"]["N"]

    ce = tr["canonical_embedding"]
    assert ce["reembed_max_abs_error"] < 1e-6, ce["reembed_max_abs_error"]
    assert len(ce["coeffs_all"]) == n and ce["coeffs_first_256"] == ce["coeffs_all"][:256]
    sc = ce["seal_check"]
    assert sc["matches_seal"] and sc["intt_matches_seal_transform_from_ntt"] and sc["seal_residues_consistent_across_primes"], sc
    print(f"PASS [{label}] embedding error {ce['reembed_max_abs_error']:.2e}; m(X) vs SEAL: "
          f"{sc['coeffs_differing_from_seal']} coeffs differ (max {sc['max_abs_diff_vs_seal']})")

    delta = tr["scaling"]["delta"]
    nz = np.flatnonzero(x)
    assert [v["index"] for v in tr["scaling"]["values"]] == nz.tolist()
    for v in tr["scaling"]["values"]:
        assert v["rounded"] == str(round(x[v["index"]] * delta))
    assert tr["slot_packing"]["first_16_slots"] == np.resize(x, n // 2)[:16].tolist()
    print(f"PASS [{label}] {len(nz)} scaled values equal Python round(x*2**40)")

    bits = CKKS_PARAMS["coeff_mod_bit_sizes"]
    primes = tr["rns"]["primes"]
    assert [p["bits"] for p in primes] == bits
    for p in primes:
        q = int(p["q"])
        assert _is_prime(q) and p["is_prime"] and q % (2 * n) == 1 and q.bit_length() == p["bits"], p
    assert primes[-1]["role"].startswith("special") and len(tr["rns"]["data_primes"]) == len(bits) - 1
    print(f"PASS [{label}] {len(primes)} primes prime, = 1 mod {2 * n}, bit sizes {bits}")

    ser = tr["serialization"]
    raw = enc.serialize()
    assert base64.b64decode(ser["base64"]) == raw and ser["size_bytes"] == len(raw)
    assert ser["sha256"] == hashlib.sha256(raw).hexdigest()
    assert ser["seal_header"]["magic"] == "0xa15e"
    print(f"PASS [{label}] base64 decodes to serialize() ({len(raw)} B, compr={ser['seal_header']['compr_mode']}, "
          f"zstd frame={ser['zstd_frame_magic_found']}), sha256 ok")

    rt = tr["roundtrip"]
    assert rt["max_abs_error"] < 1e-4 and rt["all_slots_vs_replicated_max_abs_error"] < 1e-4
    assert rt["max_abs_noise_coeff"] < 2 ** 20, rt["max_abs_noise_coeff"]
    print(f"PASS [{label}] roundtrip error {rt['max_abs_error']:.2e}, max noise coeff {rt['max_abs_noise_coeff']}")
    print(f"      timings: encrypt {t_enc * 1e3:.0f} ms, trace {t_trace * 1e3:.0f} ms")


def main():
    context = create_context(**CKKS_PARAMS)
    rng = np.random.default_rng(7)
    check_trace(context, rng.normal(size=8), "dense d=8")
    sparse = np.zeros(500)
    sparse[rng.choice(500, 12, replace=False)] = rng.uniform(-3, 3, 12)
    check_trace(context, sparse, "sparse d=500")


if __name__ == "__main__":
    main()
