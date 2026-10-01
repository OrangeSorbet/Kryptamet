"""Pure-Python AES-256 (FIPS-197) with a round-by-round trace of the 4x4 state
matrix, plus AES-256-GCM (NIST SP 800-38D) counter mode and GHASH, used by the
/live UI to show the exact AES-256-GCM computation hecrypto/transport.py performs.
Every traced result is asserted equal to the `cryptography` library's output, so
the trace is provably the real computation."""
import time

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _gf_mul(a, b):
    result = 0
    while b:
        if b & 1:
            result ^= a
        a = ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1
        b >>= 1
    return result


def _gf_inverse(a):
    # a^254 = a^-1 in GF(2^8); 0 maps to 0 by FIPS-197 convention
    result = 1
    for _ in range(254):
        result = _gf_mul(result, a)
    return result if a else 0


def _build_sbox():
    sbox = []
    for x in range(256):
        b = _gf_inverse(x)
        s = b
        for shift in range(1, 5):
            s ^= ((b << shift) | (b >> (8 - shift))) & 0xFF
        sbox.append(s ^ 0x63)
    return sbox


SBOX = _build_sbox()
assert SBOX[0x00] == 0x63 and SBOX[0x53] == 0xED and SBOX[0x01] == 0x7C and SBOX[0xFF] == 0x16, \
    "computed S-box does not match FIPS-197"

RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36]


def sbox_table():
    """S-box as a 16x16 table of 2-char hex strings: row = high nibble, col = low nibble."""
    return [[f"{SBOX[16 * r + c]:02x}" for c in range(16)] for r in range(16)]


def _word_hex(word):
    return bytes(word).hex()


def _matrix_hex(state):
    return [[f"{state[r][c]:02x}" for c in range(4)] for r in range(4)]


def _words_to_matrix(words):
    # word c is column c of the matrix
    return [[words[c][r] for c in range(4)] for r in range(4)]


