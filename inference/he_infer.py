import numpy as np
from hecrypto.ckks_context import create_context
from hecrypto.encrypt import encrypt_vector
from hecrypto.decrypt import decrypt_vector, deserialize_and_decrypt
from hecrypto.transport import generate_rsa_keypair, wrap_payload_traced, unwrap_payload
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
            "aes_ciphertext_hex_preview": wrapped_input["aes_ciphertext_hex_preview"],
            "encrypted_aes_key_size": wrapped_input["encrypted_aes_key_size"],
            "encrypted_aes_key_hex_preview": wrapped_input["encrypted_aes_key_hex_preview"],
            "integrity_preserved": input_transport_intact,
        },
        "transport_output": {
            "aes_ciphertext_size": wrapped_output["aes_ciphertext_size"],
            "aes_ciphertext_hex_preview": wrapped_output["aes_ciphertext_hex_preview"],
            "encrypted_aes_key_size": wrapped_output["encrypted_aes_key_size"],
            "encrypted_aes_key_hex_preview": wrapped_output["encrypted_aes_key_hex_preview"],
            "integrity_preserved": output_transport_intact,
        },
        "final_decrypted_score": float(final_decrypted[0]),
    }


def run_full_traced_pipeline_with_events(context, x_plain, weights, bias, passphrase=None):
    """Full HE pipeline that also emits a real, granular PipelineEvent log:
    one event per feature's weight-multiply/running-sum, plus encrypt/HE-compute/
    transport/decrypt events. All values are real, not simulated -- note that
    CKKS actually performs the weighted sum as a single vectorized (SIMD)
    ciphertext operation, so the per-feature breakdown below is the real
    mathematical trace of what that single operation computes, shown
    incrementally for visualization.
    """
    rec = PipelineRecorder()
    x = np.asarray(x_plain, dtype=float)
    w = np.asarray(weights, dtype=float)

    rec.emit("input", "load_plaintext", f"Loaded plaintext input vector, dimension {len(x)}",
              data_after={"dim": len(x)},
              why="This is your real feature vector, still fully readable at this point -- nothing has been encrypted yet.",
              next_step="This vector gets encrypted into a single CKKS ciphertext before it ever leaves your machine.",
              formal="x = [x_0, ..., x_{n-1}]")

    encrypted_x = encrypt_vector(context, list(x))
    serialized_input_bytes = encrypted_x.serialize()
    rec.emit("encrypt", "ckks_encrypt",
              f"Encrypted the {len(x)}-value plaintext vector into a single CKKS ciphertext",
              data_before={"dim": len(x)},
              data_after={"ciphertext_size": len(serialized_input_bytes),
                          "hex_preview": serialized_input_bytes[:48].hex()},
              why="CKKS packs all values into one ciphertext using SIMD slots, so the whole vector encrypts as a single homomorphic-friendly object instead of one ciphertext per value.",
              next_step="This ciphertext is what actually gets sent for computation -- the server will never see the plaintext values.",
              formal="c = Enc_pk(x)")

    running_sum = 0.0
    for i in range(len(x)):
        product = float(w[i] * x[i])
        running_sum += product
        rec.emit("compute", "weight_multiply",
                  f"w[{i}]={w[i]:.4f} * x[{i}]={x[i]:.4f} -> {product:.4f} | running_sum={running_sum:.4f}",
                  data_before={"index": i, "weight": float(w[i]), "input": float(x[i])},
                  data_after={"product": product, "running_sum": running_sum},
                  why="Logistic regression scores an input by multiplying each feature by its learned weight and summing the results -- this is one term of that sum.",
                  next_step="This product is added into the running total; once every feature is multiplied, the bias is added to get the raw score.",
                  formal=f"score += w[{i}] * x[{i}]")

    raw_score_plain_equiv = running_sum + float(bias)
    rec.emit("compute", "add_bias",
              f"running_sum={running_sum:.4f} + bias={bias:.4f} -> {raw_score_plain_equiv:.4f}",
              data_after={"raw_score": raw_score_plain_equiv},
              why="The bias is a learned constant offset that shifts the decision boundary -- without it the model could only draw lines through the origin.",
              next_step="This raw score is what the sign (or argmax, for multiclass) of determines the prediction. The real encrypted computation happens next, as a single vectorized operation.",
              formal="score = sum(w_i * x_i) + b")

    encrypted_weighted = encrypted_x * list(w)
    encrypted_sum = encrypted_weighted.sum()
    encrypted_result = encrypted_sum + float(bias)
    serialized_output_bytes = encrypted_result.serialize()
    rec.emit("compute", "ckks_vectorized_compute",
              "Server performed the entire weighted-sum + bias as ONE homomorphic operation on ciphertext (SIMD) -- never decrypting the input",
              data_after={"ciphertext_size": len(serialized_output_bytes),
                          "hex_preview": serialized_output_bytes[:48].hex()},
              why="Unlike the per-feature breakdown shown above (which unpacks the math for teaching), CKKS actually multiplies and sums all features in one shot using SIMD slots -- the server does real homomorphic multiply/add operations on ciphertext bytes, with no decryption at any point.",
              next_step="This encrypted result is wrapped for secure transport back to you, the only party holding the secret key that can decrypt it.",
              formal="Enc(score) = Enc(x) . w + b   (single SIMD op)")

    if passphrase:
        from hecrypto.transport import wrap_with_passphrase, unwrap_with_passphrase, derive_key_from_passphrase
        fingerprint = derive_key_from_passphrase(passphrase).hex()
        wrapped = wrap_with_passphrase(passphrase, serialized_output_bytes)
        rec.emit("transport", "passphrase_aes_wrap",
                  f"Wrapped {len(serialized_output_bytes)}-byte ciphertext with AES-256, key derived from your passphrase via PBKDF2 (200000 iterations)",
                  data_after={"aes_ciphertext_size": len(wrapped["ciphertext"]),
                              "hex_preview": wrapped["ciphertext"][:48].hex(),
                              "key_fingerprint": fingerprint[:32]},
                  why="The CKKS ciphertext bytes are already unreadable, but wrapping them in a second, independent layer (AES, keyed by your own passphrase) protects them in transit even if the CKKS scheme itself were ever broken.",
                  next_step="This wrapped payload travels back to you, where it gets unwrapped with the same passphrase-derived key.",
                  formal="k = PBKDF2(passphrase); wrapped = AES_k(c)")
        unwrapped_output = unwrap_with_passphrase(passphrase, wrapped)
    else:
        rsa_private_key, rsa_public_key = generate_rsa_keypair()
        wrapped_output = wrap_payload_traced(rsa_public_key, serialized_output_bytes)
        rec.emit("transport", "rsa_aes_wrap",
                  f"Wrapped {len(serialized_output_bytes)}-byte ciphertext with AES, then wrapped the AES key with RSA",
                  data_after={"aes_ciphertext_size": wrapped_output["aes_ciphertext_size"],
                              "rsa_key_size": wrapped_output["encrypted_aes_key_size"],
                              "hex_preview": wrapped_output["aes_ciphertext_hex_preview"]},
                  why="AES is fast but needs a shared key; RSA is slow but needs no shared secret -- this hybrid scheme uses AES to encrypt the (already-encrypted) data and RSA only to protect that one small AES key, getting the speed of AES with the key-exchange safety of RSA.",
                  next_step="This wrapped payload travels back to you, where your RSA private key unwraps the AES key, which then unwraps the ciphertext.",
                  formal="k <- random; wrapped = AES_k(c), enc_k = RSA_pk(k)")
        unwrapped_output = unwrap_payload(rsa_private_key, wrapped_output)
    integrity_ok = unwrapped_output == serialized_output_bytes
    rec.emit("transport", "rsa_aes_unwrap",
              f"Unwrapped payload on client side, integrity preserved: {integrity_ok}",
              data_after={"integrity_preserved": integrity_ok},
              why="This checks that the ciphertext bytes that arrive are byte-for-byte identical to what the server sent -- confirming the transport layer didn't corrupt or tamper with anything.",
              next_step="With the original CKKS ciphertext recovered, only your secret key can decrypt it to get the final score.",
              formal="c' = Dec_k(wrapped); assert c' == c")

    final_decrypted = deserialize_and_decrypt(context, unwrapped_output)
    final_score = float(final_decrypted[0])
    rec.emit("decrypt", "ckks_decrypt",
              f"Decrypted final ciphertext using secret key -> raw_score={final_score:.6f}",
              data_after={"raw_score": final_score, "sigmoid": sigmoid(final_score)},
              why="Only the secret key generated at the very start of this run can reverse CKKS encryption -- the server, which never held it, could not have read this value at any point in the computation.",
              next_step="This raw score determines the prediction (its sign for binary models, argmax across classes for multiclass) -- compared next against the plaintext-computed result to confirm they match.",
              formal="score = Dec_sk(c)")

    return {
        "events": rec.as_list(),
        "raw_score": final_score,
        "sigmoid_score": sigmoid(final_score),
        "plaintext_equivalent_score": raw_score_plain_equiv,
        "scores_match": abs(final_score - raw_score_plain_equiv) < 1e-2,
    }
