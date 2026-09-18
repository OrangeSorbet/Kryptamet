import torch
import numpy as np
from hecrypto.ckks_context import create_context as _create_context


def create_context():
    return _create_context(poly_modulus_degree=32768, coeff_mod_bit_sizes=[60, 40, 40, 40, 40, 40, 60], global_scale_bits=40)
from inference.he_cnn_infer import run_encrypted_cnn
from data.loaders import mnist
from models.train.mnist_cnn_he import HECompatibleCNN

N_SAMPLES = 3


def main():
    model = HECompatibleCNN()
    model.load_state_dict(torch.load("models/saved/mnist_cnn_he.pt"))
    model.eval()

    X_test, y_test = mnist.load(split="test")
    context = create_context()

    correct_he = 0
    correct_plain = 0
    for i in range(N_SAMPLES):
        image = X_test[i].reshape(28, 28).astype(np.float32) / 255.0

        with torch.no_grad():
            plain_logits = model(torch.tensor(image).view(1, 1, 28, 28)).numpy()[0]
        plain_pred = int(np.argmax(plain_logits))

        he_logits = run_encrypted_cnn(context, image, model.state_dict())
        he_pred = int(np.argmax(he_logits))

        match = "PASS" if he_pred == plain_pred else "FAIL"
        print(f"sample {i}: true={y_test[i]} plain_pred={plain_pred} he_pred={he_pred} {match}")

        correct_he += int(he_pred == y_test[i])
        correct_plain += int(plain_pred == y_test[i])

    print(f"plain correct {correct_plain}/{N_SAMPLES}, he correct {correct_he}/{N_SAMPLES}")


if __name__ == "__main__":
    main()
