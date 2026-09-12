"""Physical / thermal rules: P-001, P-002, P-003, P-005, P-006, P-007.

P-004 (terminal wire-range vs segment gauge) is NOT implemented: it needs a
terminal library part registry (`library/terminals/*.json`) that doesn't exist
yet — that's explicitly M5 scope ("Connectors, terminals, library versioning").
`SegmentTermination` today only carries a free-text `part_ref`/`crimp_spec`,
no structured wire-range to check against.
"""
from __future__ import annotations

from collections import defaultdict

from ...models.bundle import Bundle
from ...models.cable import Cable
from ...models.common import Direction, Domain, Severity
from ...models.net import Net
from ...models.node import NodePort
from ...models.project import RuleConfig
from ...models.segment import Segment
from ...models.signal import SignalProfile
from ..current import compute_segment_currents
from ..diagnostic import Diagnostic
from ..graph import NetGraph
from ..tables import (
    lookup_ambient_factor,
    lookup_base_ampacity,
    lookup_count_factor,
    lookup_resistance_ohm_per_km,
)


DRIVER_DIRECTIONS = {Direction.output, Direction.open_drain, Direction.open_source, Direction.bidirectional}
POWER_DOMAINS = {Domain.power, Domain.ground}


def _bundle_lookup(segment: Segment, bundles: list[Bundle]) -> list[Bundle]:
    bundle_index = {b.id: b for b in bundles}
    return [bundle_index[bref] for bref in segment.bundle_refs if bref in bundle_index]


def check_p001(
    nets: list[Net],
    segments: list[Segment],
    node_ports: list[NodePort],
    bundles: list[Bundle],
    net_graphs: dict[str, NetGraph],
    profiles: dict[str, SignalProfile],
    ampacity_table: dict | None,
    derating_table: dict | None,
    rule_config: RuleConfig | None = None,
) -> list[Diagnostic]:
    """P-001: Ampacity. Segment current exceeds derated rating for its gauge,
    insulation temp rating, ambient, and bundle conductor count.

    Segments whose gauge or insulation temperature rating is missing, or whose
    gauge falls outside the ampacity table's range, are silently skipped —
    "no data" is not the same as "no violation", and guessing here is exactly
    the "confidently wrong" failure mode the spec warns against.
    """
    diagnostics: list[Diagnostic] = []
    if not ampacity_table or not derating_table:
        return diagnostics
    cfg = rule_config or RuleConfig()
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        graph = net_graphs.get(net.id)
        if graph is None:
            continue
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        seg_currents, _ = compute_segment_currents(net, member_ports, graph, profiles)

        for seg in segments:
            if seg.net_ref != net.id:
                continue
            awg = seg.conductor.gauge.awg
            temp_c = seg.conductor.insulation.temp_rating_c
            if awg is None or temp_c is None:
                continue
            base = lookup_base_ampacity(ampacity_table, awg, temp_c)
            if base is None:
                continue

            seg_bundles = _bundle_lookup(seg, bundles)
            ambient_c = max(
                (b.computed.max_ambient_c for b in seg_bundles if b.computed.max_ambient_c is not None),
                default=cfg.ambient_c,
            )
            conductor_count = max(
                (b.computed.conductor_count for b in seg_bundles if b.computed.conductor_count is not None),
                default=1,
            )
            ambient_factor = lookup_ambient_factor(derating_table, temp_c, ambient_c)
            count_factor = lookup_count_factor(derating_table, conductor_count)
            derated = base * ambient_factor * count_factor

            current = seg_currents.get(seg.id, 0.0)
            if current > derated:
                diagnostics.append(Diagnostic(
                    rule_id="P-001",
                    severity=Severity.error,
                    message=(
                        f"Segment '{seg.id}' ({awg} AWG, {temp_c:.0f}C insulation): expected current "
                        f"{current:.3f} A exceeds derated ampacity {derated:.3f} A "
                        f"(base {base:.1f} A x ambient {ambient_factor:.2f} x bunching {count_factor:.2f}, "
                        f"ambient={ambient_c:.0f}C, {conductor_count} bundled conductors)"
                    ),
                    entities=[net.id, seg.id],
                ))
    return diagnostics


def check_p002(
    nets: list[Net],
    segments: list[Segment],
    node_ports: list[NodePort],
    net_graphs: dict[str, NetGraph],
    profiles: dict[str, SignalProfile],
    awg_table: dict | None,
) -> list[Diagnostic]:
    """P-002: Voltage drop. 2*rho*L*I / A (round trip) > net's max_voltage_drop_v.

    Only computed for nets with exactly one identifiable source — with zero or
    multiple sources there's no well-defined single path to accumulate
    resistance x current along (see PW-006 for the multi-source case)."""
    diagnostics: list[Diagnostic] = []
    if not awg_table:
        return diagnostics
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        if net.constraints.max_voltage_drop_v is None:
            continue
        graph = net_graphs.get(net.id)
        if graph is None:
            continue
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]

        sources = [
            p for p in member_ports
            if (prof := profiles.get(p.profile_ref)) is not None and prof.electrical.i_supply_max_a is not None
        ]
        if len(sources) != 1:
            continue
        source = sources[0]

        seg_currents, _ = compute_segment_currents(net, member_ports, graph, profiles)
        seg_by_id = {s.id: s for s in segments if s.net_ref == net.id}

        seg_drop_contribution: dict[str, float] = {}
        for seg_id, seg in seg_by_id.items():
            awg = seg.conductor.gauge.awg
            if awg is None or seg.length_mm is None:
                continue
            r_per_km = lookup_resistance_ohm_per_km(awg_table, awg)
            if r_per_km is None:
                continue
            r_seg = r_per_km * (seg.length_mm / 1_000_000.0)
            seg_drop_contribution[seg_id] = r_seg * seg_currents.get(seg_id, 0.0)

        cumulative = graph.cumulative_path_value(source.id, seg_drop_contribution)

        for port in member_ports:
            if port.id == source.id:
                continue
            accum = cumulative.get(port.id)
            if accum is None:
                continue
            drop_v = 2.0 * accum
            if drop_v > net.constraints.max_voltage_drop_v:
                diagnostics.append(Diagnostic(
                    rule_id="P-002",
                    severity=Severity.warning,
                    message=(
                        f"Net '{net.name}': round-trip voltage drop to port '{port.pin_name}' "
                        f"{drop_v:.3f} V exceeds max_voltage_drop_v {net.constraints.max_voltage_drop_v} V"
                    ),
                    entities=[net.id, port.id],
                ))
    return diagnostics


