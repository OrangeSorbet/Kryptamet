import hashlib
import hmac

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]
_H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
_M32 = 0xFFFFFFFF
IPAD = 0x36
OPAD = 0x5C


def _check(ok, what):
    if not ok:
        raise RuntimeError(f"trace verification failed: {what}")
    return True


def _rotr(x, n):
    return ((x >> n) | (x << (32 - n))) & _M32


def _hex_words(words):
    return [f"{w:08x}" for w in words]


def sha256_traced(message: bytes) -> dict:
    """Pure-Python SHA-256 (FIPS 180-4) recording every compression block's
    message schedule and the a..h working variables after each of the 64 rounds.
    Raises if the result differs from hashlib.sha256."""
    bit_len = len(message) * 8
    padded = message + b"\x80" + b"\x00" * ((55 - len(message)) % 64) + bit_len.to_bytes(8, "big")
    H = list(_H0)
    blocks = []
    for b in range(len(padded) // 64):
        chunk = padded[b * 64:(b + 1) * 64]
        W = [int.from_bytes(chunk[i * 4:i * 4 + 4], "big") for i in range(16)]
        for t in range(16, 64):
            s0 = _rotr(W[t - 15], 7) ^ _rotr(W[t - 15], 18) ^ (W[t - 15] >> 3)
            s1 = _rotr(W[t - 2], 17) ^ _rotr(W[t - 2], 19) ^ (W[t - 2] >> 10)
            W.append((W[t - 16] + s0 + W[t - 7] + s1) & _M32)
        a, b_, c, d, e, f, g, h = H
        rounds = []
        for t in range(64):
            S1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25)
            ch = (e & f) ^ (~e & g)
            t1 = (h + S1 + ch + _K[t] + W[t]) & _M32
            S0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22)
            maj = (a & b_) ^ (a & c) ^ (b_ & c)
            t2 = (S0 + maj) & _M32
            h, g, f, e, d, c, b_, a = g, f, e, (d + t1) & _M32, c, b_, a, (t1 + t2) & _M32
            rounds.append(_hex_words([a, b_, c, d, e, f, g, h]))
        H_before = H
        H = [(x + y) & _M32 for x, y in zip(H, [a, b_, c, d, e, f, g, h])]
        blocks.append({
            "index": b,
            "block_hex": chunk.hex(),
            "words": _hex_words(W[:16]),
            "schedule": _hex_words(W),
            "rounds": rounds,
            "H_before": _hex_words(H_before),
            "H_after": _hex_words(H),
        })
    digest = b"".join(x.to_bytes(4, "big") for x in H)
    return {
        "message_hex": message.hex(),
        "message_bit_length": bit_len,
        "padded_hex": padded.hex(),
        "initial_H": _hex_words(_H0),
        "blocks": blocks,
        "digest_hex": digest.hex(),
        "verified_against_hashlib": _check(digest == hashlib.sha256(message).digest(), "sha256_traced vs hashlib"),
    }


def trace_pbkdf2(passphrase: str, salt: bytes, iterations=200_000, dklen=32) -> dict:
    """PBKDF2-HMAC-SHA256, single output block (dklen <= 32, block index i=1):
    HMAC key prep, fully traced SHA-256 of U1's inner hash, sampled U-chain, and
    the derived key cross-checked against hashlib and cryptography."""
    if not 1 <= dklen <= 32:
        raise ValueError("trace_pbkdf2 traces a single SHA-256 block: dklen must be 1..32")
    P = passphrase.encode("utf-8")
    K = hashlib.sha256(P).digest() if len(P) > 64 else P
    K = K.ljust(64, b"\x00")
    k_ipad = bytes(x ^ IPAD for x in K)
    k_opad = bytes(x ^ OPAD for x in K)
    block_index = (1).to_bytes(4, "big")

    inner_message = k_ipad + salt + block_index
    inner_trace = sha256_traced(inner_message)
    inner_digest = hashlib.sha256(inner_message).digest()
    outer_digest = hashlib.sha256(k_opad + inner_digest).digest()
    u1_hmac = hmac.new(P, salt + block_index, hashlib.sha256).digest()

    # HMAC(P, m) = SHA256(K^opad || SHA256(K^ipad || m)); pre-absorb the key halves once.
    inner_ctx = hashlib.sha256(k_ipad)
    outer_ctx = hashlib.sha256(k_opad)
    u = u1_hmac
    T = int.from_bytes(u, "big")
    samples = []
    for i in range(1, iterations + 1):
        if i > 1:
            ih = inner_ctx.copy()
            ih.update(u)
            oh = outer_ctx.copy()
            oh.update(ih.digest())
            u = oh.digest()
            T ^= int.from_bytes(u, "big")
        if i <= 5 or i % 20_000 == 0 or i == iterations:
            samples.append({"i": i, "U_i": u.hex(), "T_after_i": T.to_bytes(32, "big").hex()})

    derived = T.to_bytes(32, "big")[:dklen]
    ref_hashlib = hashlib.pbkdf2_hmac("sha256", P, salt, iterations, dklen)
    ref_crypto = PBKDF2HMAC(algorithm=hashes.SHA256(), length=dklen, salt=salt, iterations=iterations).derive(P)

    return {
        "passphrase": passphrase,
        "passphrase_hex": P.hex(),
        "salt_hex": salt.hex(),
        "iterations": iterations,
        "dklen": dklen,
        "hmac_key": {
            "passphrase_len": len(P),
            "hashed_because_longer_than_64": len(P) > 64,
            "K_hex": K.hex(),
            "ipad": f"0x{IPAD:02x}",
            "opad": f"0x{OPAD:02x}",
            "K_xor_ipad_hex": k_ipad.hex(),
            "K_xor_opad_hex": k_opad.hex(),
        },
        "u1": {
            "hmac_message_hex": (salt + block_index).hex(),
            "inner_input": "SHA-256((K XOR ipad) || salt || INT_32_BE(1))",
            "inner_input_hex": inner_message.hex(),
            "inner_digest_hex": inner_digest.hex(),
            "outer_input": "SHA-256((K XOR opad) || inner_digest)",
            "outer_digest_hex": outer_digest.hex(),
            "verified_inner_trace": _check(inner_trace["digest_hex"] == inner_digest.hex(), "traced inner hash"),
            "verified_against_hmac": _check(outer_digest == u1_hmac, "U1 vs hmac.new"),
        },
        "inner_sha256_trace": inner_trace,
        "u_chain": samples,
        "derived_key_hex": derived.hex(),
        "verified_hashlib_pbkdf2": _check(derived == ref_hashlib, "derived key vs hashlib.pbkdf2_hmac"),
        "verified_cryptography_pbkdf2": _check(derived == ref_crypto, "derived key vs cryptography PBKDF2HMAC"),
    }
