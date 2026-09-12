"""Full CRUD for all harness entities, plus layout persistence."""
from __future__ import annotations

import json
import re
import secrets
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from ...core.project_io import HarnessData
from ...core.serialization import canonical_dump, canonical_load
from ...models.bundle import Bundle
from ...models.bus import Bus
from ...models.cable import Cable
from ...models.link import Link
from ...models.net import Net
from ...models.node import Node, NodePort
from ...models.pair import DifferentialPair
from ...models.segment import Segment
from ...models.splice import Splice
from ..state import get_project, get_harness_dir, get_harness_name

router = APIRouter(prefix="/api")

# ── entity type registry ──────────────────────────────────────────────────────

REGISTRY: dict[str, tuple[type, str, str]] = {
    # entity_type -> (ModelClass, attr_on_HarnessData, file_name)
    "nodes":       (Node,            "nodes",       "nodes"),
    "node_ports":  (NodePort,        "node_ports",  "node_ports"),
    "nets":        (Net,             "nets",        "nets"),
    "segments":    (Segment,         "segments",    "segments"),
    "splices":     (Splice,          "splices",     "splices"),
    "cables":      (Cable,           "cables",      "cables"),
    "bundles":     (Bundle,          "bundles",     "bundles"),
    "buses":       (Bus,             "buses",       "buses"),
    "pairs":       (DifferentialPair,"pairs",       "pairs"),
    "links":       (Link,            "links",       "links"),
}


def _get_harness(harness_name: str) -> HarnessData:
    proj = get_project()
    h = proj.harnesses.get(harness_name)
    if h is None:
        raise HTTPException(status_code=404, detail=f"Harness '{harness_name}' not found")
    return h


def _get_collection(harness: HarnessData, entity_type: str) -> list:
    info = REGISTRY.get(entity_type)
    if info is None:
        raise HTTPException(status_code=422, detail=f"Unknown entity type '{entity_type}'")
    _, attr, _ = info
    return getattr(harness, attr)


def _save_entity_file(harness_name: str, entity_type: str) -> None:
    """Write just the changed entity-type file to disk."""
    harness = _get_harness(harness_name)
    _, attr, fname = REGISTRY[entity_type]
    entities = getattr(harness, attr)
    hdir = get_harness_dir()
    hdir.mkdir(parents=True, exist_ok=True)
    items = [json.loads(e.model_dump_json(by_alias=True, exclude_none=True)) for e in entities]
    canonical_dump(items, hdir / f"{fname}.json")


def _notify_ws() -> None:
    """Nothing to push — the WS reloads from disk on 'refresh'. Client sends refresh after mutation."""
    pass


def gen_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


# ── CREATE ────────────────────────────────────────────────────────────────────

@router.post("/harness/{harness_name}/entities/{entity_type}")
def create_entity(harness_name: str, entity_type: str, body: dict) -> dict:
    info = REGISTRY.get(entity_type)
    if info is None:
        raise HTTPException(status_code=422, detail=f"Unknown entity type '{entity_type}'")
    model_cls, attr, _ = info

    # Auto-assign id if missing
    if "id" not in body or not body["id"]:
        prefix = entity_type.rstrip("s")  # nodes→node, segments→segment, etc.
        body["id"] = gen_id(prefix)

    try:
        entity = model_cls.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    harness = _get_harness(harness_name)
    collection = getattr(harness, attr)

    # Guard duplicate id
    if any(e.id == entity.id for e in collection):
        raise HTTPException(status_code=409, detail=f"Entity '{entity.id}' already exists")

    collection.append(entity)
    _save_entity_file(harness_name, entity_type)
    return json.loads(entity.model_dump_json(by_alias=True, exclude_none=True))


# ── UPDATE ────────────────────────────────────────────────────────────────────

@router.put("/harness/{harness_name}/entities/{entity_type}/{entity_id}")
def update_entity(harness_name: str, entity_type: str, entity_id: str, body: dict) -> dict:
    info = REGISTRY.get(entity_type)
    if info is None:
        raise HTTPException(status_code=422, detail=f"Unknown entity type '{entity_type}'")
    model_cls, attr, _ = info

    harness = _get_harness(harness_name)
    collection = getattr(harness, attr)
    idx = next((i for i, e in enumerate(collection) if e.id == entity_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")

    # Merge existing fields with updates
    existing = json.loads(collection[idx].model_dump_json(by_alias=True, exclude_none=True))
    existing.update(body)
    existing["id"] = entity_id  # never allow id change

    try:
        updated = model_cls.model_validate(existing)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    collection[idx] = updated
    _save_entity_file(harness_name, entity_type)
    return json.loads(updated.model_dump_json(by_alias=True, exclude_none=True))


# ── DELETE ────────────────────────────────────────────────────────────────────

@router.delete("/harness/{harness_name}/entities/{entity_type}/{entity_id}")
def delete_entity(harness_name: str, entity_type: str, entity_id: str) -> dict:
    info = REGISTRY.get(entity_type)
    if info is None:
        raise HTTPException(status_code=422, detail=f"Unknown entity type '{entity_type}'")
    _, attr, _ = info

    harness = _get_harness(harness_name)
    collection = getattr(harness, attr)
    before = len(collection)
    collection[:] = [e for e in collection if e.id != entity_id]
    if len(collection) == before:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")

    _save_entity_file(harness_name, entity_type)
    return {"deleted": entity_id}


# ── CREATE HARNESS ────────────────────────────────────────────────────────────

@router.post("/harness")
def create_harness(body: dict) -> dict:
    name = body.get("name", "").strip()
    if not name or not re.match(r"^[a-zA-Z0-9_-]+$", name):
        raise HTTPException(status_code=400, detail="Invalid harness name (letters, digits, _ and - only)")
    proj = get_project()
    if name in proj.harnesses:
        raise HTTPException(status_code=409, detail=f"Harness '{name}' already exists")
    harness_dir = get_harness_dir().parent / name
    harness_dir.mkdir(parents=True, exist_ok=True)
    for fname in HarnessData.ENTITY_FILES:
        path = harness_dir / f"{fname}.json"
        if not path.exists():
            canonical_dump([], path)
    layout_path = harness_dir / "layout.json"
    if not layout_path.exists():
        canonical_dump(
            {"schema_version": 1, "nodes": {}, "splices": {}, "edges": {}, "portSides": {}},
            layout_path,
        )
    proj.harnesses[name] = HarnessData.load(harness_dir)
    return {"name": name}


# ── LAYOUT SAVE ───────────────────────────────────────────────────────────────

@router.put("/layout/{harness_name}")
def save_layout(harness_name: str, body: dict) -> dict:
    proj = get_project()
    if harness_name not in proj.harnesses:
        raise HTTPException(status_code=404, detail=f"Harness '{harness_name}' not found")
    layout_path = get_harness_dir() / "layout.json"
    canonical_dump(body, layout_path)
    return {"saved": True}
