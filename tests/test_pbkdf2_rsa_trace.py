import hashlib
import json
import os

from cryptography.exceptions import InvalidTag

from hecrypto.pbkdf2_trace import sha256_traced, trace_pbkdf2
from hecrypto.rsa_trace import trace_rsa_keypair
from hecrypto.transport import (
    generate_rsa_keypair,
    wrap_payload_traced,
    unwrap_payload_traced,
    wrap_with_passphrase,
    unwrap_with_passphrase,
)


def test_sha256_traced():
    for msg in (b"", b"abc", bytes(range(256))[:130]):
        trace = sha256_traced(msg)
        assert trace["digest_hex"] == hashlib.sha256(msg).hexdigest(), f"sha256 mismatch for {len(msg)}-byte msg"
        assert all(len(b["schedule"]) == 64 and len(b["rounds"]) == 64 for b in trace["blocks"])
    assert len(sha256_traced(bytes(130))["blocks"]) == 3, "130-byte message should span 3 blocks"
    print("PASS: sha256_traced matches hashlib on empty, 'abc', 3-block message")


def test_pbkdf2():
    salt = os.urandom(16)
    for passphrase in ("correct horse", "x" * 100):
        trace = trace_pbkdf2(passphrase, salt, iterations=1000)
        expected = hashlib.pbkdf2_hmac("sha256", passphrase.encode(), salt, 1000, 32).hex()
        assert trace["derived_key_hex"] == expected, "derived key mismatch"
        assert trace["u_chain"][-1]["i"] == 1000
        assert trace["u_chain"][-1]["T_after_i"] == trace["derived_key_hex"], "final T != derived key"
        assert trace["hmac_key"]["hashed_because_longer_than_64"] == (len(passphrase) > 64)
        assert len(trace["inner_sha256_trace"]["blocks"]) == 2
        json.dumps(trace)
    print("PASS: trace_pbkdf2 matches hashlib for short and >64-byte passphrases; final T == derived key")


def test_rsa_trace():
    private_key, _ = generate_rsa_keypair(2048)
    trace = trace_rsa_keypair(private_key, "server")
    assert all(trace["checks"].values())
    assert trace["bit_lengths"]["n"] == 2048
    json.dumps(trace)
    print(f"PASS: rsa trace checks pass for fresh 2048-bit key (d < lambda: {trace['d_less_than_lambda']})")


def test_wrap_traced_roundtrip():
    private_key, public_key = generate_rsa_keypair()
    payload = os.urandom(1000)
    aes_key = os.urandom(32)
    wrapped = wrap_payload_traced(public_key, payload, aes_key=aes_key, aad=b"hdr")
    assert wrapped["aes_key_hex"] == aes_key.hex()
    assert wrapped["nonce_size"] == 12 and wrapped["tag_size"] == 16 and wrapped["aes_ciphertext_size"] == len(payload)
    assert wrapped["tag_hex"] == wrapped["tag"].hex() and wrapped["aad_utf8"] == "hdr" and wrapped["aad_hex"] == "686472"
    assert not any(k.startswith("iv") or "padding" in k or "preview" in k for k in wrapped)
    recovered, trace = unwrap_payload_traced(private_key, wrapped)
    assert recovered == payload
    assert trace["aes_key_hex"] == aes_key.hex() and trace["tag_verified"]
    assert trace["payload_sha256"] == wrapped["payload_sha256"]
    assert wrap_payload_traced(public_key, payload, aes_key=aes_key)["nonce"] != wrapped["nonce"], "nonce reused"
    print("PASS: wrap_payload_traced (AES-256-GCM) with supplied AES key round-trips; payload hashes match")


def test_passphrase_roundtrip():
    payload = b"ciphertext bytes"
    w1 = wrap_with_passphrase("hunter2", payload)
    w2 = wrap_with_passphrase("hunter2", payload)
    assert unwrap_with_passphrase("hunter2", w1) == payload
    assert w1["salt"] != w2["salt"], "two wraps reused a salt"
    assert len(w1["tag"]) == 16 and len(w1["nonce"]) == 12
    try:
        unwrap_with_passphrase("hunter3", w1)
    except InvalidTag:
        pass
    else:
        raise AssertionError("wrong passphrase was not rejected")
    print("PASS: passphrase GCM wrap/unwrap round-trips with random per-wrap salt; wrong passphrase -> InvalidTag")


def main():
    test_sha256_traced()
    test_pbkdf2()
    test_rsa_trace()
    test_wrap_traced_roundtrip()
    test_passphrase_roundtrip()


if __name__ == "__main__":
    main()
