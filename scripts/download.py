import os
import zipfile
import urllib.request
from torchvision import datasets

RAW_DIR = "data/raw"


def download_mnist():
    marker = os.path.join(RAW_DIR, "mnist", "MNIST", "raw", "train-images-idx3-ubyte")
    if os.path.exists(marker):
        print("mnist already exists, skipping")
        return
    datasets.MNIST(root=os.path.join(RAW_DIR, "mnist"), train=True, download=True)
    datasets.MNIST(root=os.path.join(RAW_DIR, "mnist"), train=False, download=True)


def download_sms_spam():
    if os.path.exists(os.path.join(RAW_DIR, "sms_spam", "SMSSpamCollection")):
        print("sms_spam already exists, skipping")
        return
    url = "https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip"
    zip_path = os.path.join(RAW_DIR, "sms_spam.zip")
    urllib.request.urlretrieve(url, zip_path)
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(os.path.join(RAW_DIR, "sms_spam"))
    os.remove(zip_path)


def download_german_credit():
    dest = os.path.join(RAW_DIR, "german_credit.data")
    if os.path.exists(dest):
        print("german_credit already exists, skipping")
        return
    url = "https://archive.ics.uci.edu/ml/machine-learning-databases/statlog/german/german.data"
    urllib.request.urlretrieve(url, dest)


def download_symptom_diagnosis():
    out_dir = os.path.join(RAW_DIR, "symptom_diagnosis")
    if os.path.exists(os.path.join(out_dir, "Training.csv")):
        print("symptom_diagnosis already exists, skipping")
        return
    base = "https://raw.githubusercontent.com/itachi9604/healthcare-chatbot/master/Data/"
    os.makedirs(out_dir, exist_ok=True)
    for fname in ["Training.csv", "Testing.csv"]:
        urllib.request.urlretrieve(base + fname, os.path.join(out_dir, fname))


def download_price_data(ticker="AAPL", period="5y"):
    dest = os.path.join(RAW_DIR, "price_data.csv")
    if os.path.exists(dest):
        print("price_data already exists, skipping")
        return
    import yfinance as yf
    df = yf.download(ticker, period=period)
    df.columns = df.columns.get_level_values(0)
    df.reset_index(inplace=True)
    df.to_csv(dest, index=False)


if __name__ == "__main__":
    os.makedirs(RAW_DIR, exist_ok=True)
    download_mnist()
    download_sms_spam()
    download_german_credit()
    download_symptom_diagnosis()
    download_price_data()
    print("Done: mnist, sms_spam, german_credit, symptom_diagnosis, price_data downloaded to data/raw/")