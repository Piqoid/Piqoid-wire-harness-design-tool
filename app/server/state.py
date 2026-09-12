"""Global server state — holds the loaded project and current harness directory."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from ..core.project_io import HarnessProject

_project: Optional[HarnessProject] = None
_project_root: Optional[Path] = None
_harness_dir: Optional[Path] = None
_harness_name: Optional[str] = None


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


def set_harness_dir(hdir: Path) -> None:
    global _harness_dir, _harness_name
    _harness_dir = hdir.resolve()
    _harness_name = hdir.name


def get_harness_dir() -> Path:
    if _harness_dir is None:
        raise RuntimeError("No harness loaded")
    return _harness_dir


def get_harness_name() -> str:
    if _harness_name is None:
        raise RuntimeError("No harness loaded")
    return _harness_name


def is_loaded() -> bool:
    return _harness_dir is not None and _project is not None
