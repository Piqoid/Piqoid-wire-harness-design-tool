"""Validation endpoints."""
from __future__ import annotations

import copy
import json

from fastapi import APIRouter, HTTPException

from ...core.serialization import canonical_load
from ...engine.validator import validate
from ...models.net import Net
from ...models.segment import Segment
from ...models.node import NodePort
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
def validate_hypothetical(payload: dict) -> dict:
    """
    Pre-validation for wiring-mode hover.

    Payload: { harness_name, from_port_id, to_port_id }
    Returns: { severity: "ok"|"warn"|"error", message: str, rule_id: str|null }
    """
    harness_name = payload.get("harness_name", "")
    from_port_id = payload.get("from_port_id", "")
    to_port_id   = payload.get("to_port_id", "")

    proj = get_project()
    if harness_name not in proj.harnesses:
        return {"severity": "ok", "message": "", "rule_id": None}

    library_root = get_project_root() / "library"
    harness = proj.harnesses[harness_name]

    # Index ports
    port_index: dict[str, NodePort] = {p.id: p for p in harness.node_ports}
    from_port = port_index.get(from_port_id)
    to_port   = port_index.get(to_port_id)

    if not from_port or not to_port:
        return {"severity": "ok", "message": "", "rule_id": None}

    # Quick physical-layer / protocol check (E-003) from profiles
    profiles_dir = library_root / "profiles"
    profile_map: dict[str, dict] = {}
    if profiles_dir.exists():
        for f in profiles_dir.glob("*.json"):
            raw = json.loads(f.read_text(encoding="utf-8"))
            items = raw if isinstance(raw, list) else [raw]
            for item in items:
                if isinstance(item, dict) and "id" in item:
                    profile_map[item["id"]] = item

    fp = profile_map.get(from_port.profile_ref, {})
    tp = profile_map.get(to_port.profile_ref, {})

    fp_layer = fp.get("physical_layer", "")
    tp_layer = tp.get("physical_layer", "")
    fp_domain = fp.get("domain", "")
    tp_domain = tp.get("domain", "")
    passive_domains = {"passive", "no_connect"}

    if fp_layer and tp_layer and fp_layer != tp_layer:
        if fp_domain not in passive_domains and tp_domain not in passive_domains:
            return {
                "severity": "error",
                "rule_id": "E-003",
                "message": f"Physical layer mismatch: {fp_layer} ≠ {tp_layer}",
            }

    # Voltage check (E-001 simplified): is the other port's abs_max_v wide enough?
    def _abs_max(prof: dict):
        el = prof.get("electrical", {})
        return el.get("abs_max_v")

    def _operating(prof: dict):
        el = prof.get("electrical", {})
        return el.get("operating_v")

    fp_dir = fp.get("direction", "")
    tp_dir = tp.get("direction", "")
    driver_dirs = {"output", "bidirectional", "open_drain", "open_source"}
    power_domains = {"power", "ground"}

    fp_is_driver = fp_dir in driver_dirs or fp_domain in power_domains
    tp_is_driver = tp_dir in driver_dirs or tp_domain in power_domains

    if fp_is_driver:
        driver_v = _operating(fp)
        sink_abs  = _abs_max(tp)
        if driver_v and sink_abs:
            if driver_v[1] > sink_abs[1] or driver_v[0] < sink_abs[0]:
                return {
                    "severity": "error",
                    "rule_id": "E-001",
                    "message": f"Voltage out of range: driver {driver_v} V vs sink abs_max {sink_abs} V",
                }

    if tp_is_driver:
        driver_v = _operating(tp)
        sink_abs  = _abs_max(fp)
        if driver_v and sink_abs:
            if driver_v[1] > sink_abs[1] or driver_v[0] < sink_abs[0]:
                return {
                    "severity": "error",
                    "rule_id": "E-001",
                    "message": f"Voltage out of range: driver {driver_v} V vs sink abs_max {sink_abs} V",
                }

    # Check if they're already on the same net (loop)
    from_net = from_port.net_ref
    to_net   = to_port.net_ref
    if from_net and to_net and from_net == to_net:
        return {
            "severity": "warn",
            "rule_id": None,
            "message": "Ports are already on the same net — creates a redundant path",
        }

    return {"severity": "ok", "message": "Connection looks valid", "rule_id": None}
