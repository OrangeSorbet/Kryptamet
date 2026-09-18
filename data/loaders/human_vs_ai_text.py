import pandas as pd

RAW_PATH = "data/raw/human_vs_ai_text/AI_Human.csv"


def load(nrows=None):
    df = pd.read_csv(RAW_PATH, nrows=nrows)
    X = df["text"].values
    y = df["generated"].astype(int).values
    return X, y
