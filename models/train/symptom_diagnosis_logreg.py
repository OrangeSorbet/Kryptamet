import os
import pickle
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from data.loaders import symptom_diagnosis

SAVE_DIR = "models/saved"


def train():
    X, y = symptom_diagnosis.load(split="train")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = LogisticRegression(max_iter=2000)
    model.fit(X_train, y_train)

    train_acc = model.score(X_train, y_train)
    test_acc = model.score(X_test, y_test)

    os.makedirs(SAVE_DIR, exist_ok=True)
    with open(os.path.join(SAVE_DIR, "symptom_diagnosis_logreg.pkl"), "wb") as f:
        pickle.dump({"model": model}, f)

    return train_acc, test_acc


if __name__ == "__main__":
    train_acc, test_acc = train()
    print(f"train_acc={train_acc:.4f} test_acc={test_acc:.4f}")
