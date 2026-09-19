import json
from flask import Flask, render_template, request, jsonify
from interface.cli import _get_sample
from hecrypto.ckks_context import create_context
from inference.he_infer import run_full_traced_pipeline, run_full_traced_pipeline_with_events
from data.features import text_stylometric
from crypto_teaching.real_ckks import run_full_deep_dive
import pickle
import numpy as np

app = Flask(__name__)

DATASET_LABELS = {
    "sms_spam": "SMS Spam",
    "german_credit": "German Credit",
    "symptom_diagnosis": "Symptom Diagnosis",
    "price_data": "Price Data",
    "human_vs_ai_text": "Human vs AI Text",
}


def _infer_for_web(dataset_name, index):
    x, true_label, model = _get_sample(dataset_name, index)
    context = create_context()
    multiclass = model.coef_.shape[0] > 1

    plain_pred = int(model.predict([x])[0])

    if multiclass:
        traces = [
            run_full_traced_pipeline(context, x, model.coef_[c], model.intercept_[c])
            for c in range(model.coef_.shape[0])
        ]
        scores = [t["final_decrypted_score"] for t in traces]
        best_class = int(np.argmax(scores))
        primary_trace = traces[best_class]
        he_pred = best_class
    else:
        primary_trace = run_full_traced_pipeline(context, x, model.coef_[0], model.intercept_[0])
        he_pred = int(primary_trace["final_decrypted_score"] > 0)

    return {
        "dataset": dataset_name,
        "true_label": int(true_label),
        "plain_pred": plain_pred,
        "he_pred": he_pred,
        "match": plain_pred == he_pred,
        "trace": {
            "plaintext_input_dim": primary_trace["plaintext_input_dim"],
            "plaintext_input_preview": primary_trace["plaintext_input"][:10],
            "ciphertext_input_size": primary_trace["ciphertext_input_size"],
            "ciphertext_input_hex_preview": primary_trace["ciphertext_input_hex_preview"],
            "ciphertext_output_size": primary_trace["ciphertext_output_size"],
            "ciphertext_output_hex_preview": primary_trace["ciphertext_output_hex_preview"],
            "raw_score": primary_trace["raw_score"],
            "sigmoid_score": primary_trace["sigmoid_score"],
            "final_decrypted_score": primary_trace["final_decrypted_score"],
            "transport_input": primary_trace["transport_input"],
            "transport_output": primary_trace["transport_output"],
        },
    }


def _load_benchmarks():
    try:
        with open("benchmarks/results.json") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


@app.route("/live", methods=["GET"])
def live():
    return render_template("scenes.html", benchmarks=_load_benchmarks())


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html", datasets=DATASET_LABELS, result=None, benchmarks=_load_benchmarks())


@app.route("/api/infer_text", methods=["POST"])
def api_infer_text():
    payload = request.get_json()
    model_name = payload.get("model")
    text = payload.get("text", "")
    passphrase = payload.get("passphrase", "").strip() or None

    if not text.strip():
        return jsonify({"error": "empty input"}), 400

    if model_name == "human_vs_ai_text":
        with open("models/saved/human_vs_ai_text_logreg.pkl", "rb") as f:
            bundle = pickle.load(f)
        model = bundle["model"]
        feature_trace = text_stylometric.extract_traced(text)
        x = text_stylometric.extract([text])[0]
        feature_names = ["word_count", "char_count", "avg_word_length", "sentence_count", "avg_sentence_length", "lexical_diversity", "punctuation_ratio", "uppercase_ratio"]
    elif model_name == "sms_spam":
        with open("models/saved/sms_spam_logreg.pkl", "rb") as f:
            bundle = pickle.load(f)
        model = bundle["model"]
        x = bundle["vectorizer"].transform([text]).toarray()[0]
        feature_names = bundle["vectorizer"].get_feature_names_out().tolist()
        feature_trace = None
    else:
        return jsonify({"error": f"unsupported model {model_name}"}), 400

    context = create_context()
    plain_pred = int(model.predict([x])[0])
    result = run_full_traced_pipeline_with_events(context, x, model.coef_[0], model.intercept_[0], passphrase=passphrase)

    return jsonify({
        "model": model_name,
        "input_text": text,
        "feature_dim": len(x),
        "feature_names": feature_names,
        "feature_trace": feature_trace,
        "input_text": text,
        "plain_pred": plain_pred,
        "he_pred": int(result["raw_score"] > 0),
        "match": plain_pred == int(result["raw_score"] > 0),
        "events": result["events"],
        "raw_score": result["raw_score"],
        "sigmoid_score": result["sigmoid_score"],
        "used_passphrase": passphrase is not None,
    })


@app.route("/api/ckks_deep_dive", methods=["POST"])
def api_ckks_deep_dive():
    payload = request.get_json()
    model_name = payload.get("model")
    text = payload.get("text", "")

    if model_name == "human_vs_ai_text":
        x = text_stylometric.extract([text])[0]
    elif model_name == "sms_spam":
        with open("models/saved/sms_spam_logreg.pkl", "rb") as f:
            bundle = pickle.load(f)
        x = bundle["vectorizer"].transform([text]).toarray()[0][:8]
    else:
        return jsonify({"error": "unsupported model"}), 400

    result = run_full_deep_dive([float(v) for v in x[:8]])
    return jsonify(result)


@app.route("/infer", methods=["POST"])
def infer():
    dataset_name = request.form["dataset"]
    index = int(request.form.get("index", 0))
    result = _infer_for_web(dataset_name, index)
    return render_template("index.html", datasets=DATASET_LABELS, result=result, benchmarks=_load_benchmarks())


if __name__ == "__main__":
    app.run(debug=True)
