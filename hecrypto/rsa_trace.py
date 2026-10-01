import hashlib
import math

from cryptography.hazmat.primitives import serialization


def _check(ok, what):
    if not ok:
        raise RuntimeError(f"RSA trace verification failed: {what}")
    return True


def trace_rsa_keypair(private_key, label: str) -> dict:
    """Expose the real numbers inside a `cryptography` RSA private key (big ints
    as decimal strings) and verify the RSA identities that make it work."""
    priv = private_key.private_numbers()
    pub = priv.public_numbers
    p, q, n, e, d = priv.p, priv.q, pub.n, pub.e, priv.d
    phi = (p - 1) * (q - 1)
    lam = math.lcm(p - 1, q - 1)
    der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return {
        "label": label,
        "key_size": private_key.key_size,
        "p": str(p),
        "q": str(q),
        "n": str(n),
        "e": str(e),
        "d": str(d),
        "phi": str(phi),
        "lambda": str(lam),
        "dmp1": str(priv.dmp1),
        "dmq1": str(priv.dmq1),
        "iqmp": str(priv.iqmp),
        "bit_lengths": {
            "p": p.bit_length(), "q": q.bit_length(), "n": n.bit_length(),
            "e": e.bit_length(), "d": d.bit_length(), "phi": phi.bit_length(), "lambda": lam.bit_length(),
        },
        "d_less_than_lambda": d < lam,
        "public_key_der_sha256": hashlib.sha256(der).hexdigest(),
        "checks": {
            "n_equals_p_times_q": _check(n == p * q, "n == p*q"),
            "gcd_e_lambda_is_1": _check(math.gcd(e, lam) == 1, "gcd(e, lambda) == 1"),
            "e_d_congruent_1_mod_lambda": _check((e * d) % lam == 1, "e*d = 1 mod lambda"),
            "dmp1_is_d_mod_p_minus_1": _check(priv.dmp1 == d % (p - 1), "dmp1 == d mod (p-1)"),
            "dmq1_is_d_mod_q_minus_1": _check(priv.dmq1 == d % (q - 1), "dmq1 == d mod (q-1)"),
            "iqmp_is_q_inverse_mod_p": _check((priv.iqmp * q) % p == 1, "iqmp*q = 1 mod p"),
        },
    }
