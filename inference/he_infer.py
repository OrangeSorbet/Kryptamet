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


def run_full_traced_pipeline_with_events(context, x_plain, weights, bias):
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
              data_after={"dim": len(x)})

    encrypted_x = encrypt_vector(context, list(x))
    serialized_input_bytes = encrypted_x.serialize()
    rec.emit("encrypt", "ckks_encrypt",
              f"Encrypted the {len(x)}-value plaintext vector into a single CKKS ciphertext",
              data_before={"dim": len(x)},
              data_after={"ciphertext_size": len(serialized_input_bytes),
                          "hex_preview": serialized_input_bytes[:48].hex()})

    running_sum = 0.0
    for i in range(len(x)):
        product = float(w[i] * x[i])
        running_sum += product
        rec.emit("compute", "weight_multiply",
                  f"w[{i}]={w[i]:.4f} * x[{i}]={x[i]:.4f} -> {product:.4f} | running_sum={running_sum:.4f}",
                  data_before={"index": i, "weight": float(w[i]), "input": float(x[i])},
                  data_after={"product": product, "running_sum": running_sum})

    raw_score_plain_equiv = running_sum + float(bias)
    rec.emit("compute", "add_bias",
              f"running_sum={running_sum:.4f} + bias={bias:.4f} -> {raw_score_plain_equiv:.4f}",
              data_after={"raw_score": raw_score_plain_equiv})

    encrypted_weighted = encrypted_x * list(w)
    encrypted_sum = encrypted_weighted.sum()
    encrypted_result = encrypted_sum + float(bias)
    serialized_output_bytes = encrypted_result.serialize()
    rec.emit("compute", "ckks_vectorized_compute",
              "Server performed the entire weighted-sum + bias as ONE homomorphic operation on ciphertext (SIMD) -- never decrypting the input",
              data_after={"ciphertext_size": len(serialized_output_bytes),
                          "hex_preview": serialized_output_bytes[:48].hex()})

    rsa_private_key, rsa_public_key = generate_rsa_keypair()
    wrapped_output = wrap_payload_traced(rsa_public_key, serialized_output_bytes)
    rec.emit("transport", "rsa_aes_wrap",
              f"Wrapped {len(serialized_output_bytes)}-byte ciphertext with AES, then wrapped the AES key with RSA",
              data_after={"aes_ciphertext_size": wrapped_output["aes_ciphertext_size"],
                          "rsa_key_size": wrapped_output["encrypted_aes_key_size"],
                          "hex_preview": wrapped_output["aes_ciphertext_hex_preview"]})

    unwrapped_output = unwrap_payload(rsa_private_key, wrapped_output)
    integrity_ok = unwrapped_output == serialized_output_bytes
    rec.emit("transport", "rsa_aes_unwrap",
              f"Unwrapped payload on client side, integrity preserved: {integrity_ok}",
              data_after={"integrity_preserved": integrity_ok})

    final_decrypted = deserialize_and_decrypt(context, unwrapped_output)
    final_score = float(final_decrypted[0])
    rec.emit("decrypt", "ckks_decrypt",
              f"Decrypted final ciphertext using secret key -> raw_score={final_score:.6f}",
              data_after={"raw_score": final_score, "sigmoid": sigmoid(final_score)})

    return {
        "events": rec.as_list(),
        "raw_score": final_score,
        "sigmoid_score": sigmoid(final_score),
        "plaintext_equivalent_score": raw_score_plain_equiv,
        "scores_match": abs(final_score - raw_score_plain_equiv) < 1e-2,
    }
