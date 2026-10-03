"""Vercel entrypoint: Vercel loads the Flask `app` from this file. Locally, run `uv run python -m interface.app`."""
from interface.app import app  # noqa: F401
