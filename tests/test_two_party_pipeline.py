import json
import pickle
import time

import numpy as np
import pandas as pd

from data.features import text_stylometric
from data.loaders import symptom_diagnosis
from hecrypto.ckks_context import create_context
from inference.he_infer import TERM_STEPS, run_two_party_pipeline

HUMAN_FEATURES = ["word_count", "char_count", "avg_word_length", "sentence_count", "avg_sentence_length",
                  "lexical_diversity", "punctuation_ratio", "uppercase_ratio"]
KEYS_ORDER = ["ckks_keygen", "rsa_keygen_client", "rsa_keygen_server", "passphrase", "pbkdf2",
              "load_plaintext", "ckks_encrypt", "leg1_wrap", "leg1_unwrap", "compute_overview",
              "compute_general_form"]
TAIL_ORDER = ["zero_terms", "add_bias", "leg2_session_key", "leg2_wrap", "leg2_unwrap", "ckks_decrypt"]
PARTY = {"ckks_keygen": "client", "rsa_keygen_client": "client", "rsa_keygen_server": "server",
         "passphrase": "client", "pbkdf2": "client", "load_plaintext": "client", "ckks_encrypt": "client",
         "leg1_wrap": "client", "leg1_unwrap": "server", "compute_overview": "server",
         "compute_general_form": "server", "weight_multiply": "server", "smaller_terms": "server", "zero_terms": "server",
         "add_bias": "server", "leg2_session_key": "server", "leg2_wrap": "server", "leg2_unwrap": "client",
         "ckks_decrypt": "client"}


def _load(name):
    with open(f"models/saved/{name}_logreg.pkl", "rb") as f:
        return pickle.load(f)


