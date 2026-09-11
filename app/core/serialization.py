"""Canonical serialization: 2-space indent, sorted keys, arrays sorted by id, LF, trailing newline."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def _sort_value(v: Any) -> Any:
    """Recursively sort dicts by key, lists of dicts-with-id by id."""
    if isinstance(v, dict):
        return {k: _sort_value(val) for k, val in sorted(v.items())}
    if isinstance(v, list):
        items = [_sort_value(i) for i in v]
        # Sort list of dicts that have an "id" key
        if items and all(isinstance(i, dict) and "id" in i for i in items):
            items = sorted(items, key=lambda x: x["id"])
        return items
    return v


def canonical_dumps(obj: Any) -> str:
    """Serialize to canonical JSON string: sorted keys, sorted id-lists, 2-space indent, LF, trailing newline."""
    sorted_obj = _sort_value(obj)
    text = json.dumps(sorted_obj, indent=2, ensure_ascii=False)
    # Normalise to LF line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.endswith("\n"):
        text += "\n"
    return text


def canonical_dump(obj: Any, path: Path) -> None:
    """Write canonical JSON atomically (tmp+rename)."""
    text = canonical_dumps(obj)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def canonical_load(path: Path) -> Any:
    """Load JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
