import pandas as pd

RAW_PATH = "data/raw/german_credit.data"


def load():
    df = pd.read_csv(RAW_PATH, sep=" ", header=None)
    X = df.iloc[:, :-1]
    y = (df.iloc[:, -1] == 1).astype(int).values
    cat_cols = [c for c in X.columns if X[c].astype(str).str.match(r'^A\d+$').any()]
    X_encoded = pd.get_dummies(X, columns=cat_cols)
    return X_encoded.values.astype(float), y
