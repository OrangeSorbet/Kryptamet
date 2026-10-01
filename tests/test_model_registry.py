import json
import numpy as np
from sklearn.model_selection import train_test_split
from data.features import text_stylometric
from data.loaders import german_credit, human_vs_ai_text, mnist, price_data, symptom_diagnosis
from inference.model_registry import MODELS, SYMPTOM_CLASS_NAMES, get_model, public_models, _bundle


def _check_featurized(m, inp):
    f = m["featurize"](inp)
    W, b = m["weights"]()
    d = W.shape[1]
    assert W.shape[0] == (1 if m["task"] == "binary" else len(m["class_names"])), m["id"]
    assert b.shape == (W.shape[0],), m["id"]
    assert f["x"].shape == (d,) and f["x"].dtype == float, (m["id"], f["x"].shape)
    assert len(f["feature_names"]) == d and len(f["x_captions"]) == d, m["id"]
    json.dumps({k: v for k, v in f.items() if k != "x"})
    model = _bundle(m["bundle"])["model"]
    assert m["plain_predict"](f["x"]) == list(model.classes_).index(model.predict(f["x"][None])[0]), m["id"]
    scores = m["plain_scores"](f["x"])
    assert scores.shape == (W.shape[0],), m["id"]
    assert np.allclose(scores, W @ f["x"] + b), m["id"]
    return f


def check_every_model_first_sample():
    for m in MODELS.values():
        rows = m["samples"]()["rows"]
        assert rows, f"{m['id']}: no samples"
        f = _check_featurized(m, rows[0]["input"])
        label = rows[0]["label"]
        pred = m["plain_predict"](f["x"])
        print(f"{m['id']}: d={f['x'].shape[0]} pred={m['class_names'][pred]!r} "
              f"true={m['class_names'][label] if label is not None else '-'!r}")


def check_tabular_matches_loader_preprocessing():
    # German credit: registry one-hot + scaler on raw test rows == loader's own encoded rows + scaler.
    m = get_model("german_credit")
    X_enc, y = german_credit.load()
    _, test_idx = train_test_split(np.arange(len(y)), test_size=0.2, random_state=42)
    bundle = _bundle("german_credit_logreg")
    for i, r in zip(test_idx, m["samples"]()["rows"]):
        x = m["featurize"](r["input"])["x"]
        ref = bundle["scaler"].transform(X_enc[i][None])[0]
        assert np.allclose(x, ref), f"german row {i} differs"
        assert m["plain_predict"](x) == bundle["model"].predict(ref[None])[0]
        assert r["label"] == y[i]

    m = get_model("price_data")
    X, close = price_data.load()
    _, test_idx = train_test_split(np.arange(len(close)), test_size=0.2, shuffle=False)
    bundle = _bundle("price_data_logreg")
    for i, r in zip(test_idx, m["samples"]()["rows"]):
        x = m["featurize"](r["input"])["x"]
        ref = bundle["scaler"].transform(X[i][None])[0]
        assert np.allclose(x, ref), f"price row {i} differs"
        assert m["plain_predict"](x) == bundle["model"].predict(ref[None])[0]
    print("tabular featurize == loader preprocessing: PASS")


def check_label_orders():
    df = symptom_diagnosis.load_frame("train")
    assert list(df["prognosis"].astype("category").cat.categories) == SYMPTOM_CLASS_NAMES
    X, y = symptom_diagnosis.load("test")
    m = get_model("symptom_diagnosis")
    for i, r in enumerate(m["samples"]()["rows"]):
        assert np.array_equal(m["featurize"](r["input"])["x"], X[i].astype(float))
        assert r["label"] == y[i]
    X, y = mnist.load("test")
    m = get_model("mnist_logreg")
    for i, r in enumerate(m["samples"]()["rows"]):
        assert np.array_equal(m["featurize"](r["input"])["x"], X[i] / np.float32(255.0))
        assert r["label"] == y[i]
    print("label orders: PASS")


def check_tfidf_trace():
    m = get_model("sms_spam")
    vec = _bundle("sms_spam_logreg")["vectorizer"]
    for t in ["URGENT! You have won a 1000 cash prize. Call now to claim your reward, reply YES.", "zzqx"]:
        f = m["featurize"]({"text": t})
        assert np.allclose(f["x"], vec.transform([t]).toarray()[0])
        norm = f["feature_trace"][1]["value"]
        for s in f["feature_trace"][2:-1]:
            word = s["name"][len("tfidf["):-1]
            i = vec.vocabulary_[word]
            count = vec.build_analyzer()(t).count(word)
            assert np.isclose(count * vec.idf_[i] / norm, s["value"]), word
    print("tfidf trace: PASS")


def check_stylometric_trace_matches_extract():
    texts = list(human_vs_ai_text.load(nrows=5)[0]) + [
        "honestly no idea why the bus was so late today, ended up walking half the way lol",
        "One.  Two words!! THREE? four",
        "   ",
    ]
    for t in texts:
        traced = [s["value"] for s in text_stylometric.extract_traced(t)[:-1]]
        assert traced == [float(v) for v in text_stylometric.extract([t])[0]], t[:40]
    print("stylometric extract_traced == extract: PASS")


def check_invalid_inputs():
    good_row = get_model("german_credit")["samples"]()["rows"][0]["input"]["row"]
    cases = [
        ("sms_spam", {"text": ""}), ("sms_spam", {"text": "   "}), ("human_vs_ai_text", {}),
        ("human_vs_ai_text", "not a dict"), ("sms_spam", {"text": "x" * 10_001}),
        ("german_credit", {"row": {**good_row, "bogus": 1}}),
        ("german_credit", {"row": {k: v for k, v in good_row.items() if k != "age_years"}}),
        ("german_credit", {"row": {**good_row, "checking_status": "A99"}}),
        ("german_credit", {"row": {**good_row, "age_years": "old"}}),
        ("price_data", {"row": {"Open": 1, "High": 2, "Low": float("nan"), "Volume": 3}}),
        ("price_data", {"row": {"Open": True, "High": 2, "Low": 1, "Volume": 3}}),
        ("symptom_diagnosis", {"symptoms": []}), ("symptom_diagnosis", {"symptoms": ["not_a_symptom"]}),
        ("symptom_diagnosis", {"symptoms": "itching"}),
        ("mnist_logreg", {"pixels": [0] * 783}), ("mnist_logreg", {"pixels": [0] * 783 + [256]}),
        ("mnist_logreg", {"pixels": [0] * 783 + [1.5]}),
    ]
    for model_id, inp in cases:
        try:
            get_model(model_id)["featurize"](inp)
        except ValueError:
            continue
        raise AssertionError(f"{model_id} accepted invalid input {str(inp)[:80]}")
    try:
        get_model("nope")
        raise AssertionError("unknown model accepted")
    except ValueError:
        pass
    print("invalid inputs rejected: PASS")


def main():
    check_every_model_first_sample()
    check_tabular_matches_loader_preprocessing()
    check_label_orders()
    check_tfidf_trace()
    check_stylometric_trace_matches_extract()
    check_invalid_inputs()
    pm = public_models()
    json.dumps(pm)
    assert [p["id"] for p in pm] == list(MODELS)
    print("public_models json: PASS")
    print("ALL PASS")


if __name__ == "__main__":
    main()
