import os
import shutil
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


EMNIST_SPLIT = "balanced"  # 47 classes: 10 digits + 37 letters (look-alike lower/upper case merged)


def download_emnist():
    """NIST's official EMNIST archive (~560 MB); keeps only the balanced split's 5 files."""
    out_dir = os.path.join(RAW_DIR, "emnist")
    names = [f"emnist-{EMNIST_SPLIT}-{p}" for p in ("train-images-idx3-ubyte.gz", "train-labels-idx1-ubyte.gz",
                                                    "test-images-idx3-ubyte.gz", "test-labels-idx1-ubyte.gz", "mapping.txt")]
    if all(os.path.exists(os.path.join(out_dir, n)) for n in names):
        print("emnist already exists, skipping")
        return
    os.makedirs(out_dir, exist_ok=True)
    zip_path = os.path.join(RAW_DIR, "emnist_gzip.zip")
    if not os.path.exists(zip_path):
        # NIST answers 403 to urllib's default User-Agent.
        req = urllib.request.Request("https://biometrics.nist.gov/cs_links/EMNIST/gzip.zip",
                                     headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(zip_path + ".part", "wb") as out:
            shutil.copyfileobj(resp, out, 1 << 20)
        os.replace(zip_path + ".part", zip_path)
    with zipfile.ZipFile(zip_path, "r") as z:
        for info in z.infolist():
            base = os.path.basename(info.filename)
            if base in names:
                with z.open(info) as src, open(os.path.join(out_dir, base), "wb") as dst:
                    dst.write(src.read())
    os.remove(zip_path)


if __name__ == "__main__":
    os.makedirs(RAW_DIR, exist_ok=True)
    download_mnist()
    download_sms_spam()
    download_german_credit()
    download_symptom_diagnosis()
    download_price_data()
    download_emnist()
    print("Done: mnist, sms_spam, german_credit, symptom_diagnosis, price_data, emnist downloaded to data/raw/")