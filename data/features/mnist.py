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


def featurize(pixels):
    """pixels: uint8 array of 784 values, row-major 28x28."""
    x = normalize(pixels[None])[0].astype(float)
    names = [f"px_{r}_{c}" for r in range(28) for c in range(28)]
    lit = int((pixels > 0).sum())
    return {
        "x": x,
        "feature_names": names,
        "x_captions": [f"pixel ({i // 28},{i % 28}) brightness {int(p)} / 255" for i, p in enumerate(pixels)],
        "feature_trace": [{
            "name": "normalize",
            "raw_computation": (f"784 pixels, each value / 255 -> {lit} non-zero pixels, "
                                f"brightest {int(pixels.max())} / 255 = {x.max():.4f}"),
            "value": None,
            "why": "The model was trained on MNIST pixels scaled to 0..1, so your drawing is scaled the same way.",
            "next": "These 784 values, row by row, are the vector that gets encrypted.",
        }],
        "input_echo": {"pixels_nonzero": lit},
    }
