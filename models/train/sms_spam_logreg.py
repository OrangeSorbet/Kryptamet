import os
import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from data.loaders import sms_spam

SAVE_DIR = "models/saved"


def train():
    X, y = sms_spam.load()
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    vectorizer = TfidfVectorizer(max_features=500)
    X_train_vec = vectorizer.fit_transform(X_train)
    X_test_vec = vectorizer.transform(X_test)

    model = LogisticRegression(max_iter=1000)
    model.fit(X_train_vec, y_train)

    train_acc = model.score(X_train_vec, y_train)
    test_acc = model.score(X_test_vec, y_test)

    os.makedirs(SAVE_DIR, exist_ok=True)
    with open(os.path.join(SAVE_DIR, "sms_spam_logreg.pkl"), "wb") as f:
        pickle.dump({"model": model, "vectorizer": vectorizer}, f)

    return train_acc, test_acc


if __name__ == "__main__":
    train_acc, test_acc = train()
    print(f"train_acc={train_acc:.4f} test_acc={test_acc:.4f}")
