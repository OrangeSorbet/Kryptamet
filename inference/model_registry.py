"""Registry of the six plaintext-trained linear models /live can run on real user input.

Thin composition: bundles come from models/saved/, featurization from data/features/ + data/loaders/.
Everything touching data/raw or a pickle is loaded lazily and cached, so importing never needs the data.
"""
import functools
import math
import pickle

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from data.features import mnist as mnist_features
from data.features import symptoms as symptom_features
from data.features import tabular, text_stylometric, tfidf
from data.loaders import emnist, german_credit, mnist, price_data, symptom_diagnosis

SAVE_DIR = "models/saved"
MAX_TEXT_CHARS = 10_000
N_TABULAR_SAMPLES = 8
PRICE_HISTORY_DAYS = 20  # closes shown before each Price direction case (input panel line chart)
N_SYMPTOM_SAMPLES = 5
MAX_CHARS = 8  # characters per drawing; each is one 784-pixel image and one encrypted inference
# Class order of emnist_logreg = emnist-balanced-mapping.txt (checked by tests.test_model_registry).
EMNIST_CLASS_NAMES = list("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabdefghnqrt")
# How each dataset framed its characters inside 28x28 (box size and centring measured on the test sets):
# the drawing strip (digit_canvas.js renderGlyph) re-renders every drawn character this way before it is
# sent. pen (stroke width / box) and blur were calibrated by re-drawing 600 real test characters from their
# centre lines and keeping the best setting; on 600 held-out ones, re-drawn MNIST digits score 0.955 (real
# images 0.940) and re-drawn EMNIST characters 0.577 (real 0.703).
MNIST_FRAMING = {"box": 20, "center": "mass", "pen": 0.10, "blur": 0.3}
EMNIST_FRAMING = {"box": 24, "center": "box", "pen": 0.12, "blur": 0}

# Categories of Training.csv's `prognosis`, i.e. the order symptom_diagnosis.load() label-encodes them
# (tests/test_model_registry.py asserts this still matches the data).
SYMPTOM_CLASS_NAMES = [
    "(vertigo) Paroymsal  Positional Vertigo", "AIDS", "Acne", "Alcoholic hepatitis", "Allergy", "Arthritis",
    "Bronchial Asthma", "Cervical spondylosis", "Chicken pox", "Chronic cholestasis", "Common Cold", "Dengue",
    "Diabetes ", "Dimorphic hemmorhoids(piles)", "Drug Reaction", "Fungal infection", "GERD", "Gastroenteritis",
    "Heart attack", "Hepatitis B", "Hepatitis C", "Hepatitis D", "Hepatitis E", "Hypertension ",
    "Hyperthyroidism", "Hypoglycemia", "Hypothyroidism", "Impetigo", "Jaundice", "Malaria", "Migraine",
    "Osteoarthristis", "Paralysis (brain hemorrhage)", "Peptic ulcer diseae", "Pneumonia", "Psoriasis",
    "Tuberculosis", "Typhoid", "Urinary tract infection", "Varicose veins", "hepatitis A",
]

# Same strings as EXAMPLE_INPUTS in interface/static/js/scene_renderers.js.
_TEXT_SAMPLES = {
    "human_vs_ai_text": [
        "honestly no idea why the bus was so late today, ended up walking half the way lol",
        "Artificial intelligence represents a transformative paradigm shift, offering unprecedented "
        "opportunities to enhance efficiency across diverse industries.",
    ],
    "sms_spam": [
        "URGENT! You have won a 1000 cash prize. Call now to claim your reward, reply YES.",
        "Hey, are we still on for dinner tonight? I'll be there around 7.",
    ],
}


@functools.lru_cache(maxsize=None)
def _bundle(name):
    with open(f"{SAVE_DIR}/{name}.pkl", "rb") as f:
        return pickle.load(f)


def _missing_data(exc):
    return {"rows": [], "note": f"real samples unavailable: {exc}"}


# ---- input validation (trust boundary) ----

def _as_dict(inp):
    if not isinstance(inp, dict):
        raise ValueError("input must be a JSON object")
    return inp


def _text(inp):
    text = _as_dict(inp).get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("text must be a non-empty string")
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(f"text is too long ({len(text)} chars, max {MAX_TEXT_CHARS})")
    return text


