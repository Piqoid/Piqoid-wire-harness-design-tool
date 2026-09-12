"""Bus / differential-pair rules: B-001 .. B-011."""
from __future__ import annotations

from ...models.bus import Bus
from ...models.common import Severity
from ...models.net import Net
from ...models.node import Node, NodePort
from ...models.pair import DifferentialPair
from ...models.segment import Segment
from ...models.signal import SignalProfile
from ..diagnostic import Diagnostic


def check_b001_b002_b003(
    pairs: list[DifferentialPair],
    nets: list[Net],
    segments: list[Segment],
) -> list[Diagnostic]:
    """B-001: pair member net missing. B-002: require_same_cable violated
    (approximated as: the set of cables carrying P segments must equal the set
    carrying N segments). B-003: skew — total conductor length of P vs N differs
    by more than max_skew_mm (approximates per-hop path comparison with a
    whole-net length comparison)."""
    diagnostics = []
    net_index = {n.id: n for n in nets}

    for pair in pairs:
        net_p_id = pair.nets.get("P")
        net_n_id = pair.nets.get("N")

        missing = [role for role, nid in pair.nets.items() if nid not in net_index]
        if missing:
            diagnostics.append(Diagnostic(
                rule_id="B-001",
                severity=Severity.error,
                message=f"Pair '{pair.id}': net(s) for role(s) {', '.join(missing)} do not exist",
                entities=[pair.id],
            ))
            continue

        net_p, net_n = net_index[net_p_id], net_index[net_n_id]
        segs_p = [s for s in segments if s.net_ref == net_p.id]
        segs_n = [s for s in segments if s.net_ref == net_n.id]

        if pair.require_same_cable:
            cables_p = {s.cable_ref for s in segs_p if s.cable_ref}
            cables_n = {s.cable_ref for s in segs_n if s.cable_ref}
            if cables_p != cables_n:
                diagnostics.append(Diagnostic(
                    rule_id="B-002",
                    severity=Severity.error,
                    message=(
                        f"Pair '{pair.id}': require_same_cable is set but P uses cables "
                        f"{sorted(cables_p) or '(none)'} while N uses {sorted(cables_n) or '(none)'}"
                    ),
                    entities=[pair.id, net_p.id, net_n.id],
                ))

        if pair.spec.max_skew_mm is not None:
            len_p = sum(s.length_mm or 0.0 for s in segs_p)
            len_n = sum(s.length_mm or 0.0 for s in segs_n)
            skew = abs(len_p - len_n)
            if skew > pair.spec.max_skew_mm:
                diagnostics.append(Diagnostic(
                    rule_id="B-003",
                    severity=Severity.warning,
                    message=(
                        f"Pair '{pair.id}': P total length {len_p:.1f} mm vs N total length "
                        f"{len_n:.1f} mm — skew {skew:.1f} mm exceeds max_skew_mm "
                        f"{pair.spec.max_skew_mm}"
                    ),
                    entities=[pair.id, net_p.id, net_n.id],
                ))
    return diagnostics


def check_b004_b005(buses: list[Bus]) -> list[Diagnostic]:
    """B-004: termination count mismatch. B-005: terminators not at topological
    extremes of a linear domain.

    B-006 (stub length over budget) is NOT implemented here: a linear/daisy
    domain has no stubs by definition (nothing to check), and a genuine 'star'
    domain needs a hub->leaf segment-path walk keyed by node/port that BusMember
    alone doesn't carry — approximating it risked exactly the kind of
    confidently-wrong result the spec warns against, so it's left as an honest
    gap rather than a rule that silently never fires. Revisit once a bus domain
    fixture with real star topology exists to design against.
    """
    diagnostics = []

    for bus in buses:
        for domain in bus.domains:
            if domain.termination is not None:
                terminated = [m for m in domain.members if m.terminated]
                if len(terminated) != domain.termination.required_count:
                    diagnostics.append(Diagnostic(
                        rule_id="B-004",
                        severity=Severity.error,
                        message=(
                            f"Bus '{bus.name}' domain '{domain.id}': {len(terminated)} terminator(s) "
                            f"present, {domain.termination.required_count} required"
                        ),
                        entities=[bus.id],
                    ))

            if domain.topology == "linear" and any(m.position is not None for m in domain.members):
                positioned = [m for m in domain.members if m.position is not None]
                if positioned:
                    lo = min(m.position for m in positioned)
                    hi = max(m.position for m in positioned)
                    terminated_positions = {m.position for m in positioned if m.terminated}
                    extreme_positions = {lo, hi}
                    if terminated_positions != extreme_positions:
                        diagnostics.append(Diagnostic(
                            rule_id="B-005",
                            severity=Severity.warning,
                            message=(
                                f"Bus '{bus.name}' domain '{domain.id}': terminators at positions "
                                f"{sorted(terminated_positions)}, expected exactly the topological "
                                f"extremes {sorted(extreme_positions)}"
                            ),
                            entities=[bus.id],
                        ))
    return diagnostics


