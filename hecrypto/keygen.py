from hecrypto.ckks_context import create_context, save_context


def generate_keys(secret_key_path, public_key_path, poly_modulus_degree=8192, coeff_mod_bit_sizes=None, global_scale_bits=40):
    context = create_context(
        poly_modulus_degree=poly_modulus_degree,
        coeff_mod_bit_sizes=coeff_mod_bit_sizes,
        global_scale_bits=global_scale_bits,
    )

    save_context(context, secret_key_path, save_secret_key=True)

    public_context = context.copy()
    public_context.make_context_public()
    save_context(public_context, public_key_path, save_secret_key=False)

    return context


if __name__ == "__main__":
    generate_keys("hecrypto/keys/secret.ctx", "hecrypto/keys/public.ctx")
