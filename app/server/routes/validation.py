"""Validation endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ...engine.validator import validate
from ..state import get_project, get_project_root

router = APIRouter(prefix="/api")


@router.get("/validate/{harness_name}")
def validate_harness(harness_name: str) -> list:
    proj = get_project()
    if harness_name not in proj.harnesses:
        raise HTTPException(status_code=404, detail=f"Harness '{harness_name}' not found")
    library_root = get_project_root() / "library"
    diagnostics = validate(proj, harness_name=harness_name, library_root=library_root)
    return [d.as_dict() for d in diagnostics]


@router.post("/validate/hypothetical")
def validate_hypothetical(payload: dict) -> list:
    """
    Lightweight pre-validation for the wiring-mode hover (M2).
    For M1, returns empty — wiring mode is not yet implemented.
    """
    return []
