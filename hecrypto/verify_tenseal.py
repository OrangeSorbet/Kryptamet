import tenseal as ts

context = ts.context(ts.SCHEME_TYPE.CKKS, poly_modulus_degree=8192, coeff_mod_bit_sizes=[60, 40, 40, 60])
context.generate_galois_keys()
context.global_scale = 2**40

plain_vector = [1.0, 2.0, 3.0, 4.0]
encrypted_vector = ts.ckks_vector(context, plain_vector)

result = encrypted_vector + encrypted_vector
decrypted = result.decrypt()

print("Original:", plain_vector)
print("Decrypted (should be doubled):", decrypted)
