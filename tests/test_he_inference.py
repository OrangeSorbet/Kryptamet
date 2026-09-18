import pickle
import numpy as np
from hecrypto.ckks_context import create_context
from inference.he_infer import encrypted_linear_score, sigmoid
from data.loaders import sms_spam, german_credit, symptom_diagnosis, price_data, human_vs_ai_text
from data.features import text_stylometric

SAVE_DIR = "models/saved"
N_SAMPLES = 5
TOLERANCE = 1e-3


def _load_pickle(name):
    with open(f"{SAVE_DIR}/{name}.pkl", "rb") as f:
        return pickle.load(f)


def _validate(name, X_encoded, model):
    context = create_context()
    multiclass = model.coef_.shape[0] > 1

    max_diff = 0.0
    for i in range(min(N_SAMPLES, X_encoded.shape[0])):
        x = X_encoded[i]
        if multiclass:
            for c in range(model.coef_.shape[0]):
                he_score = encrypted_linear_score(context, x, model.coef_[c], model.intercept_[c])
                plain_score = model.decision_function(x.reshape(1, -1))[0][c]
                diff = abs(he_score - plain_score)
                max_diff = max(max_diff, diff)
        else:
            he_score = encrypted_linear_score(context, x, model.coef_[0], model.intercept_[0])
            plain_score = model.decision_function(x.reshape(1, -1))[0]
            diff = abs(he_score - plain_score)
            max_diff = max(max_diff, diff)

    status = "PASS" if max_diff < TOLERANCE else "FAIL"
    print(f"{name}: max_diff={max_diff:.6f} {status}")
    return status == "PASS"


def validate_sms_spam():
    bundle = _load_pickle("sms_spam_logreg")
    X, y = sms_spam.load()
    X_vec = bundle["vectorizer"].transform(X[:N_SAMPLES]).toarray()
    return _validate("sms_spam", X_vec, bundle["model"])


def validate_german_credit():
    bundle = _load_pickle("german_credit_logreg")
    X, y = german_credit.load()
    X_scaled = bundle["scaler"].transform(X[:N_SAMPLES])
    return _validate("german_credit", X_scaled, bundle["model"])


def validate_symptom_diagnosis():
    bundle = _load_pickle("symptom_diagnosis_logreg")
    X, y = symptom_diagnosis.load(split="train")
    return _validate("symptom_diagnosis", X[:N_SAMPLES].astype(float), bundle["model"])


def validate_price_data():
    bundle = _load_pickle("price_data_logreg")
    X, y = price_data.load()
    X_scaled = bundle["scaler"].transform(X[:N_SAMPLES])
    return _validate("price_data", X_scaled, bundle["model"])


def validate_human_vs_ai_text():
    bundle = _load_pickle("human_vs_ai_text_logreg")
    X_text, y = human_vs_ai_text.load(nrows=N_SAMPLES)
    X = text_stylometric.extract(X_text)
    return _validate("human_vs_ai_text", X, bundle["model"])


if __name__ == "__main__":
    results = [
        validate_sms_spam(),
        validate_german_credit(),
        validate_symptom_diagnosis(),
        validate_price_data(),
        validate_human_vs_ai_text(),
    ]
    print("ALL PASS" if all(results) else "SOME FAILED")
