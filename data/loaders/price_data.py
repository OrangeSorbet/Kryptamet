import pandas as pd

RAW_PATH = "data/raw/price_data.csv"


def load():
    df = pd.read_csv(RAW_PATH, parse_dates=["Date"])
    df = df.sort_values("Date").reset_index(drop=True)
    X = df[["Open", "High", "Low", "Volume"]].values
    y = df["Close"].values
    return X, y
