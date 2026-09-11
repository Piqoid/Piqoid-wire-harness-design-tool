"""Migration framework: numbered chain applied on load, written on save.

Each migration is a function (data: dict) -> dict.
Migrations are keyed by (file_type, from_version).
"""
from __future__ import annotations

from typing import Any, Callable

# Registry: (file_type, from_version) -> migration_fn
_MIGRATIONS: dict[tuple[str, int], Callable[[dict], dict]] = {}

CURRENT_SCHEMA_VERSION = 1


def register(file_type: str, from_version: int):
    """Decorator to register a migration from from_version -> from_version+1."""
    def decorator(fn: Callable[[dict], dict]) -> Callable[[dict], dict]:
        _MIGRATIONS[(file_type, from_version)] = fn
        return fn
    return decorator


def migrate(data: dict, file_type: str, target_version: int = CURRENT_SCHEMA_VERSION) -> dict:
    """Apply migrations until data reaches target_version."""
    version = data.get("schema_version", 1)
    if version > target_version:
        raise ValueError(
            f"File schema_version {version} is newer than tool supports ({target_version}). "
            "Please upgrade the tool."
        )
    while version < target_version:
        key = (file_type, version)
        if key not in _MIGRATIONS:
            raise ValueError(f"No migration registered for {file_type} v{version} -> v{version + 1}")
        data = _MIGRATIONS[key](data)
        version = data.get("schema_version", version + 1)
    return data


# --- Migrations ---

# M0 no-op: v1 is the initial version; no migration needed from v0->v1
# We register a proof-of-concept identity migration for the "project" type.

@register("project", 1)
def migrate_project_v1_to_v2(data: dict) -> dict:
    """Placeholder: no-op migration proving the chain works."""
    data = dict(data)
    data["schema_version"] = 2
    return data


# Similar stubs for harness entity files
for _ftype in ("nodes", "nets", "segments", "cables", "bundles", "buses", "pairs", "links", "splices", "node_ports"):
    def _make_stub(ft: str):
        @register(ft, 1)
        def _migration(data: dict, _ft=ft) -> dict:
            data = dict(data)
            data["schema_version"] = 2
            return data
        _migration.__name__ = f"migrate_{ft}_v1_to_v2"
        return _migration
    _make_stub(_ftype)
