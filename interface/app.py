import json
import numpy as np
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


def _plain_pred(spec, x, allowed):
    """The plaintext model's prediction, limited to the allowed classes when a charset is chosen."""
    if not allowed:
        return spec["plain_predict"](x)
    scores = spec["plain_scores"](x)
    return int(allowed[int(np.argmax(scores[allowed]))])


def _model_and_features(payload):
    """Validates the request and featurizes its input with the model's own
    preprocessing. `input` is {"text"} / {"row"} / {"symptoms"} / {"images"} (or {"pixels"});
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


def _run(spec, feats, passphrase):
    """One complete traced run of the two-party pipeline on one featurized input (the per-run response fields)."""
    x = feats["x"]
    W, b = spec["weights"]()
    allowed = feats.get("allowed")
    plain_pred = _plain_pred(spec, x, allowed)
    result = run_two_party_pipeline(
        create_context(**CKKS_PARAMS), x, W, b,
        feature_names=feats["feature_names"], x_captions=feats["x_captions"],
        class_names=spec["class_names"], passphrase=passphrase, ckks_params=CKKS_PARAMS, allowed=allowed)
    binary = spec["task"] == "binary"
    return {
        "model": spec["id"],
        "model_label": spec["label"],
        "task": spec["task"],
        "input_kind": spec["input_kind"],
        "class_names": spec["class_names"],
        "input_echo": feats["input_echo"],
        "x": [float(v) for v in x],
        "feature_dim": len(x),
        "feature_names": feats["feature_names"],
        "x_captions": feats["x_captions"],
        "feature_trace": feats["feature_trace"],
        "plain_pred": plain_pred,
        "he_pred": result["he_pred"],
        "match": plain_pred == result["he_pred"],
        "events": result["events"],
        "allowed": allowed,
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
    }


@app.route("/api/infer", methods=["POST"])
@app.route("/api/infer_text", methods=["POST"])
def api_infer():
    """The whole pipeline on one input. A drawing with several characters gets one complete traced run per
    character (own keys, ciphertexts and checks); the response is character 1's run plus `char_runs` for
    the others, and every run carries the shared `characters` summary."""
    payload = request.get_json(silent=True) or {}
    try:
        spec, inp, feats = _model_and_features(payload)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    passphrase = (payload.get("passphrase") or "").strip() or None

    if spec["input_kind"] == "image":
        extra = {k: v for k, v in inp.items() if k == "charset"}
        singles = [{"images": [im], **extra} for im in (inp.get("images") or [inp.get("pixels")])]
        runs = [_run(spec, spec["featurize"](one), passphrase) for one in singles]
    else:
        singles, runs = [inp], [_run(spec, feats, passphrase)]

    names = spec["class_names"]
    characters = [{
        "index": k, "he_pred": r["he_pred"], "plain_pred": r["plain_pred"],
        "he_label": names[r["he_pred"]], "plain_label": names[r["plain_pred"]], "match": r["match"],
        "scores": r["scores"], "max_abs_diff_vs_plain": max(abs(a - b) for a, b in zip(r["scores"], r["plain_scores"])),
    } for k, r in enumerate(runs)]
    for k, r in enumerate(runs):
        r.update(input=inp, input_text=inp.get("text"), char_index=k, char_input=singles[k], characters=characters)
    return jsonify({**runs[0], "char_runs": runs[1:]})


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
    row = 0 if spec["task"] == "binary" else _plain_pred(spec, x, feats.get("allowed"))
    return jsonify({**run_full_deep_dive(x, W[row], b[row]),
                    "row": row, "row_class": spec["class_names"][row if spec["task"] != "binary" else 1]})


if __name__ == "__main__":
    app.run(debug=True)
