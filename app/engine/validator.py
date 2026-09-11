"""Main validation entry point: pure function, no I/O."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..core.project_io import HarnessData, HarnessProject
from ..models.project import ProjectMeta, Waiver
from ..models.signal import SignalProfile
from .diagnostic import Diagnostic
from .graph import build_net_graphs
from .rules.electrical import check_e001, check_e002, check_e003
from .rules.power import check_pw001_pw005_pw007
from .rules.structural import check_s001, check_s003, check_s006


def load_profiles(library_root: Path) -> dict[str, SignalProfile]:
    """Load all signal profiles from library/profiles/."""
    profiles: dict[str, SignalProfile] = {}
    profiles_dir = library_root / "profiles"
    if not profiles_dir.exists():
        return profiles
    for f in sorted(profiles_dir.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        items = data if isinstance(data, list) else [data]
        for item in items:
            p = SignalProfile.model_validate(item)
            profiles[p.id] = p
    return profiles


def apply_waivers(
    diagnostics: list[Diagnostic],
    waivers: list[Waiver],
) -> list[Diagnostic]:
    """Mark diagnostics that are covered by a waiver."""
    from datetime import date
    today = date.today().isoformat()

    for diag in diagnostics:
        for waiver in waivers:
            if waiver.rule_id != diag.rule_id:
                continue
            # Check expiry
            if waiver.expires and waiver.expires < today:
                continue
            # Check target match (entity ref)
            target_ref = waiver.target.get("ref")
            if target_ref and target_ref not in diag.entities:
                continue
            diag.waived = True
            diag.waiver_reason = waiver.reason
            break
    return diagnostics


def validate(
    project: HarnessProject,
    harness_name: str | None = None,
    library_root: Path | None = None,
) -> list[Diagnostic]:
    """
    Run all M0 rules against a loaded project.

    pure function: no I/O beyond what was already loaded.
    Returns a list of Diagnostic objects (including info).
    """
    if library_root is None:
        library_root = project.root / "library"

    profiles = load_profiles(library_root)
    waivers = project.meta.waivers if project.meta else []

    all_diagnostics: list[Diagnostic] = []

    # Select which harnesses to validate
    harness_names = [harness_name] if harness_name else list(project.harnesses.keys())

    for hname in harness_names:
        harness = project.harnesses.get(hname)
        if harness is None:
            continue

        nets = harness.nets
        segments = harness.segments
        node_ports = harness.node_ports
        buses = harness.buses
        bundles = harness.bundles
        pairs = harness.pairs
        splices = harness.splices

        # Build net graphs once, reuse
        net_graphs = build_net_graphs(nets, segments, node_ports)

        # Electrical
        all_diagnostics.extend(check_e001(nets, node_ports, profiles))
        all_diagnostics.extend(check_e002(nets, node_ports, profiles))
        all_diagnostics.extend(check_e003(nets, node_ports, profiles))

        # Power
        all_diagnostics.extend(check_pw001_pw005_pw007(
            nets, node_ports, profiles, project.meta.rule_config if project.meta else None
        ))

        # Structural
        all_diagnostics.extend(check_s001(nets, segments, node_ports, net_graphs))
        all_diagnostics.extend(check_s003(segments, nets))
        all_diagnostics.extend(check_s006(
            nets, segments, node_ports, buses, bundles, pairs, splices,
            cables=harness.cables,
        ))

    apply_waivers(all_diagnostics, waivers)
    return all_diagnostics


def format_text(diagnostics: list[Diagnostic]) -> str:
    """Format diagnostics as human-readable text."""
    if not diagnostics:
        return "No diagnostics.\n"

    order = {"error": 0, "warning": 1, "info": 2}
    sorted_diags = sorted(diagnostics, key=lambda d: (order.get(d.severity, 9), d.rule_id))

    lines = []
    waived_count = sum(1 for d in diagnostics if d.waived)
    errors = [d for d in diagnostics if d.severity == "error" and not d.waived]
    warnings = [d for d in diagnostics if d.severity == "warning" and not d.waived]
    infos = [d for d in diagnostics if d.severity == "info"]

    lines.append(f"Validation results: {len(errors)} error(s), {len(warnings)} warning(s), "
                 f"{len(infos)} info(s), {waived_count} waived")
    lines.append("")

    for d in sorted_diags:
        prefix = "[WAIVED] " if d.waived else ""
        sev = d.severity.upper() if hasattr(d.severity, 'upper') else str(d.severity).upper()
        lines.append(f"  {prefix}{sev}  {d.rule_id}  {d.message}")
        if d.waiver_reason:
            lines.append(f"           waiver: {d.waiver_reason}")
    lines.append("")
    return "\n".join(lines)


def format_json(diagnostics: list[Diagnostic]) -> str:
    """Format diagnostics as JSON."""
    return json.dumps(
        [d.as_dict() for d in diagnostics],
        indent=2,
        ensure_ascii=False,
    ) + "\n"
