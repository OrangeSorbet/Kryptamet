import numpy as np
import pandas as pd

RAW_PATH = "data/raw/price_data.csv"
FEATURES = ["Open", "High", "Low", "Volume"]


def load():
    df = pd.read_csv(RAW_PATH, parse_dates=["Date"])
    df = df.sort_values("Date").reset_index(drop=True)
    X = df[FEATURES].values
    y = df["Close"].values
    return X, y


def direction(close):
    """1 if a day's close is above the previous day's close, else 0 (first day compares to itself)."""
    return (np.diff(close, prepend=close[0]) > 0).astype(int)
