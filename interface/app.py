import json
from flask import Flask, render_template, request, jsonify, redirect, url_for
from hecrypto.ckks_context import create_context
from hecrypto.ckks_math import run_full_deep_dive
from inference.he_infer import run_two_party_pipeline
from inference.model_registry import get_model, public_models

app = Flask(__name__)

# Real parameters every inference request builds its CKKS context with;
# echoed back in the response so the Key Setup chapter shows what was used.
CKKS_PARAMS = {"poly_modulus_degree": 8192, "coeff_mod_bit_sizes": [60, 40, 40, 60], "global_scale_bits": 40}


def _load_benchmarks():
    try:
        with open("benchmarks/results.json") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def _model_and_features(payload):
    """Validates the request and featurizes its input with the model's own
    preprocessing. `input` is {"text"} / {"row"} / {"symptoms"} / {"pixels"};
    a bare `text` field (the original /api/infer_text shape) also works."""
    spec = get_model(payload.get("model"))
    inp = payload.get("input") or {"text": payload.get("text", "")}
    return spec, inp, spec["featurize"](inp)


@app.route("/live", methods=["GET"])
def live():
    return render_template("scenes.html", benchmarks=_load_benchmarks())


@app.route("/", methods=["GET"])
def index():
    return redirect(url_for("live"))


@app.route("/api/models", methods=["GET"])
def api_models():
    return jsonify(public_models())


@app.route("/api/infer", methods=["POST"])
@app.route("/api/infer_text", methods=["POST"])
def api_infer():
    payload = request.get_json(silent=True) or {}
    try:
        spec, inp, feats = _model_and_features(payload)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    x = feats["x"]
    W, b = spec["weights"]()
    plain_pred = spec["plain_predict"](x)
    result = run_two_party_pipeline(
        create_context(**CKKS_PARAMS), x, W, b,
        feature_names=feats["feature_names"], x_captions=feats["x_captions"],
        class_names=spec["class_names"], passphrase=(payload.get("passphrase") or "").strip() or None,
        ckks_params=CKKS_PARAMS)

    binary = spec["task"] == "binary"
    return jsonify({
        "model": spec["id"],
        "model_label": spec["label"],
        "task": spec["task"],
        "input_kind": spec["input_kind"],
        "class_names": spec["class_names"],
        "input": inp,
        "input_echo": feats["input_echo"],
        "input_text": inp.get("text"),
        "x": [float(v) for v in x],
        "feature_dim": len(x),
        "feature_names": feats["feature_names"],
        "x_captions": feats["x_captions"],
        "feature_trace": feats["feature_trace"],
        "plain_pred": plain_pred,
        "he_pred": result["he_pred"],
        "match": plain_pred == result["he_pred"],
        "events": result["events"],
        "scores": result["scores"],
        "plain_scores": result["plain_scores"],
        "raw_score": result["raw_score"],
        "plaintext_equivalent_score": result["plain_scores"][0 if binary else result["he_pred"]],
        "scores_match": result["scores_match"],
        # P(positive class) for binary models, P(predicted class) for multiclass.
        "sigmoid_score": result["probabilities"][1] if binary else result["probability"],
        "probabilities": result["probabilities"],
        "ckks_params": CKKS_PARAMS,
        "passphrase": result["passphrase"],
        "passphrase_generated": result["passphrase_generated"],
        "used_passphrase": not result["passphrase_generated"],
        "total_ms": result["total_ms"],
    })


@app.route("/api/ckks_deep_dive", methods=["POST"])
def api_ckks_deep_dive():
    payload = request.get_json(silent=True) or {}
    try:
        spec, _, feats = _model_and_features(payload)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # One linear score per deep-dive run: row 0 for binary models, the
    # plaintext-predicted class's row for multiclass (the deep-dive says which).
    x = feats["x"]
    W, b = spec["weights"]()
    row = 0 if spec["task"] == "binary" else spec["plain_predict"](x)
    return jsonify({**run_full_deep_dive(x, W[row], b[row]),
                    "row": row, "row_class": spec["class_names"][row if spec["task"] != "binary" else 1]})


if __name__ == "__main__":
    app.run(debug=True)
