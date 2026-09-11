"""Uvicorn factory function."""
from __future__ import annotations

import os
from pathlib import Path

from .app import create_app


def make():
    root = Path(os.environ.get("HARNESS_PROJECT_ROOT", ".")).resolve()
    return create_app(root)
