"""
.pqh portable project bundle — deterministic zip per §6.3.

Export: same project state → byte-identical .pqh (fixed zip timestamps, sorted entries).
Import modes: new | merge | library_only.
"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path
from typing import Any

from ..core.project_io import HarnessData, HarnessProject
from ..core.serialization import canonical_dump, canonical_dumps, canonical_load
from ..models.project import ProjectMeta

# Fixed timestamp so identical project state → identical zip bytes
_ZIP_TIME = (2000, 1, 1, 0, 0, 0)

MANIFEST_SCHEMA = 1


# ──────────────────────────────────────────────
#  Export
# ──────────────────────────────────────────────

def export_pqh(
    project: HarnessProject,
    harness_name: str,
    library_root: Path | None = None,
    harness_dir: Path | None = None,
) -> bytes:
    """
    Build a deterministic .pqh bundle for one harness.
    Returns raw zip bytes.

    Pass harness_dir so that layout.json (UI geometry) is included in the bundle.
    """
    harness = project.harnesses.get(harness_name)
    if harness is None:
        raise ValueError(f"Harness '{harness_name}' not found in project")

    # Collect all file contents we want to bundle
    entries: dict[str, bytes] = {}

    # project.json
    meta_json = json.loads(
        project.meta.model_dump_json(by_alias=True, exclude_none=True)
    ) if project.meta else {"id": harness_name, "name": harness_name, "schema_version": 1, "tag_defs": [], "display_rules": [], "waivers": []}
    entries["project.json"] = canonical_dumps(meta_json).encode("utf-8")

    # harness/<name>/*.json  (entity data)
    harness_files = _serialise_harness(harness)
    for fname, content in harness_files.items():
        entries[f"harness/{harness_name}/{fname}"] = content

    # harness/<name>/layout.json  (UI node/wire geometry — must round-trip)
    if harness_dir is not None:
        layout_path = harness_dir / "layout.json"
    elif project.root:
        layout_path = project.root / "harness" / harness_name / "layout.json"
    else:
        layout_path = None

    if layout_path and layout_path.exists():
        entries[f"harness/{harness_name}/layout.json"] = layout_path.read_bytes()

    # library snapshot (referenced profiles only)
    if library_root and library_root.exists():
        lib_entries = _snapshot_library(harness, library_root)
        for lpath, lcontent in lib_entries.items():
            entries[f"library/{lpath}"] = lcontent

    # compute per-file checksums
    checksums: dict[str, str] = {
        path: "sha256:" + hashlib.sha256(data).hexdigest()
        for path, data in entries.items()
    }

    # manifest
    manifest: dict[str, Any] = {
        "schema_version":    MANIFEST_SCHEMA,
        "format":            "pqh",
        "project_id":        meta_json.get("id", harness_name),
        "project_name":      meta_json.get("name", harness_name),
        "harness_names":     [harness_name],
        "library_snapshot":  {"mode": "referenced_only", "item_count": len(entries) - 1 - len(harness_files)},
        "checksums":         checksums,
    }
    entries["manifest.json"] = canonical_dumps(manifest).encode("utf-8")

    # Build deterministic zip: sorted entry names, fixed timestamps
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(entries):
            zi = zipfile.ZipInfo(name, date_time=_ZIP_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(zi, entries[name])

    return buf.getvalue()


def _serialise_harness(harness: HarnessData) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    writers = {
        "nodes":       harness.nodes,
        "node_ports":  harness.node_ports,
        "nets":        harness.nets,
        "segments":    harness.segments,
        "cables":      harness.cables,
        "bundles":     harness.bundles,
        "buses":       harness.buses,
        "pairs":       harness.pairs,
        "links":       harness.links,
        "splices":     harness.splices,
    }
    for fname, entities in writers.items():
        if entities:
            items = [json.loads(e.model_dump_json(by_alias=True, exclude_none=True)) for e in entities]
            out[f"{fname}.json"] = canonical_dumps(items).encode("utf-8")
    return out


def _snapshot_library(harness: HarnessData, library_root: Path) -> dict[str, bytes]:
    """Collect profiles that are actually referenced in this harness."""
    needed_profiles: set[str] = set()
    for port in harness.node_ports:
        needed_profiles.add(port.profile_ref)

    out: dict[str, bytes] = {}
    profiles_dir = library_root / "profiles"
    if not profiles_dir.exists():
        return out

    for f in sorted(profiles_dir.glob("*.json")):
        raw = json.loads(f.read_text(encoding="utf-8"))
        items = raw if isinstance(raw, list) else [raw]
        matched = [item for item in items if item.get("id") in needed_profiles]
        if matched:
            out[f"profiles/{f.name}"] = canonical_dumps(matched).encode("utf-8")

    return out


# ──────────────────────────────────────────────
#  Import
# ──────────────────────────────────────────────

def import_pqh(
    pqh_bytes: bytes,
    target_dir: Path,
    mode: str = "new",
    conflict_policy: str = "skip",
) -> dict[str, Any]:
    """
    Import a .pqh bundle.

    mode:
      new          — write everything into target_dir (must not exist or be empty)
      merge        — add harness into existing project in target_dir
      library_only — only extract library files

    conflict_policy (library items with same id but different version_hash):
      skip         — keep existing, record S-007
      import_new   — import as new version (suffixed id), record S-007
    """
    result: dict[str, Any] = {
        "mode": mode,
        "target": str(target_dir),
        "imported_harnesses": [],
        "library_conflicts": [],
        "diagnostics": [],
    }

    with zipfile.ZipFile(io.BytesIO(pqh_bytes), "r") as zf:
        names = zf.namelist()
        manifest_raw = json.loads(zf.read("manifest.json"))

        # Verify checksums
        checksums = manifest_raw.get("checksums", {})
        for path, expected_sum in checksums.items():
            if path == "manifest.json":
                continue
            if path not in names:
                continue
            data = zf.read(path)
            actual = "sha256:" + hashlib.sha256(data).hexdigest()
            if actual != expected_sum:
                result["diagnostics"].append({
                    "rule_id": "PKG-001",
                    "severity": "error",
                    "message": f"Checksum mismatch for {path}",
                    "entities": [path],
                })

        target_dir.mkdir(parents=True, exist_ok=True)

        if mode in ("new", "merge"):
            # Write project.json
            if "project.json" in names:
                _safe_write(target_dir / "project.json", zf.read("project.json"), mode)

            # Write harness files
            for name in names:
                if name.startswith("harness/"):
                    dest = target_dir / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    _safe_write(dest, zf.read(name), mode)
                    parts = Path(name).parts
                    if len(parts) >= 2:
                        hname = parts[1]
                        if hname not in result["imported_harnesses"]:
                            result["imported_harnesses"].append(hname)

        if mode in ("new", "merge", "library_only"):
            for name in names:
                if name.startswith("library/"):
                    dest = target_dir / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    conflict = _handle_library_file(dest, zf.read(name), conflict_policy)
                    if conflict:
                        result["library_conflicts"].append(conflict)
                        result["diagnostics"].append({
                            "rule_id": "S-007",
                            "severity": "warning",
                            "message": f"Library item version conflict in {name}: {conflict}",
                            "entities": [name],
                        })

    return result


def _safe_write(dest: Path, data: bytes, mode: str) -> None:
    if mode == "new" and dest.exists():
        return  # don't overwrite in new mode
    dest.write_bytes(data)


def _handle_library_file(dest: Path, incoming: bytes, policy: str) -> str | None:
    """
    Returns conflict description string if conflict, else None.
    Never silently overwrites a different version_hash.
    """
    if not dest.exists():
        dest.write_bytes(incoming)
        return None

    existing_raw  = json.loads(dest.read_bytes())
    incoming_raw  = json.loads(incoming)

    def get_hash(obj):
        if isinstance(obj, list):
            return {item.get("id"): item.get("version_hash") for item in obj}
        return {obj.get("id"): obj.get("version_hash")}

    existing_hashes  = get_hash(existing_raw)
    incoming_hashes  = get_hash(incoming_raw)

    conflicts = []
    for eid, ihash in incoming_hashes.items():
        ehash = existing_hashes.get(eid)
        if ehash is None:
            continue  # new item, no conflict
        if ehash == ihash:
            continue  # same version, skip
        conflicts.append(f"{eid}: existing={ehash!r} incoming={ihash!r}")

    if not conflicts:
        # Safe to write — either new items or identical hashes
        dest.write_bytes(incoming)
        return None

    # There is a conflict
    if policy == "import_new":
        # Merge: add incoming items with a suffix on conflicting IDs
        if isinstance(incoming_raw, list):
            for item in incoming_raw:
                if item.get("id") in existing_hashes and existing_hashes[item.get("id")] != item.get("version_hash"):
                    item["id"] = item["id"] + "_imported"
            merged = (existing_raw if isinstance(existing_raw, list) else [existing_raw]) + incoming_raw
            dest.write_bytes(canonical_dumps(merged).encode("utf-8"))

    # policy == "skip": do not overwrite
    return "; ".join(conflicts)


# ──────────────────────────────────────────────
#  Diff
# ──────────────────────────────────────────────

def diff_pqh(pqh_a: bytes, pqh_b: bytes) -> dict[str, Any]:
    """
    Compare two .pqh bundles by file checksums.
    Returns a dict with added/removed/changed/identical file lists.
    """
    def get_checksums(raw: bytes) -> dict[str, str]:
        with zipfile.ZipFile(io.BytesIO(raw), "r") as zf:
            manifest = json.loads(zf.read("manifest.json"))
        return manifest.get("checksums", {})

    a_sums = get_checksums(pqh_a)
    b_sums = get_checksums(pqh_b)

    all_keys = set(a_sums) | set(b_sums)
    added    = sorted(k for k in all_keys if k not in a_sums)
    removed  = sorted(k for k in all_keys if k not in b_sums)
    changed  = sorted(k for k in all_keys if k in a_sums and k in b_sums and a_sums[k] != b_sums[k])
    identical= sorted(k for k in all_keys if k in a_sums and k in b_sums and a_sums[k] == b_sums[k])

    return {
        "added":    added,
        "removed":  removed,
        "changed":  changed,
        "identical": identical,
        "summary":  f"+{len(added)} -{len(removed)} ~{len(changed)} ={len(identical)}",
    }