def check_p003(
    nets: list[Net],
    segments: list[Segment],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
    rule_config: RuleConfig | None = None,
) -> list[Diagnostic]:
    """P-003: Insulation voltage rating < net nominal_v x margin.

    A net has no `nominal_v` field of its own — nominal voltage lives on the
    driving ports' profiles (same place E-001 gets the net's voltage envelope
    from). We take the largest driver/power-port `nominal_v` on the net as its
    working voltage; nets with no declared nominal on any driver are skipped
    (nothing to compare against, not a violation)."""
    diagnostics = []
    cfg = rule_config or RuleConfig()
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        nominal_v = None
        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None:
                continue
            is_driver = prof.direction in DRIVER_DIRECTIONS or prof.domain in POWER_DOMAINS
            if not is_driver or prof.electrical.nominal_v is None:
                continue
            nominal_v = prof.electrical.nominal_v if nominal_v is None else max(nominal_v, prof.electrical.nominal_v)
        if nominal_v is None:
            continue

        required_v = abs(nominal_v) * cfg.insulation_voltage_margin
        for seg in segments:
            if seg.net_ref != net.id:
                continue
            rating_v = seg.conductor.insulation.rating_v
            if rating_v is None:
                continue
            if rating_v < required_v:
                diagnostics.append(Diagnostic(
                    rule_id="P-003",
                    severity=Severity.error,
                    message=(
                        f"Segment '{seg.id}' on net '{net.name}': insulation rated "
                        f"{rating_v:.0f} V < required {required_v:.0f} V "
                        f"({nominal_v:.0f} V nominal x {cfg.insulation_voltage_margin} margin)"
                    ),
                    entities=[net.id, seg.id],
                ))
    return diagnostics


def check_p005(segments: list[Segment], cables: list[Cable]) -> list[Diagnostic]:
    """P-005: Two segments on the same core of the same cable."""
    diagnostics = []
    by_cable_core: dict[tuple[str, int], list[Segment]] = defaultdict(list)
    for seg in segments:
        if seg.cable_ref and seg.cable_core is not None:
            by_cable_core[(seg.cable_ref, seg.cable_core)].append(seg)

    for (cable_ref, core), segs in by_cable_core.items():
        if len(segs) > 1:
            diagnostics.append(Diagnostic(
                rule_id="P-005",
                severity=Severity.error,
                message=(
                    f"Cable '{cable_ref}' core {core}: claimed by {len(segs)} segments "
                    f"({', '.join(s.id for s in segs)})"
                ),
                entities=[cable_ref] + [s.id for s in segs],
            ))
    return diagnostics


def check_p006(segments: list[Segment], bundles: list[Bundle]) -> list[Diagnostic]:
    """P-006: Solid-core conductor in a bundle whose sheath is flexible or
    drag-chain-rated (the schema's structured mechanical flags, used instead of
    a free-form 'flexing' tag value that isn't part of this project's tag_defs)."""
    diagnostics = []
    bundle_index = {b.id: b for b in bundles}

    for seg in segments:
        if seg.conductor.construction != "solid":
            continue
        for bref in seg.bundle_refs:
            bundle = bundle_index.get(bref)
            if bundle is None or bundle.sheath is None or bundle.sheath.mechanical is None:
                continue
            mech = bundle.sheath.mechanical
            if mech.flexible or mech.drag_chain_rated:
                diagnostics.append(Diagnostic(
                    rule_id="P-006",
                    severity=Severity.warning,
                    message=(
                        f"Segment '{seg.id}' is solid-core but bundle '{bundle.name}' is "
                        f"flexible/drag-chain-rated — solid conductors work-harden and break "
                        f"under repeated flex"
                    ),
                    entities=[seg.id, bundle.id],
                ))
    return diagnostics


def check_p007(segments: list[Segment], rule_config: RuleConfig | None = None) -> list[Diagnostic]:
    """P-007: Segment length missing where required by release policy."""
    diagnostics = []
    cfg = rule_config or RuleConfig()
    if not cfg.release_require_measured_lengths:
        return diagnostics
    for seg in segments:
        if seg.length_mm is None or str(seg.length_source) != "measured":
            diagnostics.append(Diagnostic(
                rule_id="P-007",
                severity=Severity.error,
                message=(
                    f"Segment '{seg.id}': release policy requires a measured length "
                    f"(length_mm={seg.length_mm}, length_source={seg.length_source})"
                ),
                entities=[seg.id],
            ))
    return diagnostics
