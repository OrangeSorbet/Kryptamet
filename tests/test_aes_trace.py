import json
import os
import time

from cryptography.exceptions import InvalidTag

from hecrypto.aes_trace import (
    aes256_encrypt_block_traced,
    gf128_mul,
    key_expansion_traced,
    sbox_table,
    trace_aes_gcm,
)
from hecrypto.transport import _rsa_decrypt_key, generate_rsa_keypair, tamper_test, unwrap_payload, wrap_payload


def _flat(matrix):
    # column-major, same byte order as FIPS-197 hex strings
    return "".join(matrix[r][c] for c in range(4) for r in range(4))


def run_fips197_vector():
    key = bytes(range(32))
    block = bytes.fromhex("00112233445566778899aabbccddeeff")
    trace = aes256_encrypt_block_traced(key, block)

    assert trace["ciphertext_hex"] == "8ea2b7ca516745bfeafc49904b496089"
    assert _flat(trace["input_state"]) == block.hex()
    assert trace["input_state"][1][0] == "11", "state must be column-major: state[r][c] = in[r + 4c]"

    # FIPS-197 Appendix C.3 intermediate values
    r1, r2 = trace["rounds"][0], trace["rounds"][1]
    assert _flat(trace["after_initial_add_round_key"]) == "00102030405060708090a0b0c0d0e0f0"
    assert _flat(r1["start"]) == "00102030405060708090a0b0c0d0e0f0"
    assert _flat(r1["after_sub_bytes"]) == "63cab7040953d051cd60e0e7ba70e18c"
    assert _flat(r1["after_shift_rows"]) == "6353e08c0960e104cd70b751bacad0e7"
    assert _flat(r1["after_mix_columns"]) == "5f72641557f5bc92f7be3b291db9f91a"
    assert _flat(r1["round_key"]) == "101112131415161718191a1b1c1d1e1f"
    assert _flat(r2["start"]) == "4f63760643e0aa85efa7213201a4e705"
    assert _flat(r2["after_sub_bytes"]) == "84fb386f1ae1ac97df5cfd237c49946b"
    assert _flat(r2["after_shift_rows"]) == "84e1fd6b1a5c946fdf4938977cfbac23"
    assert _flat(r2["after_mix_columns"]) == "bd2a395d2b6ac438d192443e615da195"
    assert _flat(trace["rounds"][2]["start"]) == "1859fbc28a1c00a078ed8aadc42f6109"

    r14 = trace["rounds"][13]
    assert r14["after_mix_columns"] is None
    assert _flat(r14["start"]) == "627bceb9999d5aaac945ecf423f56da5"
    assert _flat(r14["round_key"]) == "24fc79ccbf0979e9371ac23c6d68de36"
    assert _flat(r14["after_add_round_key"]) == trace["ciphertext_hex"]

    ke = key_expansion_traced(key)
    assert len(ke["words"]) == 60 and len(ke["round_keys"]) == 15
    assert ke["words"][59] == "6d68de36"
    kinds = {d["i"]: d["kind"] for d in ke["derivations"]}
    assert kinds[8] == "RotWord+SubWord+Rcon" and kinds[12] == "SubWord" and 9 not in kinds

    table = sbox_table()
    assert table[0][0] == "63" and table[5][3] == "ed" and table[15][15] == "16"
    print("PASS: FIPS-197 C.3 AES-256 vector + intermediate round states + S-box")


K15 = bytes.fromhex("feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308")
IV15 = bytes.fromhex("cafebabefacedbaddecaf888")
P15 = bytes.fromhex("d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72"
                    "1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255")
C15 = bytes.fromhex("522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa"
                    "8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662898015ad")
# McGrew & Viega, "The Galois/Counter Mode of Operation", test cases 13-16 (256-bit key)
GCM_VECTORS = [
    (13, bytes(32), bytes(12), b"", b"", "dc95c078a2408989ad48a21492842087", b"",
     "530f8afbc74536b9a963b4f1c4cb738b"),
    (14, bytes(32), bytes(12), bytes(16), b"", "dc95c078a2408989ad48a21492842087",
     bytes.fromhex("cea7403d4d606b6e074ec5d3baf39d18"), "d0d1c8a799996bf0265b98b5d48ab919"),
    (15, K15, IV15, P15, b"", "acbef20579b4b8ebce889bac8732dad7", C15, "b094dac5d93471bdec1a502270e3cc6c"),
    (16, K15, IV15, P15[:60], bytes.fromhex("feedfacedeadbeeffeedfacedeadbeefabaddad2"),
     "acbef20579b4b8ebce889bac8732dad7", C15[:60], "76fc6ece0f4e1768cddf8853bb2d551b"),
]


