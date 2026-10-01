import numpy as np


def encrypted_linear_scores(enc_x, W, b):
    """Enc(x)·Wᵀ + b for W (k,d), b (k,): one homomorphic vector-matrix product
    (rotations need galois keys, no secret key) plus a plaintext bias add.
    k=1 (binary) and k>1 (multiclass) take the same path."""
    W = np.asarray(W, dtype=float)
    return enc_x.matmul(W.T.tolist()) + np.asarray(b, dtype=float).ravel().tolist()
