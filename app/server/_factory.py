"""Uvicorn factory function."""
from __future__ import annotations

from .app import create_app


def make():
    return create_app()