def _number(field, v):
    if isinstance(v, bool):
        raise ValueError(f"field {field!r} must be a number, got {v!r}")
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"field {field!r} must be a number, got {v!r}") from None
    if not math.isfinite(f):
        raise ValueError(f"field {field!r} must be finite, got {v!r}")
    return f


def _row(inp, fields):
    row = _as_dict(inp).get("row")
    if not isinstance(row, dict):
        raise ValueError("input must have a 'row' object of field -> value")
    names = [f["name"] for f in fields]
    unknown = sorted(set(row) - set(names))
    missing = [n for n in names if n not in row]
    if unknown:
        raise ValueError(f"unknown field(s): {unknown}")
    if missing:
        raise ValueError(f"missing field(s): {missing}")
    clean = {}
    for f in fields:
        v = row[f["name"]]
        if f["type"] == "categorical":
            if v not in f["codes"]:
                raise ValueError(f"field {f['name']!r} must be one of {f['codes']}, got {v!r}")
            clean[f["name"]] = v
        else:
            clean[f["name"]] = _number(f["name"], v)
    return clean


def _symptom_list(inp, names):
    present = _as_dict(inp).get("symptoms")
    if not isinstance(present, list) or not all(isinstance(s, str) for s in present):
        raise ValueError("input must have a 'symptoms' list of symptom names")
    if not present:
        raise ValueError("select at least one symptom")
    unknown = sorted(set(present) - set(names))
    if unknown:
        raise ValueError(f"unknown symptom(s): {unknown}")
    return present


def _images(inp):
    """{"images": [784 ints, ...]} (one per character, 1..MAX_CHARS) or the single-image {"pixels": [...]}."""
    d = _as_dict(inp)
    imgs = d.get("images") if "images" in d else [d.get("pixels")]
    if not isinstance(imgs, list) or not 1 <= len(imgs) <= MAX_CHARS:
        raise ValueError(f"images must be a list of 1..{MAX_CHARS} images")
    return [_pixels({"pixels": px}) for px in imgs]


CHARSETS = {"all": None, "digits": str.isdigit, "letters": str.isalpha}


def _image_featurize(class_names):
    """The first image's features (/api/infer featurizes each drawn character on its own).
    Optional "charset" ("all" / "digits" / "letters") limits which classes a prediction may be."""
    def featurize(inp):
        imgs = _images(inp)
        charset = _as_dict(inp).get("charset", "all")
        if charset not in CHARSETS:
            raise ValueError(f"charset must be one of {sorted(CHARSETS)}")
        feats = mnist_features.featurize(imgs[0])
        keep = CHARSETS[charset]
        feats["allowed"] = None if keep is None else [i for i, c in enumerate(class_names) if keep(c)]
        return feats
    return featurize


def _pixels(inp):
    px = _as_dict(inp).get("pixels")
    if not isinstance(px, list) or len(px) != 784:
        raise ValueError(f"pixels must be a list of 784 ints, got {len(px) if isinstance(px, list) else type(px).__name__}")
    if not all(isinstance(p, int) and not isinstance(p, bool) and 0 <= p <= 255 for p in px):
        raise ValueError("every pixel must be an int in 0..255")
    return np.array(px, dtype=np.uint8)


# ---- per-dataset composition ----

def _labeled(inp, label, class_names):
    return {"input": inp, "label": int(label), "label_name": class_names[int(label)]}


@functools.lru_cache(maxsize=None)
def _german():
    X, y = german_credit.load_raw()
    cats = german_credit.categorical_fields(X)
    fields = []
    for c in X.columns:
        if c in cats:
            codes = sorted(X[c].unique().tolist(), key=lambda a: int(a[1:]))
            fields.append({"name": c, "type": "categorical", "codes": codes, "doc": german_credit.FIELD_DOCS[c],
                           "meanings": {a: german_credit.CODE_MEANINGS[a] for a in codes}})
        else:
            fields.append({"name": c, "type": "numeric", "min": float(X[c].min()), "max": float(X[c].max()),
                           "doc": german_credit.FIELD_DOCS[c]})
    return X, y, cats, fields


def _german_featurize(inp):
    X, _, cats, fields = _german()
    row = _row(inp, fields)
    encoded = german_credit.encode(pd.DataFrame([row]), X).iloc[0]
    return tabular.featurize(row, encoded, _bundle("german_credit_logreg")["scaler"], cats)


