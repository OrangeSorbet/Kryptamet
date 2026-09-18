import os
import struct
import numpy as np

RAW_DIR = "data/raw/mnist/MNIST/raw"


def _read_idx_images(path):
    with open(path, "rb") as f:
        _, num, rows, cols = struct.unpack(">IIII", f.read(16))
        data = np.frombuffer(f.read(), dtype=np.uint8)
        return data.reshape(num, rows * cols)


def _read_idx_labels(path):
    with open(path, "rb") as f:
        _, num = struct.unpack(">II", f.read(8))
        return np.frombuffer(f.read(), dtype=np.uint8)


def load(split="train"):
    prefix = "train" if split == "train" else "t10k"
    X = _read_idx_images(os.path.join(RAW_DIR, f"{prefix}-images-idx3-ubyte"))
    y = _read_idx_labels(os.path.join(RAW_DIR, f"{prefix}-labels-idx1-ubyte"))
    return X, y
