"""Global server state — holds the loaded project."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from ..core.project_io import HarnessProject

_project: Optional[HarnessProject] = None
_project_root: Optional[Path] = None


def set_project(proj: HarnessProject) -> None:
    global _project, _project_root
    _project = proj
    _project_root = proj.root


def get_project() -> HarnessProject:
    if _project is None:
        raise RuntimeError("No project loaded")
    return _project


def get_project_root() -> Path:
    if _project_root is None:
        raise RuntimeError("No project loaded")
    return _project_root
