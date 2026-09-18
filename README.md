# Kryptamet

Homomorphic encryption (CKKS via TenSEAL) pipeline for privacy-preserving ML inference. Encrypted vectors are transported using an RSA+AES hybrid scheme. Models (logistic regression, small CNN) are trained on plaintext data, then benchmarked for encrypted inference cost across multiple datasets (MNIST, SMS spam, symptom-diagnosis, German Credit, price data, human-vs-AI text).

See `docs/checklist.md` for the roadmap, `docs/rules.md` for project rules, and `docs/logs.md` for a running log of all setup/build steps.

## First-Time Setup

1. **Install uv** (if not already installed): https://docs.astral.sh/uv/getting-started/installation/

2. **Sync dependencies** (creates/reuses `.venv`, installs from `pyproject.toml` + `uv.lock`):
   ```
   uv sync
   ```

3. **Download datasets**:
   ```
   uv run scripts/download.py
   ```
   This pulls MNIST, SMS spam, German Credit, symptom-diagnosis, and price data (via yfinance) into `data/raw/`.

4. **Manually download the human-vs-AI text dataset**:
   - Go to https://www.kaggle.com/datasets/shanegerami/ai-vs-human-text
   - Download the zip, extract it, and place `AI_Human.csv` at `data/raw/human_vs_ai_text/AI_Human.csv`
