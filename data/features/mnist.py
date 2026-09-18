import numpy as np
from PIL import Image


def normalize(X):
    return X.astype(np.float32) / 255.0


def resize_flat(X, size=(28, 28)):
    n = X.shape[0]
    out = np.zeros((n, size[0] * size[1]), dtype=np.float32)
    for i in range(n):
        img = Image.fromarray(X[i].reshape(28, 28).astype(np.uint8))
        img = img.resize(size)
        out[i] = np.asarray(img, dtype=np.float32).flatten() / 255.0
    return out


def extract(X, size=(28, 28)):
    if size == (28, 28):
        return normalize(X)
    return resize_flat(X, size)
