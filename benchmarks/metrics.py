import time
import tracemalloc
import pickle
import json
import os
import sys
import numpy as np
import torch
from hecrypto.ckks_context import create_context
from inference.he_infer import encrypted_linear_score
from inference.he_cnn_infer import run_encrypted_cnn
from data.loaders import sms_spam, german_credit, symptom_diagnosis, price_data, human_vs_ai_text, mnist, emnist
from data.features import text_stylometric
from data.features import mnist as mnist_features
from models.train.mnist_cnn_he import HECompatibleCNN

SAVE_DIR = "models/saved"
OUT_PATH = "benchmarks/results.json"
N_SAMPLES = 5
N_SAMPLES_CNN = 3


def _load_pickle(name):
    with open(f"{SAVE_DIR}/{name}.pkl", "rb") as f:
        return pickle.load(f)


def _time_and_memory(fn, *args, **kwargs):
    tracemalloc.start()
    start = time.perf_counter()
    result = fn(*args, **kwargs)
    elapsed = time.perf_counter() - start
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return result, elapsed, peak


def _benchmark_model(name, X_encoded, model):
    context = create_context()
    multiclass = model.coef_.shape[0] > 1

    n = min(N_SAMPLES, X_encoded.shape[0])

    def plain_predict():
        return model.predict(X_encoded[:n])

    def he_predict():
        preds = []
        for i in range(n):
            x = X_encoded[i]
            if multiclass:
                scores = [
                    encrypted_linear_score(context, x, model.coef_[c], model.intercept_[c])
                    for c in range(model.coef_.shape[0])
                ]
                preds.append(int(np.argmax(scores)))
            else:
                score = encrypted_linear_score(context, x, model.coef_[0], model.intercept_[0])
                preds.append(int(score > 0))
        return preds

    plain_preds, plain_time, plain_mem = _time_and_memory(plain_predict)
    he_preds, he_time, he_mem = _time_and_memory(he_predict)

    agreement = float(np.mean(np.array(plain_preds) == np.array(he_preds)))

    return {
        "model": name,
        "n_samples": n,
        "plaintext_time_sec": plain_time,
        "he_time_sec": he_time,
        "plaintext_peak_mem_bytes": plain_mem,
        "he_peak_mem_bytes": he_mem,
        "slowdown_factor": he_time / plain_time if plain_time > 0 else None,
        "plain_vs_he_agreement": agreement,
    }


def _benchmark_mnist_cnn():
    model = HECompatibleCNN()
    model.load_state_dict(torch.load(f"{SAVE_DIR}/mnist_cnn_he.pt"))
    model.eval()

    X_test, y_test = mnist.load(split="test")
    n = N_SAMPLES_CNN
    images = X_test[:n].reshape(n, 28, 28).astype(np.float32) / 255.0

    context = create_context(poly_modulus_degree=32768, coeff_mod_bit_sizes=[60, 40, 40, 40, 40, 40, 60], global_scale_bits=40)

    def plain_predict():
        with torch.no_grad():
            logits = model(torch.tensor(images).view(n, 1, 28, 28))
        return logits.argmax(dim=1).numpy()

    def he_predict():
        preds = []
        for i in range(n):
            he_logits = run_encrypted_cnn(context, images[i], model.state_dict())
            preds.append(int(np.argmax(he_logits)))
        return np.array(preds)

    plain_preds, plain_time, plain_mem = _time_and_memory(plain_predict)
    he_preds, he_time, he_mem = _time_and_memory(he_predict)

    agreement = float(np.mean(plain_preds == he_preds))

    return {
        "model": "mnist_cnn_he",
        "n_samples": n,
        "plaintext_time_sec": plain_time,
        "he_time_sec": he_time,
        "plaintext_peak_mem_bytes": plain_mem,
        "he_peak_mem_bytes": he_mem,
        "slowdown_factor": he_time / plain_time if plain_time > 0 else None,
        "plain_vs_he_agreement": agreement,
    }


def _benchmark_emnist():
    bundle = _load_pickle("emnist_logreg")
    X, y = emnist.load(split="test")
    X = mnist_features.normalize(X[:N_SAMPLES]).astype(float)
    return _benchmark_model("emnist_logreg", X, bundle["model"])


def run_one(name):
    """Re-measures one model and replaces (or inserts before mnist_cnn_he) its row in results.json."""
    runners = {"emnist_logreg": _benchmark_emnist}
    row = runners[name]()
    with open(OUT_PATH) as f:
        results = [r for r in json.load(f) if r["model"] != name]
    at = next((i for i, r in enumerate(results) if r["model"] == "mnist_cnn_he"), len(results))
    results.insert(at, row)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(row)


def run_all():
    results = []

    bundle = _load_pickle("sms_spam_logreg")
    X, y = sms_spam.load()
    X_vec = bundle["vectorizer"].transform(X[:N_SAMPLES]).toarray()
    results.append(_benchmark_model("sms_spam", X_vec, bundle["model"]))

    bundle = _load_pickle("german_credit_logreg")
    X, y = german_credit.load()
    X_scaled = bundle["scaler"].transform(X[:N_SAMPLES])
    results.append(_benchmark_model("german_credit", X_scaled, bundle["model"]))

    bundle = _load_pickle("symptom_diagnosis_logreg")
    X, y = symptom_diagnosis.load(split="train")
    results.append(_benchmark_model("symptom_diagnosis", X[:N_SAMPLES].astype(float), bundle["model"]))

    bundle = _load_pickle("price_data_logreg")
    X, y = price_data.load()
    X_scaled = bundle["scaler"].transform(X[:N_SAMPLES])
    results.append(_benchmark_model("price_data", X_scaled, bundle["model"]))

    bundle = _load_pickle("human_vs_ai_text_logreg")
    X_text, y = human_vs_ai_text.load(nrows=N_SAMPLES)
    X = text_stylometric.extract(X_text)
    results.append(_benchmark_model("human_vs_ai_text", X, bundle["model"]))

    bundle = _load_pickle("mnist_logreg")
    X, y = mnist.load(split="test")
    X = mnist_features.normalize(X[:N_SAMPLES]).astype(float)
    results.append(_benchmark_model("mnist_logreg", X, bundle["model"]))

    results.append(_benchmark_emnist())

    results.append(_benchmark_mnist_cnn())

    os.makedirs("benchmarks", exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)

    for r in results:
        print(f"{r['model']}: plain={r['plaintext_time_sec']:.4f}s he={r['he_time_sec']:.4f}s "
              f"slowdown={r['slowdown_factor']:.1f}x agreement={r['plain_vs_he_agreement']:.2f} "
              f"plain_mem={r['plaintext_peak_mem_bytes']} he_mem={r['he_peak_mem_bytes']}")


if __name__ == "__main__":
    # `python -m benchmarks.metrics` measures everything; `... metrics emnist_logreg` just that row.
    run_one(sys.argv[1]) if len(sys.argv) > 1 else run_all()
