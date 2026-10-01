import base64
import hashlib
import math
import time

import numpy as np
from hecrypto.ckks_context import serialize_context, context_from_bytes, ckks_params_of
from hecrypto.encrypt import encrypt_vector
from hecrypto.decrypt import decrypt_vector, deserialize_and_decrypt, deserialize_encrypted
from hecrypto.evaluate import encrypted_linear_scores
from hecrypto.transport import (generate_rsa_keypair, wrap_payload_traced, unwrap_payload, unwrap_payload_traced,
                                derive_key_from_passphrase, new_aes_key, new_salt, new_passphrase, tamper_test)
from hecrypto.pbkdf2_trace import trace_pbkdf2
from hecrypto.rsa_trace import trace_rsa_keypair
from hecrypto.aes_trace import trace_aes_gcm
from hecrypto.ckks_encode_trace import trace_ckks_encryption
from inference.pipeline_events import PipelineRecorder


def encrypted_linear_score(context, x_plain, weights, bias):
    """Computes dot(x, weights) + bias homomorphically. Returns decrypted raw score."""
    encrypted_x = encrypt_vector(context, list(x_plain))
    encrypted_weighted = encrypted_x * list(weights)
    encrypted_sum = encrypted_weighted.sum()
    encrypted_result = encrypted_sum + float(bias)
    decrypted = decrypt_vector(encrypted_result)
    return decrypted[0]


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


def run_traced_inference(context, x_plain, weights, bias):
    """Runs the full HE pipeline for a single linear-model prediction, returning
    every intermediate artifact so the UI can display and explain each stage.
    """
    plaintext_input = list(np.asarray(x_plain, dtype=float))

    encrypted_x = encrypt_vector(context, plaintext_input)
    serialized_input_bytes = encrypted_x.serialize()

    encrypted_weighted = encrypted_x * list(weights)
    encrypted_sum = encrypted_weighted.sum()
    encrypted_result = encrypted_sum + float(bias)
    serialized_output_bytes = encrypted_result.serialize()

    decrypted = decrypt_vector(encrypted_result)
    raw_score = float(decrypted[0])

    return {
        "plaintext_input": plaintext_input,
        "plaintext_input_dim": len(plaintext_input),
        "ciphertext_input_bytes": serialized_input_bytes,
        "ciphertext_input_hex_preview": serialized_input_bytes[:64].hex(),
        "ciphertext_input_size": len(serialized_input_bytes),
        "weights": list(weights),
        "bias": float(bias),
        "ciphertext_output_bytes": serialized_output_bytes,
        "ciphertext_output_hex_preview": serialized_output_bytes[:64].hex(),
        "ciphertext_output_size": len(serialized_output_bytes),
        "raw_score": raw_score,
        "sigmoid_score": sigmoid(raw_score),
    }


def run_full_traced_pipeline(context, x_plain, weights, bias):
    """Full end-to-end trace: CKKS encrypt -> RSA+AES transport wrap -> unwrap ->
    CKKS decrypt. Every stage's artifacts are returned for UI display.
    """
    he_trace = run_traced_inference(context, x_plain, weights, bias)

    rsa_private_key, rsa_public_key = generate_rsa_keypair()

    wrapped_input = wrap_payload_traced(rsa_public_key, he_trace["ciphertext_input_bytes"])
    unwrapped_input = unwrap_payload(rsa_private_key, wrapped_input)
    input_transport_intact = unwrapped_input == he_trace["ciphertext_input_bytes"]

    wrapped_output = wrap_payload_traced(rsa_public_key, he_trace["ciphertext_output_bytes"])
    unwrapped_output = unwrap_payload(rsa_private_key, wrapped_output)
    output_transport_intact = unwrapped_output == he_trace["ciphertext_output_bytes"]

    final_decrypted = deserialize_and_decrypt(context, unwrapped_output)

    return {
        **he_trace,
        "transport_input": {
            "aes_ciphertext_size": wrapped_input["aes_ciphertext_size"],
            "tag_hex": wrapped_input["tag_hex"],
            "encrypted_aes_key_size": wrapped_input["encrypted_aes_key_size"],
            "integrity_preserved": input_transport_intact,
        },
        "transport_output": {
            "aes_ciphertext_size": wrapped_output["aes_ciphertext_size"],
            "tag_hex": wrapped_output["tag_hex"],
            "encrypted_aes_key_size": wrapped_output["encrypted_aes_key_size"],
            "integrity_preserved": output_transport_intact,
        },
        "final_decrypted_score": float(final_decrypted[0]),
    }


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


