from hecrypto.ckks_context import create_context
from hecrypto.encrypt import encrypt_and_serialize
from hecrypto.decrypt import deserialize_and_decrypt
from hecrypto.transport import (
    generate_rsa_keypair,
    wrap_payload,
    unwrap_payload,
)


def run_roundtrip_test():
    ckks_context = create_context()

    plain_vector = [10.0, 20.0, 30.0]
    serialized_ciphertext = encrypt_and_serialize(ckks_context, plain_vector)

    rsa_private_key, rsa_public_key = generate_rsa_keypair()

    wrapped = wrap_payload(rsa_public_key, serialized_ciphertext)
    unwrapped_bytes = unwrap_payload(rsa_private_key, wrapped)

    decrypted_vector = deserialize_and_decrypt(ckks_context, unwrapped_bytes)

    print("Original:", plain_vector)
    print("Decrypted after transport round-trip:", decrypted_vector)

    assert unwrapped_bytes == serialized_ciphertext, "Transport layer altered ciphertext bytes"
    print("PASS: transport round-trip preserved ciphertext bytes")


if __name__ == "__main__":
    run_roundtrip_test()