def _german_samples(class_names):
    try:
        X, y, _, fields = _german()
    except OSError as exc:
        return _missing_data(exc)
    _, test_idx = train_test_split(np.arange(len(y)), test_size=0.2, random_state=42)
    rows = [_labeled({"row": {k: (v.item() if hasattr(v, "item") else v) for k, v in X.iloc[i].items()}},
                     y[i], class_names) for i in test_idx[:N_TABULAR_SAMPLES]]
    return {"fields": fields, "rows": rows}


@functools.lru_cache(maxsize=None)
def _price():
    df = price_data.load_frame()
    X, close = df[price_data.FEATURES].values, df["Close"].values
    fields = [{"name": n, "type": "numeric", "min": float(X[:, j].min()), "max": float(X[:, j].max())}
              for j, n in enumerate(price_data.FEATURES)]
    return X, price_data.direction(close), fields, close, df["Date"].dt.strftime("%Y-%m-%d").tolist()


def _price_featurize(inp):
    fields = _price()[2]
    row = _row(inp, fields)
    encoded = pd.Series([row[n] for n in price_data.FEATURES], index=price_data.FEATURES)
    return tabular.featurize(row, encoded, _bundle("price_data_logreg")["scaler"])


def _price_samples(class_names):
    try:
        X, y, fields, close, dates = _price()
    except OSError as exc:
        return _missing_data(exc)
    _, test_idx = train_test_split(np.arange(len(y)), test_size=0.2, shuffle=False)
    rows = []
    for i in test_idx[:N_TABULAR_SAMPLES]:
        r = _labeled({"row": {n: float(X[i, j]) for j, n in enumerate(price_data.FEATURES)}}, y[i], class_names)
        lo = max(0, i - PRICE_HISTORY_DAYS)
        # Real closes of the trading days before this one, and this day's own close (what the label is from).
        r["history"] = {"dates": dates[lo:i], "close": [float(c) for c in close[lo:i]],
                        "day": dates[i], "day_close": float(close[i])}
        rows.append(r)
    return {"fields": fields, "rows": rows}


@functools.lru_cache(maxsize=None)
def _symptom_names():
    return [c for c in symptom_diagnosis.load_frame("train").columns if c != "prognosis"]


def _symptom_featurize(inp):
    names = _symptom_names()
    return symptom_features.featurize(names, _symptom_list(inp, names))


def _symptom_samples(class_names):
    try:
        names = _symptom_names()
        df = symptom_diagnosis.load_frame("test")
    except OSError as exc:
        return _missing_data(exc)
    rows = []
    for _, r in df.head(N_SYMPTOM_SAMPLES).iterrows():
        present = [s for s in names if r[s] == 1]
        rows.append(_labeled({"symptoms": present}, class_names.index(r["prognosis"]), class_names))
    return {"symptoms": names, "rows": rows}


def _word_samples(load, words, framing):
    """Each sample word is made of real test-set images, the first test image of each character's class.
    A letter with no class of its own (EMNIST balanced merges c/C, l/L, o/O, ...) uses its capital's class."""
    def samples(class_names):
        try:
            X, y = load(split="test")
        except OSError as exc:
            return {**_missing_data(exc), "framing": framing}
        rows = []
        for word in words:
            idx = [class_names.index(c if c in class_names else c.upper()) for c in word]
            first = [int(np.flatnonzero(y == k)[0]) for k in idx]
            rows.append({"input": {"images": [X[i].tolist() for i in first]}, "label": None, "label_name": word,
                         "classes": "".join(class_names[k] for k in idx), "test_indices": first})
        return {"rows": rows, "framing": framing, "max_chars": MAX_CHARS}
    return samples


def _text_samples(model_id):
    return lambda class_names: {"rows": [{"input": {"text": t}, "label": None, "label_name": None}
                                         for t in _TEXT_SAMPLES[model_id]]}


# ---- registry ----

def _entry(id, label, bundle, input_kind, class_names, featurize, samples, input_help):
    model = lambda: _bundle(bundle)["model"]

    def weights():
        m = model()
        return np.asarray(m.coef_, dtype=float), np.asarray(m.intercept_, dtype=float)

    def plain_predict(x):
        m = model()
        return list(m.classes_).index(m.predict(np.asarray(x, dtype=float)[None])[0])

    def plain_scores(x):
        return np.atleast_1d(model().decision_function(np.asarray(x, dtype=float)[None])[0]).astype(float)

    return {
        "id": id,
        "label": label,
        "bundle": bundle,
        "input_kind": input_kind,
        "task": "binary" if len(class_names) == 2 else "multiclass",
        "class_names": class_names,
        "input_help": input_help,
        "weights": weights,
        "featurize": featurize,
        "plain_predict": plain_predict,
        "plain_scores": plain_scores,
        # Zero-arg, cached: reads data/raw on first call only.
        "samples": functools.lru_cache(maxsize=None)(lambda: samples(class_names)),
    }


