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
