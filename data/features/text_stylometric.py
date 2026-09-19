import re
import numpy as np


def _features_for_text(text):
    text = str(text)
    words = text.split()
    num_words = len(words)
    num_chars = len(text)
    avg_word_len = np.mean([len(w) for w in words]) if words else 0.0
    num_sentences = max(len(re.findall(r'[.!?]+', text)), 1)
    avg_sentence_len = num_words / num_sentences
    num_unique_words = len(set(w.lower() for w in words))
    lexical_diversity = num_unique_words / num_words if num_words else 0.0
    num_punct = sum(1 for c in text if c in '.,;:!?"\'')
    punct_ratio = num_punct / num_chars if num_chars else 0.0
    num_upper = sum(1 for c in text if c.isupper())
    upper_ratio = num_upper / num_chars if num_chars else 0.0

    return [
        num_words,
        num_chars,
        avg_word_len,
        num_sentences,
        avg_sentence_len,
        lexical_diversity,
        punct_ratio,
        upper_ratio,
    ]


def extract(texts):
    return np.array([_features_for_text(t) for t in texts], dtype=np.float32)


def extract_traced(text):
    """Same computation as _features_for_text, but returns a step-by-step
    trace: what was counted, the formula, why the feature matters to the
    model, and what happens to it next in the pipeline.
    """
    text = str(text)
    words = text.split()
    num_words = len(words)
    num_chars = len(text)
    num_sentences = max(len(re.findall(r'[.!?]+', text)), 1)
    num_unique_words = len(set(w.lower() for w in words))
    num_punct = sum(1 for c in text if c in '.,;:!?"\'')
    num_upper = sum(1 for c in text if c.isupper())

    steps = []

    steps.append({
        "name": "word_count",
        "raw_computation": f"Split text by whitespace -> {num_words} words",
        "value": float(num_words),
        "why": "AI-generated text often has different average sentence/word patterns than human writing. Word count is the base unit every other stylometric feature is derived from.",
        "next": "Used directly as one input value, and used below to compute avg_word_length and avg_sentence_length.",
    })

    steps.append({
        "name": "char_count",
        "raw_computation": f"len(text) -> {num_chars} characters (including spaces)",
        "value": float(num_chars),
        "why": "Total length matters because longer texts naturally have different punctuation/uppercase ratios; this normalizes those later.",
        "next": "Used directly as one input, and as the denominator for punctuation_ratio and uppercase_ratio below.",
    })

    avg_word_len = num_chars / num_words if num_words else 0.0
    steps.append({
        "name": "avg_word_length",
        "raw_computation": f"char_count / word_count = {num_chars} / {num_words} = {avg_word_len:.4f}",
        "value": avg_word_len,
        "why": "Average word length can differ between human and AI writing styles (AI often favors more uniform, moderate-length words).",
        "next": "Used directly as one input value to the model.",
    })

    steps.append({
        "name": "sentence_count",
        "raw_computation": f"Counted . ! ? occurrences -> {num_sentences} sentences",
        "value": float(num_sentences),
        "why": "Sentence structure/rhythm is a known stylometric signal for authorship detection.",
        "next": "Used directly as one input, and as the denominator for avg_sentence_length below.",
    })

    avg_sentence_len = num_words / num_sentences
    steps.append({
        "name": "avg_sentence_length",
        "raw_computation": f"word_count / sentence_count = {num_words} / {num_sentences} = {avg_sentence_len:.4f}",
        "value": avg_sentence_len,
        "why": "Sentence length variation is one of the strongest classic stylometric markers between writers/generators.",
        "next": "Used directly as one input value to the model.",
    })

    lexical_diversity = num_unique_words / num_words if num_words else 0.0
    steps.append({
        "name": "lexical_diversity",
        "raw_computation": f"unique_words / word_count = {num_unique_words} / {num_words} = {lexical_diversity:.4f}",
        "value": lexical_diversity,
        "why": "Measures vocabulary repetition. AI text sometimes shows different repetition patterns than human writing.",
        "next": "Used directly as one input value to the model.",
    })

    punct_ratio = num_punct / num_chars if num_chars else 0.0
    steps.append({
        "name": "punctuation_ratio",
        "raw_computation": f"punctuation_chars / char_count = {num_punct} / {num_chars} = {punct_ratio:.4f}",
        "value": punct_ratio,
        "why": "Punctuation density/style is another classic stylometric fingerprint.",
        "next": "Used directly as one input value to the model.",
    })

    upper_ratio = num_upper / num_chars if num_chars else 0.0
    steps.append({
        "name": "uppercase_ratio",
        "raw_computation": f"uppercase_chars / char_count = {num_upper} / {num_chars} = {upper_ratio:.4f}",
        "value": upper_ratio,
        "why": "Capitalization habits can differ between writers/generators.",
        "next": "Used directly as one input value to the model.",
    })

    values_so_far = ", ".join(f"{s['value']:.4f}" for s in steps)
    steps.append({
        "name": "assemble_vector",
        "raw_computation": f"[{values_so_far}]",
        "value": None,
        "why": "All 8 numbers are packed into a single vector -- this is the exact input the logistic regression model expects.",
        "next": "This vector is what gets encrypted next, so the server can compute the model's weighted sum without ever seeing these raw numbers.",
    })

    return steps
