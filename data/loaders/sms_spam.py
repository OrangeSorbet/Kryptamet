import pandas as pd

RAW_PATH = "data/raw/sms_spam/SMSSpamCollection"


def load():
    df = pd.read_csv(RAW_PATH, sep="\t", header=None, names=["label", "text"], encoding="latin1")
    X = df["text"].values
    y = (df["label"] == "spam").astype(int).values
    return X, y
