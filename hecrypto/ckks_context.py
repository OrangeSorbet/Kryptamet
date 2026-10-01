import tenseal as ts


def create_context(poly_modulus_degree=8192, coeff_mod_bit_sizes=None, global_scale_bits=40):
    if coeff_mod_bit_sizes is None:
        coeff_mod_bit_sizes = [60, 40, 40, 60]

    context = ts.context(
        ts.SCHEME_TYPE.CKKS,
        poly_modulus_degree=poly_modulus_degree,
        coeff_mod_bit_sizes=coeff_mod_bit_sizes,
    )
    context.generate_galois_keys()
    context.global_scale = 2 ** global_scale_bits
    return context


def save_context(context, path, save_secret_key=False):
    with open(path, "wb") as f:
        f.write(context.serialize(save_secret_key=save_secret_key))


def load_context(path):
    with open(path, "rb") as f:
        return context_from_bytes(f.read())


def serialize_context(context, save_secret_key=False, save_galois_keys=True):
    """Real TenSEAL serialization. Note: with the secret key TenSEAL stores only the
    secret key + params (public/relin/galois keys are regenerated on load)."""
    return context.serialize(save_secret_key=save_secret_key, save_galois_keys=save_galois_keys)


def context_from_bytes(data):
    return ts.context_from(data)


def ckks_params_of(context):
    """poly_modulus_degree / coeff_mod_bit_sizes / scale bits read back from SEAL."""
    parms = context.seal_context().data.key_context_data().parms()
    return {
        "poly_modulus_degree": parms.poly_modulus_degree(),
        "coeff_mod_bit_sizes": [m.value().bit_length() for m in parms.coeff_modulus()],
        "global_scale_bits": int(context.global_scale).bit_length() - 1,
    }