def check_b007(buses: list[Bus], nodes: list[Node], node_ports: list[NodePort]) -> list[Diagnostic]:
    """B-007: Bus member's interface ports not connected to that domain's nets."""
    diagnostics = []
    node_index = {n.id: n for n in nodes}
    port_index = {p.id: p for p in node_ports}

    for bus in buses:
        for domain in bus.domains:
            domain_nets = set(domain.nets.values())
            for member in domain.members:
                node = node_index.get(member.node_ref)
                if node is None:
                    continue
                iface = next((i for i in node.interfaces if i.id == member.interface_ref), None)
                if iface is None:
                    continue
                for port_id in iface.port_refs:
                    port = port_index.get(port_id)
                    if port is None:
                        continue
                    if port.net_ref not in domain_nets:
                        diagnostics.append(Diagnostic(
                            rule_id="B-007",
                            severity=Severity.error,
                            message=(
                                f"Bus '{bus.name}' domain '{domain.id}': port '{port.pin_name}' "
                                f"(node '{node.name}', interface '{iface.name}') is on net "
                                f"'{port.net_ref}', not one of the domain's nets {sorted(domain_nets)}"
                            ),
                            entities=[bus.id, node.id, port.id],
                        ))
    return diagnostics


def check_b008(buses: list[Bus]) -> list[Diagnostic]:
    """B-008: Node count exceeds transceiver rated fan-out (domain.max_nodes)."""
    diagnostics = []
    for bus in buses:
        for domain in bus.domains:
            if domain.max_nodes is not None and len(domain.members) > domain.max_nodes:
                diagnostics.append(Diagnostic(
                    rule_id="B-008",
                    severity=Severity.warning,
                    message=(
                        f"Bus '{bus.name}' domain '{domain.id}': {len(domain.members)} nodes "
                        f"exceeds transceiver rated fan-out of {domain.max_nodes}"
                    ),
                    entities=[bus.id],
                ))
    return diagnostics


def check_b009(
    buses: list[Bus],
    nodes: list[Node],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """B-009: Bus bitrate > lowest bitrate_max declared among member ports."""
    diagnostics = []
    node_index = {n.id: n for n in nodes}
    port_index = {p.id: p for p in node_ports}

    for bus in buses:
        if bus.protocol.bitrate is None:
            continue
        limits = []
        for domain in bus.domains:
            for member in domain.members:
                node = node_index.get(member.node_ref)
                if node is None:
                    continue
                iface = next((i for i in node.interfaces if i.id == member.interface_ref), None)
                if iface is None:
                    continue
                for port_id in iface.port_refs:
                    port = port_index.get(port_id)
                    if port is None:
                        continue
                    prof = profiles.get(port.profile_ref)
                    if prof is None or prof.protocol is None or prof.protocol.bitrate_max is None:
                        continue
                    limits.append((port, prof.protocol.bitrate_max))
        if not limits:
            continue
        worst_port, worst_limit = min(limits, key=lambda pl: pl[1])
        if bus.protocol.bitrate > worst_limit:
            diagnostics.append(Diagnostic(
                rule_id="B-009",
                severity=Severity.error,
                message=(
                    f"Bus '{bus.name}': configured bitrate {bus.protocol.bitrate} exceeds "
                    f"port '{worst_port.pin_name}' bitrate_max {worst_limit}"
                ),
                entities=[bus.id, worst_port.id],
            ))
    return diagnostics


def check_b010_b011(buses: list[Bus]) -> list[Diagnostic]:
    """B-010: multi-domain bus with no bridge connecting all domains.
    B-011: declared bridge node isn't a member of both domains it bridges."""
    diagnostics = []

    for bus in buses:
        domain_ids = [d.id for d in bus.domains]
        members_by_domain = {d.id: {m.node_ref for m in d.members} for d in bus.domains}

        for bridge in bus.bridges:
            from_members = members_by_domain.get(bridge.from_domain, set())
            to_members = members_by_domain.get(bridge.to_domain, set())
            if bridge.node_ref not in from_members or bridge.node_ref not in to_members:
                diagnostics.append(Diagnostic(
                    rule_id="B-011",
                    severity=Severity.error,
                    message=(
                        f"Bus '{bus.name}': bridge node '{bridge.node_ref}' is not a member "
                        f"of both '{bridge.from_domain}' and '{bridge.to_domain}' domains"
                    ),
                    entities=[bus.id, bridge.node_ref],
                ))

        if len(domain_ids) > 1:
            # Union-find over domains connected by declared bridges.
            parent = {d: d for d in domain_ids}

            def find(x):
                while parent[x] != x:
                    x = parent[x]
                return x

            for bridge in bus.bridges:
                if bridge.from_domain in parent and bridge.to_domain in parent:
                    ra, rb = find(bridge.from_domain), find(bridge.to_domain)
                    if ra != rb:
                        parent[ra] = rb

            roots = {find(d) for d in domain_ids}
            if len(roots) > 1:
                diagnostics.append(Diagnostic(
                    rule_id="B-010",
                    severity=Severity.error,
                    message=(
                        f"Bus '{bus.name}': {len(domain_ids)} domains but bridges don't connect "
                        f"them all into one group (missing a bridge for at least one adjacency)"
                    ),
                    entities=[bus.id],
                ))
    return diagnostics
