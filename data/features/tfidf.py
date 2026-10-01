"""Traced TF-IDF featurization with a fitted sklearn TfidfVectorizer (raw counts, smooth idf, L2 norm)."""
from collections import Counter
import math


def featurize(vectorizer, text):
    x = vectorizer.transform([text]).toarray()[0].astype(float)
    vocab = vectorizer.vocabulary_
    names = [str(n) for n in vectorizer.get_feature_names_out()]
    tokens = vectorizer.build_analyzer()(text)
    counts = Counter(t for t in tokens if t in vocab)
    raw = {t: c * float(vectorizer.idf_[vocab[t]]) for t, c in counts.items()}
    norm = math.sqrt(sum(v * v for v in raw.values()))

    steps = [{
        "name": "tokenize",
        "raw_computation": (f"lowercase, split into 2+ character word tokens -> {len(tokens)} tokens; "
                            f"{sum(counts.values())} of them ({len(counts)} distinct) are in the "
                            f"{len(names)}-word vocabulary learned from the training SMS messages"),
        "value": float(len(counts)),
        "why": "The model has one weight per vocabulary word; words outside the vocabulary have no weight and are dropped.",
        "next": "Each vocabulary word found gets a raw tf x idf score.",
    }, {
        "name": "l2_norm",
        "raw_computation": (f"sqrt(sum of (tf x idf)^2 over the {len(raw)} words found) = {norm:.4f}"
                            if raw else "no vocabulary words found -> the vector stays all zeros"),
        "value": norm,
        "why": "Dividing by the vector length makes a long message and a short one with the same word mix look alike.",
        "next": "Every tf x idf score below is divided by this length.",
    }]
    for t in sorted(counts, key=lambda t: -x[vocab[t]]):
        i = vocab[t]
        steps.append({
            "name": f"tfidf[{t}]",
            "raw_computation": (f"tf x idf / norm = {counts[t]} x {vectorizer.idf_[i]:.4f} / {norm:.4f} "
                                f"= {x[i]:.4f}"),
            "value": float(x[i]),
            "why": (f"'{t}' appears {counts[t]} time(s); its idf {vectorizer.idf_[i]:.4f} is high when few "
                    "training messages contain it, so rare words count more than common ones."),
            "next": f"Becomes x[{i}], the slot the model's weight for '{t}' multiplies.",
        })
    steps.append({
        "name": "assemble_vector",
        "raw_computation": f"{len(names)} slots, {len(counts)} non-zero, the rest 0",
        "value": None,
        "why": "The logistic regression expects one TF-IDF weight per vocabulary word, in vocabulary order.",
        "next": "This vector is what gets encrypted next, so the server can compute the weighted sum without seeing your words.",
    })
    return {
        "x": x,
        "feature_names": names,
        "x_captions": [f"TF-IDF weight of '{n}' in your text" for n in names],
        "feature_trace": steps,
        "input_echo": {"text": text, "vocabulary_words_found": sorted(counts)},
    }
