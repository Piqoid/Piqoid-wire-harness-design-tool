"""Sheath rules: SH-001 .. SH-007."""
from __future__ import annotations

from ...models.bundle import Bundle
from ...models.cable import Cable
from ...models.common import Severity
from ..diagnostic import Diagnostic

# Zones treated as "flexing" for SH-004. This project's tag_defs (project.json)
# don't define a dedicated 'flexing' tag key/value — 'zone' enumerates robot
# locations instead — so this maps the zones that actually flex in normal SCARA
# operation onto the existing vocabulary. Revisit if/when the tag manager (M3
# UI pass) adds a proper dynamic/static flag.
FLEXING_ZONES = {"wrist", "eoat"}


def check_sh001(bundles: list[Bundle]) -> list[Diagnostic]:
    diagnostics = []
    for b in bundles:
        if b.sheath is None or b.sheath.max_fill_pct is None or b.computed.fill_pct is None:
            continue
        if b.computed.fill_pct > b.sheath.max_fill_pct:
            diagnostics.append(Diagnostic(
                rule_id="SH-001",
                severity=Severity.error,
                message=(
                    f"Bundle '{b.name}': fill {b.computed.fill_pct:.1f}% exceeds sheath "
                    f"max_fill_pct {b.sheath.max_fill_pct:.1f}%"
                ),
                entities=[b.id],
            ))
    return diagnostics


def check_sh002(bundles: list[Bundle]) -> list[Diagnostic]:
    diagnostics = []
    for b in bundles:
        if b.sheath is None or b.sheath.shield is None:
            continue
        if b.sheath.shield.shielded and not b.sheath.shield.drain_net_ref:
            diagnostics.append(Diagnostic(
                rule_id="SH-002",
                severity=Severity.error,
                message=f"Bundle '{b.name}': sheath is shielded but declares no drain_net_ref",
                entities=[b.id],
            ))
    return diagnostics


def check_sh003(bundles: list[Bundle]) -> list[Diagnostic]:
    diagnostics = []
    for b in bundles:
        if b.sheath is None or b.sheath.temp_range_c is None or b.computed.max_ambient_c is None:
            continue
        lo, hi = b.sheath.temp_range_c
        if not (lo <= b.computed.max_ambient_c <= hi):
            diagnostics.append(Diagnostic(
                rule_id="SH-003",
                severity=Severity.error,
                message=(
                    f"Bundle '{b.name}': sheath temp_range_c [{lo}, {hi}] C doesn't contain "
                    f"bundle max_ambient_c {b.computed.max_ambient_c:.0f} C"
                ),
                entities=[b.id],
            ))
    return diagnostics


def check_sh004(bundles: list[Bundle]) -> list[Diagnostic]:
    diagnostics = []
    for b in bundles:
        if b.sheath is None:
            continue
        zone = b.tags.get("zone")
        if zone not in FLEXING_ZONES:
            continue
        drag_chain_rated = bool(b.sheath.mechanical and b.sheath.mechanical.drag_chain_rated)
        if not drag_chain_rated:
            diagnostics.append(Diagnostic(
                rule_id="SH-004",
                severity=Severity.warning,
                message=(
                    f"Bundle '{b.name}': routed through flexing zone '{zone}' but sheath "
                    f"isn't drag-chain-rated"
                ),
                entities=[b.id],
            ))
    return diagnostics


def check_sh005(bundles: list[Bundle]) -> list[Diagnostic]:
    diagnostics = []
    bundle_index = {b.id: b for b in bundles}
    for b in bundles:
        if b.parent_bundle_ref is None or b.sheath is None or b.sheath.outer_od_mm is None:
            continue
        parent = bundle_index.get(b.parent_bundle_ref)
        if parent is None or parent.sheath is None or parent.sheath.nominal_id_mm is None:
            continue
        if b.sheath.outer_od_mm > parent.sheath.nominal_id_mm:
            diagnostics.append(Diagnostic(
                rule_id="SH-005",
                severity=Severity.warning,
                message=(
                    f"Bundle '{b.name}': sheath OD {b.sheath.outer_od_mm:.1f} mm exceeds parent "
                    f"'{parent.name}' sheath inner capacity {parent.sheath.nominal_id_mm:.1f} mm"
                ),
                entities=[b.id, parent.id],
            ))
    return diagnostics


def check_sh006(bundles: list[Bundle], cables: list[Cable]) -> list[Diagnostic]:
    diagnostics = []
    cable_index = {c.id: c for c in cables}
    for b in bundles:
        if b.sheath is None or b.sheath.shield is None or not b.sheath.shield.shielded:
            continue
        bundle_drain = b.sheath.shield.drain_net_ref
        if not bundle_drain:
            continue
        for cref in b.cable_refs:
            cable = cable_index.get(cref)
            if cable is None or cable.shield is None or not cable.shield.drain_net_ref:
                continue
            if cable.shield.drain_net_ref != bundle_drain:
                diagnostics.append(Diagnostic(
                    rule_id="SH-006",
                    severity=Severity.warning,
                    message=(
                        f"Bundle '{b.name}': sheath drain net '{bundle_drain}' differs from "
                        f"cable '{cable.id}' shield drain net '{cable.shield.drain_net_ref}'"
                    ),
                    entities=[b.id, cable.id],
                ))
    return diagnostics


def check_sh007(bundles: list[Bundle]) -> list[Diagnostic]:
    """Info only: reports both lengths for visibility, never blocks anything."""
    diagnostics = []
    for b in bundles:
        if b.sheath is None or b.sheath.cut_length_mm is None or b.path_length_mm is None:
            continue
        if b.sheath.cut_length_mm != b.path_length_mm:
            diagnostics.append(Diagnostic(
                rule_id="SH-007",
                severity=Severity.info,
                message=(
                    f"Bundle '{b.name}': sheath cut length {b.sheath.cut_length_mm:.0f} mm "
                    f"!= path length {b.path_length_mm:.0f} mm"
                ),
                entities=[b.id],
            ))
    return diagnostics
