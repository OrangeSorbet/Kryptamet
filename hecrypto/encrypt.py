import tenseal as ts


def encrypt_vector(context, plain_vector):
    return ts.ckks_vector(context, plain_vector)


def serialize_encrypted(encrypted_vector):
    return encrypted_vector.serialize()


def encrypt_and_serialize(context, plain_vector):
    return serialize_encrypted(encrypt_vector(context, plain_vector))