def _check(label, model, x, feature_names, class_names, passphrase=None):
    t0 = time.perf_counter()
    r = run_two_party_pipeline(create_context(), x, model.coef_, model.intercept_, feature_names=feature_names,
                               x_captions=[f"value of '{n}' in this input" for n in feature_names],
                               class_names=class_names, passphrase=passphrase)
    elapsed = time.perf_counter() - t0
    ev = r["events"]
    ops = [e["operation_name"] for e in ev]
    n_terms = int(np.count_nonzero(x))
    shown = min(n_terms, TERM_STEPS)
    assert ops == KEYS_ORDER + ["weight_multiply"] * shown + ["smaller_terms"] * (n_terms > shown) + TAIL_ORDER, ops
    terms = [e for e in ev if e["operation_name"] == "weight_multiply"]
    sizes = [abs(e["data_after"]["product"]) for e in terms]
    assert sizes == sorted(sizes, reverse=True), "terms must come largest first"
    rest = [e for e in ev if e["operation_name"] == "smaller_terms"]
    if rest:
        t = rest[0]["data_after"]
        assert t["count"] == n_terms - shown == len(t["terms"]) and max(abs(u["product"]) for u in t["terms"]) <= sizes[-1]
    assert all(e["party"] == PARTY[e["operation_name"]] for e in ev)
    assert all(e["description"] and e["why"] and e["next_step"] and e["formal"] for e in ev)
    by = {e["operation_name"]: e for e in ev}

    plain = np.atleast_1d(model.decision_function(x.reshape(1, -1))[0])
    assert np.max(np.abs(np.array(r["scores"]) - plain)) < 1e-2, (r["scores"], plain)
    assert r["scores_match"]
    assert r["he_pred"] == list(model.classes_).index(model.predict(x.reshape(1, -1))[0])

    assert by["leg1_unwrap"]["data_after"]["integrity_preserved"]
    assert by["leg2_unwrap"]["data_after"]["integrity_preserved"]
    assert by["pbkdf2"]["data_after"]["derived_key_hex"] == by["leg1_unwrap"]["data_after"]["aes_key_hex"]
    assert by["leg1_wrap"]["data_after"]["aes_key_hex"] == by["pbkdf2"]["data_after"]["derived_key_hex"]
    assert by["leg2_wrap"]["data_after"]["aes_key_hex"] == by["leg2_session_key"]["data_after"]["aes_key_hex"]
    for leg in ("leg1", "leg2"):
        wrap, unwrap = by[f"{leg}_wrap"]["data_after"], by[f"{leg}_unwrap"]["data_after"]
        tr = wrap["aes_trace"]
        assert wrap["nonce_size"] == 12 and wrap["tag_size"] == 16 and len(wrap["nonce_hex"]) == 24
        assert wrap["aad_utf8"].startswith(f"kryptamet|{leg}|") and unwrap["aad_utf8"] == wrap["aad_utf8"]
        assert not any(k.startswith("iv") or "padding" in k or "preview" in k for k in wrap)
        assert tr["tag_hex"] == wrap["tag_hex"] == unwrap["tag_hex"] and tr["tag_source"] == "python_ghash_full"
        assert tr["nonce_hex"] == wrap["nonce_hex"] and tr["aad_hex"] == wrap["aad_hex"]
        assert tr["ghash"]["ciphertext_blocks"] == -(-wrap["aes_ciphertext_size"] // 16)
        assert all(tr["verified"].values()) and unwrap["tag_verified"]
        tt = unwrap["tamper_test"]
        assert tt["rejected"] and tt["error"] == "InvalidTag" and tt["tag_flip"]["rejected"]
        assert tt["field_size"] == wrap["aes_ciphertext_size"]
        assert f"byte {tt['flipped_byte_index']:,}" in by[f"{leg}_unwrap"]["why"]
        assert "AES-GCM" in by[f"{leg}_wrap"]["formal"]
    assert by["compute_general_form"]["data_after"]["is_private"] is False
    assert by["compute_general_form"]["data_after"]["input_ciphertext_sha256"] == \
        by["ckks_encrypt"]["data_after"]["serialization"]["sha256"]
    assert by["ckks_keygen"]["data_after"]["is_private"] is True
    row_score = by["add_bias"]["data_after"]["score"]
    assert abs(row_score - r["plain_scores"][by["add_bias"]["data_after"]["row"]]) < 1e-9
    if passphrase is None:
        assert r["passphrase_generated"] and len(r["passphrase"]) == 16
    else:
        assert not r["passphrase_generated"] and r["passphrase"] == passphrase

    size = len(json.dumps(r))
    print(f"{label}: k={len(plain)} d={len(x)} terms={n_terms} pred='{class_names[r['he_pred']]}' "
          f"p={r['probability']:.4f} max|diff|={np.max(np.abs(np.array(r['scores']) - plain)):.2e} "
          f"HE={by['compute_general_form']['data_after']['he_elapsed_ms']:.0f}ms "
          f"json={size / 1e6:.2f}MB total={elapsed:.2f}s")
    return r


def main():
    sms = _load("sms_spam")
    text = "WINNER!! You have won a FREE prize. Call now to claim your cash reward, txt WIN to 80086"
    x = sms["vectorizer"].transform([text]).toarray()[0]
    _check("sms_spam", sms["model"], x, sms["vectorizer"].get_feature_names_out().tolist(), ["ham", "spam"])

    human = _load("human_vs_ai_text")
    text = ("The results demonstrate a significant improvement. Furthermore, the proposed approach "
            "offers several advantages over existing methods, including scalability and robustness.")
    x = np.asarray(text_stylometric.extract([text])[0], dtype=float)
    _check("human_vs_ai_text", human["model"], x, HUMAN_FEATURES, ["human", "AI"], passphrase="correct horse")

    sd = _load("symptom_diagnosis")
    X_test, _ = symptom_diagnosis.load(split="test")
    cols = pd.read_csv(symptom_diagnosis.TRAIN_PATH, nrows=0).columns
    names = pd.read_csv(symptom_diagnosis.TRAIN_PATH, usecols=["prognosis"])["prognosis"].astype("category")
    class_names = [str(c).strip() for c in names.cat.categories]
    feature_names = [c for c in cols if c != "prognosis" and not c.startswith("Unnamed")]
    x = X_test[0].astype(float)
    assert len(feature_names) == len(x) and len(class_names) == sd["model"].coef_.shape[0]
    _check("symptom_diagnosis", sd["model"], x, feature_names, class_names)

    # More than TERM_STEPS non-zero inputs: the rest collapse into one smaller_terms event.
    x = np.where(X_test[1] > 0, 1.0, 0.0) if np.count_nonzero(X_test[1]) > TERM_STEPS else np.ones(len(feature_names))
    _check("symptom_diagnosis (dense)", sd["model"], x, feature_names, class_names)

    check_multi_character()
    print("ALL PASS")


def check_multi_character():
    """A 5-character drawing ("hello", real EMNIST test images) through /api/infer: every character gets its
    own complete traced run; every decrypted class equals the plaintext model's. Then the same images read
    as digits only."""
    from interface.app import app
    from inference.model_registry import get_model
    m = get_model("emnist_logreg")
    images = m["samples"]()["rows"][-1]["input"]["images"]
    client = app.test_client()
    t0 = time.perf_counter()
    r = client.post("/api/infer", json={"model": "emnist_logreg", "input": {"images": images}}).get_json()
    runs = [r, *r["char_runs"]]
    assert len(runs) == 5 and [x["char_index"] for x in runs] == [0, 1, 2, 3, 4]
    W, b = m["weights"]()
    for k, run in enumerate(runs):
        x = m["featurize"]({"images": [images[k]]})["x"]
        assert run["char_input"]["images"] == [images[k]] and np.allclose(run["x"], x)
        assert run["he_pred"] == run["plain_pred"] == m["plain_predict"](x), (k, run["he_pred"], run["plain_pred"])
        assert run["events"] and run["characters"] == r["characters"]
        assert len({run["passphrase"] for run in runs}) == 5  # no passphrase given: each run drew its own
    reads = "".join(c["he_label"] for c in r["characters"])
    print(f"emnist 'hello' via /api/infer: reads {reads!r}, 5 traced runs in {time.perf_counter() - t0:.1f}s")

    r = client.post("/api/infer", json={"model": "emnist_logreg", "input": {"images": images, "charset": "digits"},
                                       "passphrase": "same for all"}).get_json()
    runs = [r, *r["char_runs"]]
    assert all(c["he_pred"] < 10 and c["match"] for c in r["characters"])
    assert {run["passphrase"] for run in runs} == {"same for all"}
    print(f"emnist 'hello' read as digits: {''.join(c['he_label'] for c in r['characters'])!r}")

if __name__ == "__main__":
    main()
