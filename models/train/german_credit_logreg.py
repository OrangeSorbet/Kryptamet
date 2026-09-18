import os
import pickle
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from data.loaders import german_credit

SAVE_DIR = "models/saved"


def train():
    X, y = german_credit.load()
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    model = LogisticRegression(max_iter=1000)
    model.fit(X_train_scaled, y_train)

    train_acc = model.score(X_train_scaled, y_train)
    test_acc = model.score(X_test_scaled, y_test)

    os.makedirs(SAVE_DIR, exist_ok=True)
    with open(os.path.join(SAVE_DIR, "german_credit_logreg.pkl"), "wb") as f:
        pickle.dump({"model": model, "scaler": scaler}, f)

    return train_acc, test_acc


if __name__ == "__main__":
    train_acc, test_acc = train()
    print(f"train_acc={train_acc:.4f} test_acc={test_acc:.4f}")
