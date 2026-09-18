import tenseal as ts


def deserialize_encrypted(context, serialized_bytes):
    return ts.ckks_vector_from(context, serialized_bytes)


def decrypt_vector(encrypted_vector):
    return encrypted_vector.decrypt()


def deserialize_and_decrypt(context, serialized_bytes):
    return decrypt_vector(deserialize_encrypted(context, serialized_bytes))
