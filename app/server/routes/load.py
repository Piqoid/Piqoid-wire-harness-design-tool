"""Harness folder load/status endpoints."""
from __future__ import annotations

import logging
import subprocess
import sys
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


def _pick_folder(title: str) -> str | None:
    """
    Open a native folder-picker dialog.
    Always runs in a subprocess so macOS/tkinter main-thread restrictions don't apply.
    """
    if sys.platform == "darwin":
        script = f'POSIX path of (choose folder with prompt "{title}")'
        try:
            r = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=120,
            )
            path = r.stdout.strip().rstrip("/")
            return path if path else None
        except Exception as exc:
            raise RuntimeError(f"osascript dialog failed: {exc}")
    else:
        py_script = (
            "import tkinter as tk, sys\n"
            "from tkinter import filedialog\n"
            "root = tk.Tk(); root.withdraw()\n"
            "root.lift(); root.attributes('-topmost', True)\n"
            f"p = filedialog.askdirectory(title={title!r}, parent=root)\n"
            "root.destroy(); print(p, end='')"
        )
        try:
            r = subprocess.run(
                [sys.executable, "-c", py_script],
                capture_output=True, text=True, timeout=120,
            )
            return r.stdout.strip() or None
        except Exception as exc:
            raise RuntimeError(f"Folder dialog failed: {exc}")


def _pick_file(title: str, ext: str) -> str | None:
    """
    Open a native file-picker dialog filtered to a single extension.
    Always runs in a subprocess.
    """
    if sys.platform == "darwin":
        # osascript type filter accepts UTI strings or four-char codes; use plain prompt
        # and let the user pick any file (extension shown in title for guidance).
        script = f'POSIX path of (choose file with prompt "{title}")'
        try:
            r = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=120,
            )
            path = r.stdout.strip().rstrip("/")
            return path if path else None
        except Exception as exc:
            raise RuntimeError(f"osascript dialog failed: {exc}")
    else:
        filetypes = repr([("Bundle", f"*{ext}"), ("All files", "*.*")])
        py_script = (
            "import tkinter as tk, sys\n"
            "from tkinter import filedialog\n"
            "root = tk.Tk(); root.withdraw()\n"
            "root.lift(); root.attributes('-topmost', True)\n"
            f"p = filedialog.askopenfilename(title={title!r}, filetypes={filetypes}, parent=root)\n"
            "root.destroy(); print(p, end='')"
        )
        try:
            r = subprocess.run(
                [sys.executable, "-c", py_script],
                capture_output=True, text=True, timeout=120,
            )
            return r.stdout.strip() or None
        except Exception as exc:
            raise RuntimeError(f"File dialog failed: {exc}")


@router.post("/open-folder-dialog")
def open_folder_dialog() -> dict:
    """Open an OS folder-picker dialog and return the chosen path (or null)."""
    try:
        path = _pick_folder("Open Harness Folder")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"path": path}


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


@router.post("/open-pqh-dialog")
def open_pqh_dialog() -> dict:
    """Open an OS file-picker dialog filtered to .pqh files. Returns the chosen path or null."""
    try:
        path = _pick_file("Open .pqh Bundle", ".pqh")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"path": path}


@router.post("/import-and-load-pqh")
def import_and_load_pqh(body: dict) -> dict:
    """
    Import a .pqh bundle into a local folder and load it.

    Body: { pqh_path: str, target_dir?: str }
    If target_dir is omitted, a sibling folder named after the .pqh file is used.
    Returns: { harness_name: str, target_dir: str }
    """
    from ...exports.pqh import import_pqh

    pqh_path_str = (body.get("pqh_path") or "").strip()
    if not pqh_path_str:
        raise HTTPException(status_code=400, detail="pqh_path is required")

    pqh_path = Path(pqh_path_str)
    if not pqh_path.exists():
        raise HTTPException(status_code=400, detail=f"File not found: {pqh_path}")

    # Determine target directory
    target_str = (body.get("target_dir") or "").strip()
    if target_str:
        target_dir = Path(target_str)
    else:
        # Default: sibling folder named after the .pqh (without extension)
        target_dir = pqh_path.parent / pqh_path.stem

    try:
        raw = pqh_path.read_bytes()
        result = import_pqh(raw, target_dir, mode="new", conflict_policy="skip")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Pick the first imported harness
    harness_names = result.get("imported_harnesses", [])
    if not harness_names:
        raise HTTPException(status_code=400, detail="No harnesses found in bundle")

    harness_name = harness_names[0]
    harness_dir = target_dir / "harness" / harness_name

    if not harness_dir.exists():
        # Try target_dir itself as the harness folder
        harness_dir = target_dir

    try:
        loaded_name = do_load(harness_dir)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Extracted OK but load failed: {exc}")

    return {
        "harness_name": loaded_name,
        "target_dir": str(target_dir),
        "conflicts": result.get("library_conflicts", []),
        "diagnostics": result.get("diagnostics", []),
    }
