import os
import pickle
import time
from sklearn.linear_model import LogisticRegression
from data.loaders import mnist
from data.features import mnist as mnist_features

SAVE_DIR = "models/saved"


def train():
    X_train, y_train = mnist.load(split="train")
    X_test, y_test = mnist.load(split="test")
    X_train = mnist_features.normalize(X_train)
    X_test = mnist_features.normalize(X_test)

    model = LogisticRegression(max_iter=200)
    start = time.perf_counter()
    model.fit(X_train, y_train)
    train_time = time.perf_counter() - start

    train_acc = model.score(X_train, y_train)
    test_acc = model.score(X_test, y_test)

    os.makedirs(SAVE_DIR, exist_ok=True)
    with open(os.path.join(SAVE_DIR, "mnist_logreg.pkl"), "wb") as f:
        pickle.dump({"model": model}, f)

    return train_acc, test_acc, train_time


if __name__ == "__main__":
    train_acc, test_acc, train_time = train()
    print(f"train_acc={train_acc:.4f} test_acc={test_acc:.4f} train_time={train_time:.1f}s")
