import os
import pickle
import sys
import time

import numpy as np
from sklearn.linear_model import LogisticRegression
from data.loaders import emnist
from data.features import mnist as mnist_features
from data.features.glyph_redraw import redraw
from inference.model_registry import EMNIST_FRAMING

SAVE_DIR = "models/saved"
REDRAWN_CACHE = os.path.join(emnist.RAW_DIR, "emnist-balanced-{split}-redrawn.npy")


def redrawn(split, X):
    """Every image of a split re-drawn the way the /live strip draws (data/features/glyph_redraw.py); cached."""
    path = REDRAWN_CACHE.format(split=split)
    if os.path.exists(path):
        return np.load(path)
    t0 = time.perf_counter()
    out = np.stack([redraw(img, EMNIST_FRAMING) for img in X])
    np.save(path, out)
    print(f"re-drew {len(X):,} {split} images in {time.perf_counter() - t0:.0f}s -> {path}")
    return out


def train():
    X_train, y_train = emnist.load(split="train")
    X_test, y_test = emnist.load(split="test")
    R_train, R_test = redrawn("train", X_train), redrawn("test", X_test)
    # Real images plus their drawn-style copies (same labels), all scaled to 0..1 like MNIST.
    X_fit = mnist_features.normalize(np.vstack([X_train, R_train]))
    y_fit = np.concatenate([y_train, y_train])

    model = LogisticRegression(max_iter=300)
    start = time.perf_counter()
    model.fit(X_fit, y_fit)
    train_time = time.perf_counter() - start

    scores = {"train_acc": model.score(mnist_features.normalize(X_train), y_train),
              "test_acc": model.score(mnist_features.normalize(X_test), y_test),
              "test_acc_redrawn": model.score(mnist_features.normalize(R_test), y_test)}

    os.makedirs(SAVE_DIR, exist_ok=True)
    with open(os.path.join(SAVE_DIR, "emnist_logreg.pkl"), "wb") as f:
        pickle.dump({"model": model, "class_names": emnist.class_names(), "trained_on": "real + redrawn",
                     **scores}, f)
    return scores, train_time


def evaluate(path=os.path.join(SAVE_DIR, "emnist_logreg.pkl")):
    """Accuracy of a saved model on the real and the re-drawn test images."""
    with open(path, "rb") as f:
        model = pickle.load(f)["model"]
    X_test, y_test = emnist.load(split="test")
    return {"test_acc": model.score(mnist_features.normalize(X_test), y_test),
            "test_acc_redrawn": model.score(mnist_features.normalize(redrawn("test", X_test)), y_test)}


if __name__ == "__main__":
    if sys.argv[1:] == ["--evaluate"]:
        print(evaluate())
    else:
        scores, train_time = train()
        print(" ".join(f"{k}={v:.4f}" for k, v in scores.items()) + f" train_time={train_time:.1f}s")