MODELS = {e["id"]: e for e in [
    _entry("sms_spam", "SMS Spam -- TF-IDF bag of words", "sms_spam_logreg", "text", ["not spam", "spam"],
           lambda inp: tfidf.featurize(_bundle("sms_spam_logreg")["vectorizer"], _text(inp)),
           _text_samples("sms_spam"),
           "Type any SMS-style message; it becomes TF-IDF weights over the model's 500-word vocabulary."),
    _entry("human_vs_ai_text", "Human vs AI Text -- 8 stylometric features", "human_vs_ai_text_logreg", "text",
           ["human-written", "AI-generated"],
           lambda inp: text_stylometric.featurize(_text(inp)),
           _text_samples("human_vs_ai_text"),
           "Type a few sentences of English prose; the model only sees 8 style statistics of it, not the words."),
    _entry("german_credit", "German Credit -- 20 applicant attributes", "german_credit_logreg", "tabular",
           ["bad credit risk", "good credit risk"], _german_featurize, _german_samples,
           "One real loan applicant from the UCI Statlog German Credit data (amounts in Deutsche Mark): start "
           "from a test case and change anything. Dropdowns show each A-code's meaning from the dataset's "
           "german.doc (the model receives the code, one-hot encoded); number boxes show the training range. "
           "The model scores good vs bad credit risk."),
    _entry("price_data", "Price direction -- Open/High/Low/Volume", "price_data_logreg", "tabular",
           ["price goes down/flat", "price goes up"], _price_featurize, _price_samples,
           "Enter one trading day's Open, High and Low prices and its Volume; the model predicts whether that "
           "day closes above the previous day's close."),
    _entry("symptom_diagnosis", "Symptom Diagnosis -- 41 conditions", "symptom_diagnosis_logreg", "symptoms",
           SYMPTOM_CLASS_NAMES, _symptom_featurize, _symptom_samples,
           "Pick the symptoms present from the 132 in the training table; every symptom you leave out counts "
           "as absent."),
    _entry("mnist_logreg", "MNIST digits -- 784 pixels", "mnist_logreg", "image",
           [str(d) for d in range(10)], _image_featurize([str(d) for d in range(10)]), _word_samples(mnist.load, ["0", "123"], MNIST_FRAMING),
           "Draw one or more digits in the strip, any size, with a gap between them. On run each one is cut out "
           "and framed like MNIST (scaled to fit 20×20, centred by its centre of mass) into 28×28 = 784 grayscale "
           "pixels, 0 = empty background, 255 = full ink; the framed images shown are exactly what is sent."),
    _entry("emnist_logreg", "EMNIST handwriting -- digits + letters", "emnist_logreg", "image",
           EMNIST_CLASS_NAMES, _image_featurize(EMNIST_CLASS_NAMES),
           _word_samples(emnist.load, ["0", "123", "abcd", "hello"], EMNIST_FRAMING),
           "Draw digits and letters in the strip, with a gap between characters. On run each one is cut out and "
           "framed like EMNIST (scaled to fit 24×24, centred on its bounding box) into 784 pixels, 0 = empty "
           "background, 255 = full ink; the framed images shown are exactly what is sent. 47 classes: EMNIST "
           "merges look-alike cases, so c, i, j, k, l, m, o, p, s, u, v, w, x, y, z are read as capitals."),
]}


def get_model(model_id):
    try:
        return MODELS[model_id]
    except (KeyError, TypeError):
        raise ValueError(f"unsupported model {model_id}") from None


def public_models():
    return [{
        "id": m["id"],
        "label": m["label"],
        "input_kind": m["input_kind"],
        "task": m["task"],
        "class_names": list(m["class_names"]),
        "feature_dim": int(m["weights"]()[0].shape[1]),
        "input_help": m["input_help"],
        "samples": m["samples"](),
    } for m in MODELS.values()]
