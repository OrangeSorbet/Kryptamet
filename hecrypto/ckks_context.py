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
        data = f.read()
    return ts.context_from(data)
