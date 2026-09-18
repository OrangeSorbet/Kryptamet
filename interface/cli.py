import sys
import json
import pickle
import numpy as np
from hecrypto.ckks_context import create_context
from inference.he_infer import encrypted_linear_score
from data.loaders import sms_spam, german_credit, symptom_diagnosis, price_data, human_vs_ai_text
from data.features import text_stylometric

SAVE_DIR = "models/saved"

MODELS = {
    "1": ("sms_spam", "sms_spam_logreg"),
    "2": ("german_credit", "german_credit_logreg"),
    "3": ("symptom_diagnosis", "symptom_diagnosis_logreg"),
    "4": ("price_data", "price_data_logreg"),
    "5": ("human_vs_ai_text", "human_vs_ai_text_logreg"),
}


def _load_pickle(name):
    with open(f"{SAVE_DIR}/{name}.pkl", "rb") as f:
        return pickle.load(f)


def _get_sample(dataset_name, index=0):
    if dataset_name == "sms_spam":
        bundle = _load_pickle("sms_spam_logreg")
        X, y = sms_spam.load()
        x = bundle["vectorizer"].transform([X[index]]).toarray()[0]
        return x, y[index], bundle["model"]
    if dataset_name == "german_credit":
        bundle = _load_pickle("german_credit_logreg")
        X, y = german_credit.load()
        x = bundle["scaler"].transform([X[index]])[0]
        return x, y[index], bundle["model"]
    if dataset_name == "symptom_diagnosis":
        bundle = _load_pickle("symptom_diagnosis_logreg")
        X, y = symptom_diagnosis.load(split="train")
        return X[index].astype(float), y[index], bundle["model"]
    if dataset_name == "price_data":
        bundle = _load_pickle("price_data_logreg")
        X, y = price_data.load()
        x = bundle["scaler"].transform([X[index]])[0]
        return x, y[index], bundle["model"]
    if dataset_name == "human_vs_ai_text":
        bundle = _load_pickle("human_vs_ai_text_logreg")
        X_text, y = human_vs_ai_text.load(nrows=index + 1)
        x = text_stylometric.extract([X_text[index]])[0]
        return x, y[index], bundle["model"]
    raise ValueError(f"unknown dataset {dataset_name}")


def _run_inference(dataset_name, index):
    x, true_label, model = _get_sample(dataset_name, index)
    context = create_context()

    multiclass = model.coef_.shape[0] > 1

    plain_pred = int(model.predict([x])[0])

    if multiclass:
        scores = [
            encrypted_linear_score(context, x, model.coef_[c], model.intercept_[c])
            for c in range(model.coef_.shape[0])
        ]
        he_pred = int(np.argmax(scores))
    else:
        score = encrypted_linear_score(context, x, model.coef_[0], model.intercept_[0])
        he_pred = int(score > 0)

    print(f"dataset: {dataset_name}")
    print(f"true label: {true_label}")
    print(f"plaintext prediction: {plain_pred}")
    print(f"encrypted (HE) prediction: {he_pred}")
    print(f"match: {plain_pred == he_pred}")


def _show_benchmarks():
    try:
        with open("benchmarks/results.json") as f:
            results = json.load(f)
    except FileNotFoundError:
        print("no benchmark results found, run: uv run python -m benchmarks.metrics")
        return
    for r in results:
        print(f"{r['model']}: plain={r['plaintext_time_sec']:.4f}s he={r['he_time_sec']:.4f}s "
              f"slowdown={r['slowdown_factor']:.1f}x agreement={r['plain_vs_he_agreement']:.2f}")


def main():
    print("Kryptamet CLI")
    print("1. sms_spam\n2. german_credit\n3. symptom_diagnosis\n4. price_data\n5. human_vs_ai_text\n6. show benchmarks\n0. exit")

    while True:
        choice = input("select> ").strip()
        if choice == "0":
            sys.exit(0)
        if choice == "6":
            _show_benchmarks()
            continue
        if choice in MODELS:
            dataset_name, _ = MODELS[choice]
            index = input("sample index (default 0): ").strip()
            index = int(index) if index else 0
            _run_inference(dataset_name, index)
            continue
        print("invalid choice")


if __name__ == "__main__":
    main()
