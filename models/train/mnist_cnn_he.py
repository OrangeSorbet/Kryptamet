import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from data.loaders import mnist

SAVE_DIR = "models/saved"


class SquareActivation(nn.Module):
    def forward(self, x):
        return x * x


class HECompatibleCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 8, kernel_size=3, padding=1)
        self.conv2 = nn.Conv2d(8, 16, kernel_size=3, padding=1)
        self.pool = nn.AvgPool2d(2, 2)
        self.fc1 = nn.Linear(16 * 7 * 7, 64)
        self.fc2 = nn.Linear(64, 10)
        self.square = SquareActivation()

    def forward(self, x):
        x = self.pool(self.square(self.conv1(x)))
        x = self.pool(self.square(self.conv2(x)))
        x = x.view(x.size(0), -1)
        x = self.square(self.fc1(x))
        return self.fc2(x)


def train(epochs=5, batch_size=64, lr=0.0005):
    X_train, y_train = mnist.load(split="train")
    X_test, y_test = mnist.load(split="test")

    X_train_t = torch.tensor(X_train, dtype=torch.float32).view(-1, 1, 28, 28) / 255.0
    y_train_t = torch.tensor(y_train, dtype=torch.long)
    X_test_t = torch.tensor(X_test, dtype=torch.float32).view(-1, 1, 28, 28) / 255.0
    y_test_t = torch.tensor(y_test, dtype=torch.long)

    train_loader = DataLoader(TensorDataset(X_train_t, y_train_t), batch_size=batch_size, shuffle=True)

    model = HECompatibleCNN()
    optimizer = optim.Adam(model.parameters(), lr=lr)
    criterion = nn.CrossEntropyLoss()

    model.train()
    for epoch in range(epochs):
        total_loss = 0.0
        for xb, yb in train_loader:
            optimizer.zero_grad()
            out = model(xb)
            loss = criterion(out, yb)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        print(f"epoch {epoch+1}/{epochs} loss={total_loss/len(train_loader):.4f}")

    model.eval()
    with torch.no_grad():
        train_preds = model(X_train_t).argmax(dim=1)
        train_acc = (train_preds == y_train_t).float().mean().item()
        test_preds = model(X_test_t).argmax(dim=1)
        test_acc = (test_preds == y_test_t).float().mean().item()

    os.makedirs(SAVE_DIR, exist_ok=True)
    torch.save(model.state_dict(), os.path.join(SAVE_DIR, "mnist_cnn_he.pt"))

    return train_acc, test_acc


if __name__ == "__main__":
    train_acc, test_acc = train()
    print(f"train_acc={train_acc:.4f} test_acc={test_acc:.4f}")