def run_gcm_vectors():
    for tc, key, iv, pt, aad, h, ct, tag in GCM_VECTORS:
        t = trace_aes_gcm(key, iv, pt, aad=aad, n_blocks=4)
        assert t["h_hex"] == h, f"TC{tc} H"
        assert t["j0_hex"] == iv.hex() + "00000001", f"TC{tc} J0"
        assert [b["counter_hex"] for b in t["blocks"]] == [iv.hex() + f"{i + 2:08x}" for i in range(len(t["blocks"]))]
        assert bytes.fromhex("".join(b["ciphertext_hex"] for b in t["blocks"])) == ct, f"TC{tc} ciphertext"
        assert t["tag_hex"] == tag and t["tag_source"] == "python_ghash_full", f"TC{tc} tag"
        assert t["keystream1_rounds"]["ciphertext_hex"] == aes256_encrypt_block_traced(key, iv + (2).to_bytes(4, "big"))["ciphertext_hex"]
        assert t["ghash"]["aad_blocks"] == -(-len(aad) // 16) and t["ghash"]["steps"][-1]["source"] == "length"
        assert t["ghash"]["steps"][-1]["x_hex"] == t["ghash"]["s_hex"]
        assert all(t["verified"].values())
        json.dumps(t)
    # GF(2^128): 1 (MSB of the block) is the multiplicative identity
    one = 1 << 127
    assert gf128_mul(one, 0x1234) == 0x1234 and gf128_mul(0xABC, one) == 0xABC
    print("PASS: McGrew-Viega GCM test cases 13-16 (AES-256, incl. AAD case 16): H, counters, C, tag")


def run_gcm_trace_vs_transport():
    private_key, public_key = generate_rsa_keypair()
    payload = os.urandom(331 * 1024 + 7)
    aad = b"kryptamet|test|a->b"
    wrapped = wrap_payload(public_key, payload, aad=aad)
    aes_key = _rsa_decrypt_key(private_key, wrapped["encrypted_key"])
    assert len(wrapped["nonce"]) == 12 and len(wrapped["tag"]) == 16 and len(wrapped["ciphertext"]) == len(payload)
    assert unwrap_payload(private_key, wrapped) == payload

    start = time.perf_counter()
    trace = trace_aes_gcm(aes_key, wrapped["nonce"], payload, aad=aad, n_blocks=3)
    elapsed = time.perf_counter() - start
    assert bytes.fromhex(trace["ciphertext_head_hex"]) == wrapped["ciphertext"][:48]
    assert trace["tag_hex"] == wrapped["tag"].hex(), "Python GHASH tag differs from transport tag"
    assert trace["ghash"]["ciphertext_blocks"] == -(-len(payload) // 16)
    assert all(trace["verified"].values())

    for bad in ({"aad": b"kryptamet|test|b->a"}, {"nonce": bytes(12)}):
        try:
            unwrap_payload(private_key, {**wrapped, **bad})
        except InvalidTag:
            continue
        raise AssertionError(f"tampered {list(bad)} accepted")
    tt = tamper_test(private_key, wrapped)
    assert tt["rejected"] and tt["tag_flip"]["rejected"] and tt["error"] == "InvalidTag"
    assert int(tt["byte_before"], 16) ^ int(tt["byte_after"], 16) == 1 << tt["bit"]
    assert tamper_test(aes_key, wrapped)["rejected"]
    print(f"PASS: GCM trace of {len(payload)} B transport payload matches wrap_payload ciphertext + tag "
          f"({trace['ghash']['multiplications']} GHASH mults in {trace['ghash']['elapsed_ms']:.0f} ms, "
          f"whole trace {elapsed * 1000:.0f} ms); tamper: ciphertext byte {tt['flipped_byte_index']} bit {tt['bit']} "
          f"{tt['byte_before']}->{tt['byte_after']} rejected, tag byte {tt['tag_flip']['flipped_byte_index']} "
          f"bit {tt['tag_flip']['bit']} rejected, altered aad/nonce rejected")


def main():
    run_fips197_vector()
    run_gcm_vectors()
    run_gcm_trace_vs_transport()


if __name__ == "__main__":
    main()
