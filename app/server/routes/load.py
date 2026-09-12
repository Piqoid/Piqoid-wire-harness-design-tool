"""Harness folder load/status endpoints."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ...core.project_io import HarnessData, HarnessProject
from ...models.project import ProjectMeta
from ..state import (
    get_harness_dir,
    get_harness_name,
    is_loaded,
    set_harness_dir,
    set_project,
)

router = APIRouter(prefix="/api")
log = logging.getLogger(__name__)

# Persists the last-opened harness path across server restarts.
LAST_HARNESS_FILE = Path(__file__).parent.parent.parent.parent / ".last_harness"


def do_load(folder: Path) -> str:
    """Load a harness folder into global state. Returns the harness name."""
    folder = folder.resolve()
    if not folder.is_dir():
        raise ValueError(f"Not a directory: {folder}")

    harness_name = folder.name
    harness_data = HarnessData.load(folder)

    # Try to load project.json from parent; fall back to synthetic meta.
    try:
        proj = HarnessProject.load(folder.parent)
    except (FileNotFoundError, Exception):
        proj = HarnessProject(folder.parent)
        proj.meta = ProjectMeta(id=harness_name, name=harness_name)

    proj.harnesses = {harness_name: harness_data}
    set_project(proj)
    set_harness_dir(folder)

    try:
        LAST_HARNESS_FILE.write_text(str(folder), encoding="utf-8")
    except Exception:
        pass

    log.info("Loaded harness '%s' from %s", harness_name, folder)
    return harness_name


@router.get("/status")
def get_status() -> dict:
    if not is_loaded():
        return {"loaded": False}
    return {
        "loaded": True,
        "harness_name": get_harness_name(),
        "harness_dir": str(get_harness_dir()),
    }


@router.post("/open-folder-dialog")
def open_folder_dialog() -> dict:
    """Open an OS folder-picker dialog and return the chosen path (or null)."""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.lift()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title="Open Harness Folder", parent=root)
        root.destroy()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Dialog failed: {exc}")

    return {"path": folder if folder else None}


@router.post("/load-folder")
def load_folder(body: dict) -> dict:
    """Load a harness from the given folder path."""
    path_str = (body.get("path") or "").strip()
    if not path_str:
        raise HTTPException(status_code=400, detail="path is required")
    try:
        harness_name = do_load(Path(path_str))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"harness_name": harness_name}
