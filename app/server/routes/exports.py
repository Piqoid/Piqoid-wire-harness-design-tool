"""Export download endpoints."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from ...core.project_io import HarnessData
from ...engine.validator import validate
from ...exports import (
    bom, connector_pinout, cut_list, netlist, report, svg_topology, wire_labels,
)
from ...exports import pqh as pqh_mod
from ..state import get_harness_dir, get_harness_name, get_project, is_loaded

router = APIRouter(prefix="/api/export")


def _harness() -> HarnessData:
    if not is_loaded():
        raise HTTPException(status_code=503, detail="No harness loaded")
    proj = get_project()
    name = get_harness_name()
    harness = proj.harnesses.get(name)
    if harness is None:
        raise HTTPException(status_code=404, detail=f"Harness '{name}' not in memory")
    return harness


def _library_root() -> Path:
    hdir = get_harness_dir()
    for candidate in [hdir / "library", hdir.parent / "library", hdir.parent.parent / "library"]:
        if candidate.exists():
            return candidate
    return hdir.parent / "library"


# ── Cut list ──────────────────────────────────

@router.get("/cut-list.csv")
def export_cut_list():
    data = cut_list.generate(_harness())
    return Response(
        content=data.encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cut_list.csv"},
    )


# ── BOM ───────────────────────────────────────

@router.get("/bom.csv")
def export_bom():
    data = bom.generate(_harness())
    return Response(
        content=data.encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=bom.csv"},
    )


# ── Netlist ───────────────────────────────────

@router.get("/netlist.csv")
def export_netlist_csv():
    data = netlist.generate_csv(_harness())
    return Response(
        content=data.encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=netlist.csv"},
    )


@router.get("/netlist.net")
def export_kicad_net():
    h = _harness()
    data = netlist.generate_kicad_net(h, harness_name=get_harness_name())
    return Response(
        content=data.encode("utf-8"),
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=netlist.net"},
    )


# ── Connector pinouts ─────────────────────────

@router.get("/pinouts.csv")
def export_pinouts_csv():
    data = connector_pinout.generate_combined_csv(_harness())
    return Response(
        content=data.encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=pinouts.csv"},
    )


@router.get("/pinouts.zip")
def export_pinouts_zip():
    data = connector_pinout.generate_all_zip(_harness())
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=pinouts.zip"},
    )


# ── Wire labels ───────────────────────────────

@router.get("/wire-labels.csv")
def export_wire_labels():
    data = wire_labels.generate(_harness())
    return Response(
        content=data.encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=wire_labels.csv"},
    )


# ── SVG topology ──────────────────────────────

@router.get("/topology.svg")
def export_svg():
    data = svg_topology.generate(_harness())
    return Response(
        content=data.encode("utf-8"),
        media_type="image/svg+xml",
        headers={"Content-Disposition": "attachment; filename=topology.svg"},
    )


# ── Validation report ─────────────────────────

@router.get("/report.json")
def export_report_json():
    proj = get_project()
    name = get_harness_name()
    diags = validate(proj, harness_name=name, library_root=_library_root())
    data = report.generate_json(diags)
    return Response(
        content=data.encode("utf-8"),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=report.json"},
    )


@router.get("/report.html")
def export_report_html():
    proj = get_project()
    name = get_harness_name()
    diags = validate(proj, harness_name=name, library_root=_library_root())
    data = report.generate_html(diags, harness_name=name)
    return Response(
        content=data.encode("utf-8"),
        media_type="text/html",
        headers={"Content-Disposition": f"attachment; filename=report_{name}.html"},
    )


# ── .pqh bundle ───────────────────────────────

@router.get("/bundle.pqh")
def export_bundle():
    proj      = get_project()
    name      = get_harness_name()
    hdir      = get_harness_dir()
    lib_root  = _library_root()
    data = pqh_mod.export_pqh(
        proj,
        harness_name=name,
        library_root=lib_root if lib_root.exists() else None,
        harness_dir=hdir,
    )
    fname = f"{name}.pqh"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.post("/import-bundle")
async def import_bundle(payload: dict):
    """
    Import a .pqh bundle.

    Payload: { path: str, mode: "new"|"merge"|"library_only", target_dir: str,
               conflict_policy: "skip"|"import_new" }
    """
    import base64

    pqh_path = Path(payload.get("path", ""))
    target   = Path(payload.get("target_dir", ""))
    mode     = payload.get("mode", "new")
    policy   = payload.get("conflict_policy", "skip")

    if not pqh_path.exists():
        raise HTTPException(status_code=400, detail=f"File not found: {pqh_path}")

    raw = pqh_path.read_bytes()
    result = pqh_mod.import_pqh(raw, target, mode=mode, conflict_policy=policy)
    return result