_WIRE_FIELDS = ("aes_key_hex", "nonce_hex", "tag_hex", "aad_hex", "aad_utf8", "encrypted_aes_key_b64",
                "aes_ciphertext_b64", "payload_sha256", "aes_ciphertext_sha256", "aes_ciphertext_size", "tag_size",
                "nonce_size", "encrypted_aes_key_size")


def _wire(wrapped):
    """JSON-safe subset of wrap_payload_traced (drops the raw bytes fields)."""
    return {k: wrapped[k] for k in _WIRE_FIELDS}


def run_two_party_pipeline(context, x, W, b, *, feature_names, x_captions, class_names, passphrase=None,
                           ckks_params=None):
    """Two-party encrypted logistic-regression inference with a real event log.

    server = data owner (holds x and the CKKS secret key, sees the result);
    client = compute node (holds only the public CKKS context and its own RSA keypair).
    x (d,), W (k,d), b (k,). Binary models have k=1 and class_names=[negative, positive];
    multiclass models have k=len(class_names). Every event carries a `party`.
    """
    t_start = time.perf_counter()
    rec = PipelineRecorder()
    x = np.asarray(x, dtype=float).ravel()
    W = np.atleast_2d(np.asarray(W, dtype=float))
    b = np.asarray(b, dtype=float).ravel()
    k, d = W.shape
    binary = k == 1
    class_names = [str(c) for c in class_names]
    feature_names = [str(f) for f in feature_names]
    if x.shape != (d,) or b.shape != (k,):
        raise ValueError(f"shape mismatch: x {x.shape}, W {W.shape}, b {b.shape}")
    if len(feature_names) != d or len(x_captions) != d:
        raise ValueError(f"need {d} feature_names and x_captions, got {len(feature_names)} and {len(x_captions)}")
    if len(class_names) != (2 if binary else k):
        raise ValueError(f"{'binary' if binary else f'{k}-class'} model needs {2 if binary else k} class_names")

    # ---------------- keys (server generates; client generates its own RSA pair) ----------------
    params = ckks_params_of(context)
    n_poly, slots = params["poly_modulus_degree"], params["poly_modulus_degree"] // 2
    secret_ctx = serialize_context(context, save_secret_key=True)
    public_ctx = serialize_context(context, save_secret_key=False, save_galois_keys=True)
    public_ctx_nogal = serialize_context(context, save_secret_key=False, save_galois_keys=False)
    galois_bytes = len(public_ctx) - len(public_ctx_nogal)
    rec.emit("keys", "ckks_keygen",
             f"Server holds a CKKS context: N={n_poly} ({slots} slots), coefficient moduli "
             f"{params['coeff_mod_bit_sizes']} bits, scale 2^{params['global_scale_bits']}. Public context "
             f"{len(public_ctx):,} bytes, secret-key context {len(secret_ctx):,} bytes.",
             data_after={
                 "params": params, "slots": slots,
                 "is_private": context.is_private(),
                 "has_galois_keys": context.has_galois_keys(), "has_relin_keys": context.has_relin_keys(),
                 "public_context": {"save_secret_key": False, "save_galois_keys": True,
                                    "size_bytes": len(public_ctx), "sha256": _sha256(public_ctx)},
                 "public_context_without_galois": {"save_secret_key": False, "save_galois_keys": False,
                                                   "size_bytes": len(public_ctx_nogal),
                                                   "sha256": _sha256(public_ctx_nogal)},
                 "galois_keys_bytes": galois_bytes,
                 "secret_key_context": {"save_secret_key": True, "size_bytes": len(secret_ctx),
                                        "sha256": _sha256(secret_ctx)},
             },
             why=f"The server is the data owner, so it alone keeps the secret key (secret-key context sha256 "
                 f"{_sha256(secret_ctx)[:16]}...) and it alone can ever decrypt. The client will receive only the "
                 f"public context ({len(public_ctx):,} bytes, sha256 {_sha256(public_ctx)[:16]}...): the public "
                 f"key, relinearization keys and galois (rotation) keys. {galois_bytes:,} of those bytes are galois "
                 f"keys, which the client needs because Enc(x)·Wᵀ sums across slots by rotating the ciphertext. "
                 f"The secret-key serialization is smaller ({len(secret_ctx):,} bytes) because TenSEAL stores only "
                 f"the secret key and parameters there and regenerates the other keys from it on load. "
                 f"{slots} slots hold the d={d} input features.",
             next_step="Both parties now generate RSA keypairs, which protect the AES keys on the two transport legs.",
             formal=f"(sk, pk, rlk, gk) <- KeyGen(N={n_poly}, q = prod of {len(params['coeff_mod_bit_sizes'])} "
                    f"primes {params['coeff_mod_bit_sizes']}), Delta = 2^{params['global_scale_bits']}",
             party="server")

    server_priv, server_pub = generate_rsa_keypair()
    client_priv, client_pub = generate_rsa_keypair()
    rsa_traces = {"server": trace_rsa_keypair(server_priv, "server"), "client": trace_rsa_keypair(client_priv, "client")}
    for who, other, leg in (("server", "client", "leg 2 (client -> server)"),
                            ("client", "server", "leg 1 (server -> client)")):
        t = rsa_traces[who]
        rec.emit("keys", f"rsa_keygen_{who}",
                 f"{who.capitalize()} generated a {t['key_size']}-bit RSA keypair: n has {t['bit_lengths']['n']} bits "
                 f"(p {t['bit_lengths']['p']} bits x q {t['bit_lengths']['q']} bits), e={t['e']}, "
                 f"d has {t['bit_lengths']['d']} bits.",
                 data_after=t,
                 why=f"On {leg} the {other} RSA-OAEP-encrypts its AES key under the {who}'s public key "
                     f"(DER sha256 {t['public_key_der_sha256'][:16]}...); only the {who}'s private exponent d can "
                     f"recover it. All {len(t['checks'])} RSA identities (n = p·q, e·d ≡ 1 mod λ(n), CRT values) "
                     f"were verified on these exact numbers.",
                 next_step=("The client makes its own keypair so leg 1 has a recipient key." if who == "server" else
                            "The server now fixes the passphrase that will key the leg-1 AES layer."),
                 formal=f"n = p·q ({t['bit_lengths']['n']} bits); λ(n) = lcm(p-1, q-1); "
                        f"e·d ≡ 1 (mod λ(n)), e = {t['e']}",
                 party=who)

    passphrase_generated = not (passphrase and passphrase.strip())
    if passphrase_generated:
        passphrase = new_passphrase()
    rec.emit("keys", "passphrase",
             f"Passphrase {'generated (secrets.token_urlsafe(12))' if passphrase_generated else 'supplied by you'}: "
             f"{len(passphrase)} characters.",
             data_after={"passphrase": passphrase, "generated": passphrase_generated, "length": len(passphrase)},
             why=("No passphrase was entered, so the server generated 12 random bytes as a "
                  f"{len(passphrase)}-character URL-safe string." if passphrase_generated else
                  f"You entered a {len(passphrase)}-character passphrase.") +
                 " It never travels: PBKDF2 stretches it into the AES-256 key for leg 1, and that key reaches the "
                 "client only inside an RSA-OAEP envelope.",
             next_step="PBKDF2-HMAC-SHA256 turns this passphrase plus a fresh random salt into a 32-byte AES key.",
             formal=f"passphrase = {len(passphrase.encode('utf-8'))} UTF-8 bytes",
             party="server")

    salt = new_salt()
    pbkdf2 = trace_pbkdf2(passphrase, salt)
    leg1_key = derive_key_from_passphrase(passphrase, salt)
    if leg1_key.hex() != pbkdf2["derived_key_hex"]:
        raise RuntimeError("transport PBKDF2 key differs from traced PBKDF2 key")
    rec.emit("keys", "pbkdf2",
             f"PBKDF2-HMAC-SHA256({pbkdf2['iterations']:,} iterations, salt {pbkdf2['salt_hex']}) -> "
             f"key {pbkdf2['derived_key_hex'][:16]}...",
             data_after={**pbkdf2, "transport_key_hex": leg1_key.hex(), "transport_key_matches_trace": True},
             why=f"{pbkdf2['iterations']:,} chained HMAC-SHA256 rounds make every passphrase guess cost "
                 f"{pbkdf2['iterations']:,} HMACs, and the random 16-byte salt makes this key unique to this run. "
                 f"The traced key equals hashlib's, the cryptography library's, and the key hecrypto/transport.py "
                 f"actually uses.",
             next_step="The server now CKKS-encrypts its feature vector; this key will wrap that ciphertext on leg 1.",
             formal="U_1 = HMAC(P, salt || INT(1)); U_i = HMAC(P, U_{i-1}); key = U_1 ⊕ ... ⊕ U_c, "
                    f"c = {pbkdf2['iterations']}",
             party="server")

    # ---------------- encrypt (server) ----------------
    nz = np.flatnonzero(x)
    top_i = int(np.argmax(np.abs(x)))
    rec.emit("encrypt", "load_plaintext",
             f"Server loaded its plaintext feature vector: d={d}, {len(nz)} non-zero values.",
             data_after={"dim": d, "nonzero_count": int(len(nz)), "x": x.tolist(), "feature_names": feature_names},
             why=f"This is the data owner's real input, readable only on the server. {len(nz)} of {d} features are "
                 f"non-zero" + (f"; the largest in magnitude is '{feature_names[top_i]}' = {x[top_i]:.4g}."
                                if len(nz) else "."),
             next_step=f"All {d} values are packed into one CKKS ciphertext ({slots} slots).",
             formal=f"x = (x_0, ..., x_{d - 1}) ∈ R^{d}",
             party="server")

    enc_x = encrypt_vector(context, x.tolist())
    enc_trace = trace_ckks_encryption(context, x, enc_x)
    ct_bytes = base64.b64decode(enc_trace["serialization"]["base64"])
    rec.emit("encrypt", "ckks_encrypt",
             f"CKKS-encrypted x into one ciphertext: {enc_trace['encryption']['ciphertext_polys']} polynomials x "
             f"{enc_trace['encryption']['primes_at_level']} primes x {n_poly} coefficients, serialized to "
             f"{len(ct_bytes):,} bytes (sha256 {enc_trace['serialization']['sha256'][:16]}...).",
             data_after=enc_trace,
             why=f"x is replicated across all {slots} slots, scaled by 2^{params['global_scale_bits']}, turned into a "
                 f"polynomial by the inverse canonical embedding and encrypted under the public key. Decrypting it "
                 f"back gives max error {enc_trace['roundtrip']['max_abs_error']:.2e}, so the ciphertext really holds x.",
             next_step="Leg 1: the ciphertext is wrapped in AES-256-GCM (PBKDF2 key) + RSA-OAEP (client's key) and "
                       "sent to the client.",
             formal="c = (c0, c1) = (pk0·u + e0 + m, pk1·u + e1), m = round(Delta · σ^-1(x))",
             party="server")

    # ---------------- leg 1: server -> client ----------------
    aad1 = b"kryptamet|leg1|server->client"
    w1 = wrap_payload_traced(client_pub, ct_bytes, aes_key=leg1_key, aad=aad1)
    aes1 = trace_aes_gcm(leg1_key, w1["nonce"], ct_bytes, aad=aad1)
    if aes1["ciphertext_head_hex"] != w1["ciphertext"][:len(aes1["ciphertext_head_hex"]) // 2].hex() \
            or aes1["tag_hex"] != w1["tag_hex"]:
        raise RuntimeError("traced AES-GCM blocks/tag differ from the leg-1 wire bytes")
    rec.emit("transport_out", "leg1_wrap",
             f"Server wrapped the {len(ct_bytes):,}-byte CKKS ciphertext: AES-256-GCM with the PBKDF2 key -> "
             f"{w1['aes_ciphertext_size']:,} ciphertext bytes + {w1['tag_size']}-byte tag {w1['tag_hex'][:16]}...; "
             f"AES key RSA-OAEP-encrypted for the client -> {w1['encrypted_aes_key_size']} bytes.",
             data_after={**_wire(w1), "aes_key_source": "PBKDF2(passphrase, salt)",
                         "recipient": "client",
                         "recipient_public_key_der_sha256": rsa_traces["client"]["public_key_der_sha256"],
                         "aes_trace": aes1},
             why="HE is applied before transport wrapping on purpose: the client must compute on the CKKS "
                 "ciphertext, and nothing can be computed on RSA/AES bytes. The AES+RSA layer protects the "
                 "ciphertext in transit; the AES key is the PBKDF2 key, sent sealed under the client's public key "
                 f"(DER sha256 {rsa_traces['client']['public_key_der_sha256'][:16]}...). GCM is a stream mode: "
                 f"{aes1['total_blocks']:,} counter blocks from nonce {w1['nonce_hex']} are AES-encrypted and XORed "
                 f"onto the {len(ct_bytes):,} bytes (no padding, the ciphertext has the same length). GHASH then "
                 f"multiplies all {aes1['ghash']['multiplications']:,} blocks (header '{aad1.decode()}', ciphertext, "
                 f"lengths) by H = {aes1['h_hex'][:16]}... in GF(2^128), and the tag {w1['tag_hex']} seals them: "
                 f"changing any bit of ciphertext, nonce, tag or header makes the tag check fail.",
             next_step="The wrapped bytes cross the wire; the client unwraps them with its RSA private key and checks "
                       "the tag.",
             formal="C = AES-GCM_k(nonce, Enc(x), aad) -> (C, tag); tag = AES_k(J0) ⊕ GHASH_H(aad, C), "
                    "H = AES_k(0^128); wire = (RSA-OAEP_pk_client(k), nonce, C, tag), k = PBKDF2(passphrase, salt)",
             party="server")

    recv_bytes, u1 = unwrap_payload_traced(client_priv, w1)
    tamper1 = tamper_test(client_priv, w1)
    key1_ok = u1["aes_key_hex"] == pbkdf2["derived_key_hex"]
    integrity1 = u1["payload_sha256"] == w1["payload_sha256"] and recv_bytes == ct_bytes
    rec.emit("transport_out", "leg1_unwrap",
             f"Client RSA-decrypted the AES key ({'matches' if key1_ok else 'DOES NOT match'} the PBKDF2 key), "
             f"verified the GCM tag {u1['tag_hex'][:16]}... and decrypted {len(recv_bytes):,} bytes; sha256 "
             f"{u1['payload_sha256'][:16]}... {'matches' if integrity1 else 'DOES NOT match'} what the server sent.",
             data_after={**u1, "sent_payload_sha256": w1["payload_sha256"], "size_bytes": len(recv_bytes),
                         "aad_utf8": w1["aad_utf8"], "aes_key_matches_pbkdf2": key1_ok,
                         "integrity_preserved": integrity1, "tamper_test": tamper1},
             why="The client's private key opens the RSA envelope, revealing the PBKDF2 key without the client ever "
                 "knowing the passphrase. AES-GCM recomputes the tag over the header and ciphertext before releasing "
                 "any plaintext, and it matched. To prove the check is real, a copy of this exact wire payload had "
                 f"bit {tamper1['bit']} of ciphertext byte {tamper1['flipped_byte_index']:,} flipped "
                 f"(0x{tamper1['byte_before']} -> 0x{tamper1['byte_after']}) and decryption was rejected with "
                 f"{tamper1['error']}; flipping bit {tamper1['tag_flip']['bit']} of tag byte "
                 f"{tamper1['tag_flip']['flipped_byte_index']} was rejected too. What the client recovers is still a "
                 "CKKS ciphertext: it can compute on it but, holding no secret key, cannot read x.",
             next_step="The client loads the public-only context and evaluates the model on the ciphertext.",
             formal="k = RSA-OAEP_sk_client(enc_k); tag' = AES_k(J0) ⊕ GHASH_H(aad, C); tag' == tag else reject; "
                    "Enc(x) = AES-GCM^-1_k(nonce, C, aad)",
             party="client")

    # ---------------- compute (client) ----------------
    plain_scores = x @ W.T + b
    row = 0 if binary else int(np.argmax(plain_scores))
    toward = class_names[1] if binary else class_names[row]

    def direction(v):
        if v >= 0:
            return f"toward '{toward}'"
        return f"toward '{class_names[0]}'" if binary else f"away from '{toward}'"

    if binary:
        task = f"binary classification ('{class_names[0]}' vs '{class_names[1]}')"
        rule = (f"score > 0 means '{class_names[1]}', score <= 0 means '{class_names[0]}'; "
                f"sigmoid(score) is P('{class_names[1]}')")
    else:
        task = f"{k}-class classification ({', '.join(repr(c) for c in class_names[:4])}, ...)"
        rule = f"the class with the largest of the {k} scores (argmax) is the prediction; softmax gives probabilities"
    rec.emit("compute", "compute_overview",
             f"Client evaluates a logistic-regression model for {task}: {k} linear score{'s' if k > 1 else ''} "
             f"over d={d} features.",
             data_after={"task": "binary" if binary else "multiclass", "class_names": class_names, "k": k, "d": d,
                         "decision_rule": rule},
             why=f"Each class score is a weighted sum of the {d} features plus a bias; {rule}. The client has W and b "
                 f"(the model) but only an encrypted x, so it computes the scores without seeing the input.",
             next_step=f"The client runs Enc(x)·Wᵀ + b ({k}x{d} weights) as one homomorphic operation.",
             formal=f"score_j = W_j · x + b_j, j = 0..{k - 1}",
             party="client")

    client_ctx = context_from_bytes(public_ctx)
    if client_ctx.is_private():
        raise RuntimeError("client context unexpectedly holds a secret key")
    enc_in = deserialize_encrypted(client_ctx, recv_bytes)
    t0 = time.perf_counter()
    enc_out = encrypted_linear_scores(enc_in, W, b)
    he_ms = (time.perf_counter() - t0) * 1e3
    out_bytes = enc_out.serialize()
    rec.emit("compute", "compute_general_form",
             f"Client computed Enc(x)·Wᵀ + b homomorphically in {he_ms:.1f} ms on a public-only context "
             f"(is_private = False): {len(recv_bytes):,}-byte input ciphertext -> {len(out_bytes):,}-byte "
             f"ciphertext holding {k} score{'s' if k > 1 else ''}.",
             data_after={"input_ciphertext_sha256": u1["payload_sha256"],
                         "output_ciphertext_b64": base64.b64encode(out_bytes).decode("ascii"),
                         "output_ciphertext_sha256": _sha256(out_bytes),
                         "output_ciphertext_size": len(out_bytes),
                         "client_context_sha256": _sha256(public_ctx),
                         "is_private": client_ctx.is_private(), "he_elapsed_ms": he_ms,
                         "weights_shape": [k, d], "bias": b.tolist()},
             why=f"The client rebuilt its context from the server's public bytes (sha256 {_sha256(public_ctx)[:16]}...), "
                 f"which contain no secret key. TenSEAL's matmul multiplies the encrypted slots by Wᵀ and uses "
                 f"galois rotations to add the {d} products per class, all on ciphertext; adding b is a plaintext "
                 f"add. The same call handles k=1 and k>1.",
             next_step=f"For teaching, the next steps replay row '{toward}' term by term in plaintext; the client "
                       f"itself only ever had the ciphertext.",
             formal=f"Enc(s) = Enc(x)·Wᵀ + b,  s_j = Σ_i W[j,i]·x_i + b_j  (i < {d}, j < {k})",
             party="client")

    w_row = W[row]
    rank = np.empty(d, dtype=int)
    rank[np.argsort(-np.abs(w_row), kind="stable")] = np.arange(1, d + 1)
    which = (f"the model's single row (positive pushes toward '{class_names[1]}', negative toward "
             f"'{class_names[0]}')" if binary else
             f"the '{toward}' row, the highest score in the plaintext mirror x·Wᵀ+b")
    running = 0.0
    for pos, i in enumerate(nz):
        i = int(i)
        w, xi = float(w_row[i]), float(x[i])
        product = w * xi
        running += product
        name = feature_names[i]
        nxt = (f"Next term: '{feature_names[int(nz[pos + 1])]}'." if pos + 1 < len(nz)
               else f"The other {d - len(nz)} features are 0 and add nothing.")
        rec.emit("compute", "weight_multiply",
                 f"[plaintext mirror] W[{row},{i}] ('{name}') {w:+.4f} x {xi:.4g} = {product:+.4f}; "
                 f"running sum {running:+.4f}",
                 data_before={"index": i, "name": name, "weight": w, "input": xi},
                 data_after={"product": product, "running_sum": running},
                 why=f"Teaching mirror of {which}; the client never sees x. '{name}' has weight {w:+.4f} "
                     f"(rank {rank[i]} of {d} by |w|, top {math.ceil(100 * rank[i] / d)}%), so it pushes "
                     f"{direction(w)}. Your value {xi:.4g} ({x_captions[i]}) makes it contribute {product:+.4f} "
                     f"{direction(product)}.",
                 next_step=nxt,
                 formal=f"s_{row} += W[{row},{i}]·x_{i} = {w:.4f}·{xi:.4f} = {product:.4f}",
                 party="client")
        rec.events[-1]["captions"] = {
            "weight": f"learned weight for '{name}': {w:+.4f}, pushes {direction(w)}",
            "input": x_captions[i],
            "product": f"adds {product:+.4f} {direction(product)}",
        }

    zero_idx = np.flatnonzero(x == 0)
    top_zero = sorted(zero_idx.tolist(), key=lambda i: -abs(w_row[i]))[:5]
    top_zero_info = [{"index": int(i), "name": feature_names[i], "weight": float(w_row[i]), "rank": int(rank[i])}
                     for i in top_zero]
    named = ", ".join(f"'{t['name']}' ({t['weight']:+.3f})" for t in top_zero_info)
    rec.emit("compute", "zero_terms",
             f"[plaintext mirror] {len(zero_idx)} of {d} features are 0 and contribute exactly 0.",
             data_after={"count": int(len(zero_idx)), "largest_weight_zero_features": top_zero_info,
                         "running_sum": running},
             why=(f"Even heavy weights do nothing without input: {named} are among the zero features, so the running "
                  f"sum stays {running:+.4f}. On the ciphertext these slots are still multiplied (the client cannot "
                  f"tell they are zero)." if len(zero_idx) else
                  f"All {d} features are non-zero, so every term above contributed."),
             next_step=f"Add the bias b_{row} = {b[row]:+.4f}.",
             formal=f"Σ over x_i = 0 of W[{row},i]·x_i = 0",
             party="client")

    mirror_score = running + float(b[row])
    verdict = (f"{mirror_score:+.4f} {'>' if mirror_score > 0 else '<='} 0, so the plaintext mirror says "
               f"'{class_names[1] if mirror_score > 0 else class_names[0]}'." if binary else
               f"{mirror_score:+.4f} is the largest of the {k} plaintext scores (runner-up "
               f"{np.sort(plain_scores)[-2]:+.4f}).")
    rec.emit("compute", "add_bias",
             f"[plaintext mirror] running sum {running:+.4f} + bias {b[row]:+.4f} = {mirror_score:+.4f} "
             f"(score for '{toward}').",
             data_after={"running_sum": running, "bias": float(b[row]), "score": mirror_score,
                         "row": row, "row_class": toward, "plain_scores": plain_scores.tolist()},
             why=f"The bias is the score of an all-zero input; here it shifts the sum by {b[row]:+.4f}. {verdict} "
                 f"The encrypted result must decrypt to this value.",
             next_step="Leg 2: the client wraps the encrypted scores for the server with a fresh AES key.",
             formal=f"s_{row} = Σ_i W[{row},i]·x_i + b_{row} = {mirror_score:.4f}",
             party="client")

    # ---------------- leg 2: client -> server ----------------
    leg2_key = new_aes_key()
    rec.emit("transport_back", "leg2_session_key",
             f"Client generated a fresh random AES-256 key for leg 2: {leg2_key.hex()[:16]}...",
             data_after={"aes_key_hex": leg2_key.hex(), "bytes": len(leg2_key), "source": "os.urandom(32)"},
             why="The client does not know the passphrase and should not reuse the leg-1 key, so it draws a new "
                 "32-byte key from the OS random generator for this one message.",
             next_step="The encrypted scores are AES-256-GCM-encrypted with it, and the key is RSA-sealed for the "
                       "server.",
             formal="k2 <- {0,1}^256",
             party="client")

    aad2 = b"kryptamet|leg2|client->server"
    w2 = wrap_payload_traced(server_pub, out_bytes, aes_key=leg2_key, aad=aad2)
    aes2 = trace_aes_gcm(leg2_key, w2["nonce"], out_bytes, aad=aad2)
    if aes2["ciphertext_head_hex"] != w2["ciphertext"][:len(aes2["ciphertext_head_hex"]) // 2].hex() \
            or aes2["tag_hex"] != w2["tag_hex"]:
        raise RuntimeError("traced AES-GCM blocks/tag differ from the leg-2 wire bytes")
    rec.emit("transport_back", "leg2_wrap",
             f"Client wrapped the {len(out_bytes):,}-byte result ciphertext: AES-256-GCM -> "
             f"{w2['aes_ciphertext_size']:,} ciphertext bytes + {w2['tag_size']}-byte tag {w2['tag_hex'][:16]}...; "
             f"AES key RSA-OAEP-encrypted for the server -> {w2['encrypted_aes_key_size']} bytes.",
             data_after={**_wire(w2), "aes_key_source": "os.urandom(32) (client)", "recipient": "server",
                         "recipient_public_key_der_sha256": rsa_traces["server"]["public_key_der_sha256"],
                         "aes_trace": aes2},
             why=f"The scores are still CKKS-encrypted; this layer protects them in transit. Only the server's "
                 f"private key (public DER sha256 {rsa_traces['server']['public_key_der_sha256'][:16]}...) can open "
                 f"the envelope. {aes2['total_blocks']:,} counter blocks from nonce {w2['nonce_hex']} encrypt the "
                 f"bytes, and the tag {w2['tag_hex']} (GHASH over header '{aad2.decode()}' + "
                 f"{aes2['ghash']['ciphertext_blocks']:,} ciphertext blocks) lets the server detect any change.",
             next_step="The server unwraps with its RSA private key and checks the tag.",
             formal="C2 = AES-GCM_k2(nonce2, Enc(s), aad2) -> (C2, tag2); "
                    "wire2 = (RSA-OAEP_pk_server(k2), nonce2, C2, tag2)",
             party="client")

    back_bytes, u2 = unwrap_payload_traced(server_priv, w2)
    tamper2 = tamper_test(server_priv, w2)
    key2_ok = u2["aes_key_hex"] == leg2_key.hex()
    integrity2 = u2["payload_sha256"] == w2["payload_sha256"] and back_bytes == out_bytes
    rec.emit("transport_back", "leg2_unwrap",
             f"Server recovered the AES key ({'matches' if key2_ok else 'DOES NOT match'} the client's), verified "
             f"the GCM tag {u2['tag_hex'][:16]}... and decrypted {len(back_bytes):,} bytes; sha256 "
             f"{u2['payload_sha256'][:16]}... {'matches' if integrity2 else 'DOES NOT match'} what the client sent.",
             data_after={**u2, "sent_payload_sha256": w2["payload_sha256"], "size_bytes": len(back_bytes),
                         "aad_utf8": w2["aad_utf8"], "aes_key_matches_client": key2_ok,
                         "integrity_preserved": integrity2, "tamper_test": tamper2},
             why=f"The tag verified, so the encrypted scores {'arrived exactly as' if integrity2 else 'differ from what'} "
                 f"the client produced ({'identical' if integrity2 else 'different'} SHA-256). Tamper test on this "
                 f"wire payload: flipping bit {tamper2['bit']} of ciphertext byte {tamper2['flipped_byte_index']:,} "
                 f"(0x{tamper2['byte_before']} -> 0x{tamper2['byte_after']}) made decryption fail with "
                 f"{tamper2['error']}, and so did flipping bit {tamper2['tag_flip']['bit']} of tag byte "
                 f"{tamper2['tag_flip']['flipped_byte_index']}: a meddled result would never reach CKKS decryption.",
             next_step="The server decrypts with its CKKS secret key.",
             formal="k2 = RSA-OAEP_sk_server(enc_k2); tag2' = AES_k2(J0) ⊕ GHASH_H(aad2, C2); tag2' == tag2 else "
                    "reject; Enc(s) = AES-GCM^-1_k2(nonce2, C2, aad2)",
             party="server")

    # ---------------- decrypt (server) ----------------
    scores = np.asarray(deserialize_and_decrypt(context, back_bytes), dtype=float)[:k]
    if binary:
        p1 = float(sigmoid(scores[0]))
        probabilities = [1.0 - p1, p1]
        he_pred = int(scores[0] > 0)
        raw_score = float(scores[0])
        reading = (f"sigmoid({raw_score:+.4f}) = {p1:.4f} = P('{class_names[1]}'); the score is "
                   f"{'>' if he_pred else '<='} 0, so the prediction is '{class_names[he_pred]}'.")
    else:
        e = np.exp(scores - scores.max())
        probabilities = (e / e.sum()).tolist()
        he_pred = int(np.argmax(scores))
        raw_score = float(scores[he_pred])
        reading = (f"argmax over {k} scores is '{class_names[he_pred]}' (softmax {probabilities[he_pred]:.4f})"
                   + ("." if he_pred == row else f"; the plaintext mirror chose '{toward}'."))
    probability = float(probabilities[he_pred])
    max_diff = float(np.max(np.abs(scores - plain_scores)))
    rec.emit("decrypt", "ckks_decrypt",
             f"Server decrypted {k} score{'s' if k > 1 else ''} with its secret key -> '{class_names[he_pred]}' "
             f"(score {raw_score:+.4f}, probability {probability:.4f}).",
             data_after={"scores": scores.tolist(), "plain_scores": plain_scores.tolist(),
                         "max_abs_diff_vs_plain": max_diff, "chosen_index": he_pred,
                         "chosen_class": class_names[he_pred], "class_names": class_names,
                         "probabilities": probabilities, "probability": probability},
             why=f"{reading} CKKS is approximate: the decrypted scores differ from numpy's x·Wᵀ+b by at most "
                 f"{max_diff:.2e}.",
             next_step="Only the server sees this result; the client finished holding only ciphertexts.",
             formal="s = Decode(Dec_sk(Enc(s))) = Decode(c0 + c1·sk) / Delta",
             party="server")

    return {
        "events": rec.as_list(),
        "scores": scores.tolist(),
        "plain_scores": plain_scores.tolist(),
        "scores_match": max_diff < 1e-2,
        "he_pred": he_pred,
        "raw_score": raw_score,
        "probability": probability,
        "probabilities": probabilities,
        "passphrase": passphrase,
        "passphrase_generated": passphrase_generated,
        "ckks_params": ckks_params or params,
        "total_ms": (time.perf_counter() - t_start) * 1e3,
    }
