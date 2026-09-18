import pandas as pd

TRAIN_PATH = "data/raw/symptom_diagnosis/Training.csv"
TEST_PATH = "data/raw/symptom_diagnosis/Testing.csv"


def load(split="train"):
    path = TRAIN_PATH if split == "train" else TEST_PATH
    df = pd.read_csv(path)
    df = df.dropna(axis=1, how="all")
    X = df.drop(columns=["prognosis"]).values
    y = df["prognosis"].astype("category").cat.codes.values
    return X, y
