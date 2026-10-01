import pandas as pd

TRAIN_PATH = "data/raw/symptom_diagnosis/Training.csv"
TEST_PATH = "data/raw/symptom_diagnosis/Testing.csv"


def load_frame(split="train"):
    path = TRAIN_PATH if split == "train" else TEST_PATH
    return pd.read_csv(path).dropna(axis=1, how="all")


def load(split="train"):
    df = load_frame(split)
    X = df.drop(columns=["prognosis"]).values
    y = df["prognosis"].astype("category").cat.codes.values
    return X, y
