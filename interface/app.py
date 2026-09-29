import json
from flask import Flask, render_template, request, jsonify, redirect, url_for
from hecrypto.ckks_context import create_context
from inference.he_infer import run_full_traced_pipeline_with_events
from data.features import text_stylometric
from crypto_teaching.real_ckks import run_full_deep_dive
import pickle

app = Flask(__name__)

# Real parameters every /api/infer_text request builds its CKKS context with;
# echoed back in the response so the Key Setup chapter shows what was used.
CKKS_PARAMS = {"poly_modulus_degree": 8192, "coeff_mod_bit_sizes": [60, 40, 40, 60], "global_scale_bits": 40}


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
    return redirect(url_for("live"))


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

    context = create_context(**CKKS_PARAMS)
    plain_pred = int(model.predict([x])[0])
    result = run_full_traced_pipeline_with_events(context, x, model.coef_[0], model.intercept_[0], passphrase=passphrase)

    return jsonify({
        "model": model_name,
        "input_text": text,
        "feature_dim": len(x),
        "feature_names": feature_names,
        "feature_trace": feature_trace,
        "plain_pred": plain_pred,
        "he_pred": int(result["raw_score"] > 0),
        "match": plain_pred == int(result["raw_score"] > 0),
        "events": result["events"],
        "raw_score": result["raw_score"],
        "sigmoid_score": result["sigmoid_score"],
        "plaintext_equivalent_score": result["plaintext_equivalent_score"],
        "scores_match": result["scores_match"],
        "ckks_params": CKKS_PARAMS,
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


if __name__ == "__main__":
    app.run(debug=True)