def _expand_key(key):
    words = [list(key[4 * i:4 * i + 4]) for i in range(8)]
    notes = {}
    for i in range(8, 60):
        temp = list(words[i - 1])
        if i % 8 == 0:
            rotated = temp[1:] + temp[:1]
            subbed = [SBOX[b] for b in rotated]
            rcon = RCON[i // 8 - 1]
            temp = [subbed[0] ^ rcon] + subbed[1:]
            notes[i] = {
                "i": i,
                "kind": "RotWord+SubWord+Rcon",
                "prev": _word_hex(words[i - 1]),
                "after_rotword": _word_hex(rotated),
                "after_subword": _word_hex(subbed),
                "rcon": f"{rcon:02x}000000",
                "after_rcon": _word_hex(temp),
                "w_i_minus_8": _word_hex(words[i - 8]),
            }
        elif i % 8 == 4:
            subbed = [SBOX[b] for b in temp]
            notes[i] = {
                "i": i,
                "kind": "SubWord",
                "prev": _word_hex(words[i - 1]),
                "after_subword": _word_hex(subbed),
                "w_i_minus_8": _word_hex(words[i - 8]),
            }
            temp = subbed
        words.append([words[i - 8][k] ^ temp[k] for k in range(4)])
        if i in notes:
            notes[i]["result"] = _word_hex(words[i])
    return words, notes


def key_expansion_traced(key: bytes):
    assert len(key) == 32, "AES-256 needs a 32-byte key"
    words, notes = _expand_key(key)
    return {
        "words": [_word_hex(w) for w in words],
        "round_keys": [_matrix_hex(_words_to_matrix(words[4 * r:4 * r + 4])) for r in range(15)],
        "derivations": [notes[i] for i in sorted(notes)],
    }


def _sub_bytes(state):
    return [[SBOX[b] for b in row] for row in state]


def _shift_rows(state):
    return [state[r][r:] + state[r][:r] for r in range(4)]


def _mix_columns(state):
    out = [[0] * 4 for _ in range(4)]
    for c in range(4):
        a0, a1, a2, a3 = (state[r][c] for r in range(4))
        out[0][c] = _gf_mul(a0, 2) ^ _gf_mul(a1, 3) ^ a2 ^ a3
        out[1][c] = a0 ^ _gf_mul(a1, 2) ^ _gf_mul(a2, 3) ^ a3
        out[2][c] = a0 ^ a1 ^ _gf_mul(a2, 2) ^ _gf_mul(a3, 3)
        out[3][c] = _gf_mul(a0, 3) ^ a1 ^ a2 ^ _gf_mul(a3, 2)
    return out


def _add_round_key(state, round_key):
    return [[state[r][c] ^ round_key[r][c] for c in range(4)] for r in range(4)]


def _aes256_ecb_block(key, block16):
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    return encryptor.update(block16) + encryptor.finalize()


def aes256_encrypt_block_traced(key: bytes, block16: bytes):
    assert len(key) == 32 and len(block16) == 16, "need 32-byte key and 16-byte block"
    words, _ = _expand_key(key)
    round_keys = [_words_to_matrix(words[4 * r:4 * r + 4]) for r in range(15)]

    state = [[block16[r + 4 * c] for c in range(4)] for r in range(4)]
    input_state = _matrix_hex(state)
    state = _add_round_key(state, round_keys[0])
    after_initial = _matrix_hex(state)

    rounds = []
    for rnd in range(1, 15):
        entry = {"round": rnd, "start": _matrix_hex(state)}
        state = _sub_bytes(state)
        entry["after_sub_bytes"] = _matrix_hex(state)
        state = _shift_rows(state)
        entry["after_shift_rows"] = _matrix_hex(state)
        if rnd < 14:
            state = _mix_columns(state)
            entry["after_mix_columns"] = _matrix_hex(state)
        else:
            entry["after_mix_columns"] = None
        entry["round_key"] = _matrix_hex(round_keys[rnd])
        state = _add_round_key(state, round_keys[rnd])
        entry["after_add_round_key"] = _matrix_hex(state)
        rounds.append(entry)

    ciphertext = bytes(state[r][c] for c in range(4) for r in range(4))
    reference = _aes256_ecb_block(key, block16)
    assert ciphertext == reference, "traced AES block disagrees with cryptography"

    return {
        "input_state": input_state,
        "round_key_0": _matrix_hex(round_keys[0]),
        "after_initial_add_round_key": after_initial,
        "rounds": rounds,
        "ciphertext_hex": ciphertext.hex(),
        "verified": True,
    }


_GCM_R = 0xE1 << 120


def gf128_mul(x: int, y: int) -> int:
    """SP 800-38D Algorithm 1: X·Y in GF(2^128), bit-reflected (block bit 0 = MSB of byte 0 = x^0)."""
    z, v = 0, y
    for i in range(127, -1, -1):
        if (x >> i) & 1:
            z ^= v
        v = (v >> 1) ^ _GCM_R if v & 1 else v >> 1
    return z


def _ghash_tables(h: int):
    """tables[i][b] = (byte b at byte position i) · H, so X·H = XOR of 16 lookups (8-bit Shoup-style)."""
    basis, v = [], h  # basis[j] = x^j · H
    for _ in range(128):
        basis.append(v)
        v = (v >> 1) ^ _GCM_R if v & 1 else v >> 1
    tables = []
    for i in range(16):
        t = [0] * 256
        for k in range(8):
            t[0x80 >> k] = basis[8 * i + k]
        for b in range(1, 256):
            low = b & -b
            if b != low:
                t[b] = t[b ^ low] ^ t[low]
        tables.append(t)
    return tables


def _blocks16(data: bytes):
    return [data[o:o + 16].ljust(16, bytes(1)) for o in range(0, len(data), 16)]


def _inc32(block: bytes) -> bytes:
    return block[:12] + ((int.from_bytes(block[12:], "big") + 1) & 0xFFFFFFFF).to_bytes(4, "big")


def _xor(a: bytes, b: bytes) -> bytes:
    return bytes(p ^ q for p, q in zip(a, b))


def trace_aes_gcm(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes = b"", n_blocks: int = 3) -> dict:
    assert len(key) == 32 and len(nonce) == 12, "need 32-byte key and 12-byte nonce"
    ct_tag = AESGCM(key).encrypt(nonce, plaintext, aad)
    lib_ct, lib_tag = ct_tag[:-16], ct_tag[-16:]

    h_bytes = _aes256_ecb_block(key, bytes(16))
    j0 = nonce + (1).to_bytes(4, "big")
    total_blocks = -(-len(plaintext) // 16)
    n_blocks = min(n_blocks, total_blocks)

    ks1_trace = aes256_encrypt_block_traced(key, _inc32(j0))  # full rounds for keystream block 1
    blocks, counter = [], j0
    for i in range(n_blocks):
        counter = _inc32(counter)
        keystream = bytes.fromhex(ks1_trace["ciphertext_hex"]) if i == 0 else _aes256_ecb_block(key, counter)
        p_i = plaintext[16 * i:16 * i + 16]
        c_i = _xor(p_i, keystream)
        assert c_i == lib_ct[16 * i:16 * i + len(p_i)], f"traced GCM block {i + 1} disagrees with cryptography"
        blocks.append({"index": i + 1, "counter_hex": counter.hex(), "keystream_hex": keystream.hex(),
                       "plaintext_hex": p_i.hex(), "ciphertext_hex": c_i.hex()})

    # GHASH over the FULL aad + ciphertext, using the library's ciphertext bytes
    t0 = time.perf_counter()
    h = int.from_bytes(h_bytes, "big")
    (t0_, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15) = _ghash_tables(h)
    aad_blocks, ct_blocks = _blocks16(aad), _blocks16(lib_ct)
    len_block = (8 * len(aad)).to_bytes(8, "big") + (8 * len(lib_ct)).to_bytes(8, "big")
    steps, x = [], 0
    for source, seq in (("aad", aad_blocks), ("ciphertext", ct_blocks), ("length", [len_block])):
        for idx, blk in enumerate(seq):
            prev = x
            y = x ^ int.from_bytes(blk, "big")
            b = y.to_bytes(16, "big")
            x = (t0_[b[0]] ^ t1[b[1]] ^ t2[b[2]] ^ t3[b[3]] ^ t4[b[4]] ^ t5[b[5]] ^ t6[b[6]] ^ t7[b[7]] ^
                 t8[b[8]] ^ t9[b[9]] ^ t10[b[10]] ^ t11[b[11]] ^ t12[b[12]] ^ t13[b[13]] ^ t14[b[14]] ^ t15[b[15]])
            if idx < n_blocks or source == "length":
                steps.append({"source": source, "index": idx + 1, "block_hex": blk.hex(),
                              "x_prev_hex": f"{prev:032x}", "xor_hex": f"{y:032x}", "x_hex": f"{x:032x}"})
    ghash_ms = (time.perf_counter() - t0) * 1e3
    s_bytes = x.to_bytes(16, "big")
    ek_j0 = _aes256_ecb_block(key, j0)
    tag = _xor(ek_j0, s_bytes)

    first = steps[0]
    table_ok = int(first["x_hex"], 16) == gf128_mul(int(first["xor_hex"], 16), h)
    assert table_ok, "table GHASH multiply disagrees with bitwise SP 800-38D multiply"
    assert tag == lib_tag, "Python GHASH tag disagrees with cryptography AESGCM"

    return {
        "key_hex": key.hex(),
        "nonce_hex": nonce.hex(),
        "aad_hex": aad.hex(),
        "aad_len": len(aad),
        "plaintext_len": len(plaintext),
        "ciphertext_len": len(lib_ct),
        "total_blocks": total_blocks,
        "h_hex": h_bytes.hex(),
        "j0_hex": j0.hex(),
        "blocks": blocks,
        "keystream1_rounds": ks1_trace,
        "ciphertext_head_hex": lib_ct[:16 * n_blocks].hex(),
        "ghash": {
            "aad_blocks": len(aad_blocks),
            "ciphertext_blocks": len(ct_blocks),
            "multiplications": len(aad_blocks) + len(ct_blocks) + 1,
            "steps": steps,
            "len_block_hex": len_block.hex(),
            "s_hex": s_bytes.hex(),
            "elapsed_ms": ghash_ms,
            "method": "8-bit tables: 16 x 256 precomputed multiples of H, 16 lookups per block",
        },
        "ek_j0_hex": ek_j0.hex(),
        "tag_hex": tag.hex(),
        "tag_source": "python_ghash_full",
        "key_expansion": key_expansion_traced(key),
        "sbox": sbox_table(),
        "verified": {
            "ciphertext_blocks_match_cryptography_gcm": True,
            "keystream1_rounds_match_block1": not blocks or ks1_trace["ciphertext_hex"] == blocks[0]["keystream_hex"],
            "aes_block_matches_cryptography_ecb": ks1_trace["verified"],
            "ghash_table_matches_bitwise_multiply": table_ok,
            "tag_matches_cryptography_gcm": True,
        },
    }
