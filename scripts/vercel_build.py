"""Vercel build step (vercel.json buildCommand): copies interface/static to public/static so Vercel's CDN
serves /static/... directly (Flask's url_for('static') paths stay the same). Idempotent: replaces public/static."""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "interface" / "static"
DST = ROOT / "public" / "static"


def main():
    if DST.exists():
        shutil.rmtree(DST)
    shutil.copytree(SRC, DST, ignore=shutil.ignore_patterns(".omc", "__pycache__"))
    n = sum(1 for p in DST.rglob("*") if p.is_file())
    print(f"copied {n} static files to {DST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
