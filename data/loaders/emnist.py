import gzip
import os
import struct

import numpy as np

RAW_DIR = "data/raw/emnist"
SPLIT = "balanced"  # 47 classes: 0-9, A-Z, and the 11 lowercase letters whose shape differs from uppercase


def _read_idx(path, header):
    with gzip.open(path, "rb") as f:
        dims = struct.unpack(">" + "I" * header, f.read(4 * header))
        return np.frombuffer(f.read(), dtype=np.uint8), dims


def load(split="train"):
    """Images as (n, 784) uint8 in MNIST orientation, labels as class indices 0..46.

    EMNIST stores each image transposed relative to MNIST; it is transposed back here."""
    prefix = os.path.join(RAW_DIR, f"emnist-{SPLIT}-{'train' if split == 'train' else 'test'}")
    data, (_, n, rows, cols) = _read_idx(prefix + "-images-idx3-ubyte.gz", 4)
    X = data.reshape(n, rows, cols).transpose(0, 2, 1).reshape(n, rows * cols)
    y, _ = _read_idx(prefix + "-labels-idx1-ubyte.gz", 2)
    return np.ascontiguousarray(X), y


def class_names():
    """Character of each class index, from the split's mapping file (index -> ASCII code)."""
    with open(os.path.join(RAW_DIR, f"emnist-{SPLIT}-mapping.txt")) as f:
        pairs = [tuple(int(v) for v in line.split()) for line in f if line.strip()]
    return [chr(code) for _, code in sorted(pairs)]
