"""Project and entity read endpoints."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from ...core.serialization import canonical_load
from ..state import get_project, get_harness_dir

router = APIRouter(prefix="/api")


@router.get("/project")
def get_project_meta() -> dict:
    proj = get_project()
    return {
        "meta": json.loads(proj.meta.model_dump_json(by_alias=True, exclude_none=True)),
        "harness_names": list(proj.harnesses.keys()),
    }


@router.get("/harness/{harness_name}")
def get_harness(harness_name: str) -> dict:
    proj = get_project()
    harness = proj.harnesses.get(harness_name)
    if harness is None:
        raise HTTPException(status_code=404, detail=f"Harness '{harness_name}' not found")

    def _ser(entities):
        return [json.loads(e.model_dump_json(by_alias=True, exclude_none=True)) for e in entities]

    return {
        "nodes":      _ser(harness.nodes),
        "node_ports": _ser(harness.node_ports),
        "nets":       _ser(harness.nets),
        "segments":   _ser(harness.segments),
        "cables":     _ser(harness.cables),
        "bundles":    _ser(harness.bundles),
        "buses":      _ser(harness.buses),
        "pairs":      _ser(harness.pairs),
        "links":      _ser(harness.links),
        "splices":    _ser(harness.splices),
    }


@router.get("/layout/{harness_name}")
def get_layout(harness_name: str) -> dict:
    layout_path = get_harness_dir() / "layout.json"
    if not layout_path.exists():
        return {"schema_version": 1, "nodes": {}, "splices": {}}
    return canonical_load(layout_path)


@router.get("/profiles")
def get_profiles() -> list:
    """Return all signal profiles from the library (searched relative to harness dir)."""
    # Walk up from harness dir looking for library/profiles
    hdir = get_harness_dir()
    for candidate in [hdir, hdir.parent, hdir.parent.parent]:
        profiles_dir = candidate / "library" / "profiles"
        if profiles_dir.exists():
            result = []
            for f in sorted(profiles_dir.glob("*.json")):
                data = json.loads(f.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    result.extend(data)
                else:
                    result.append(data)
            return result
    return []
