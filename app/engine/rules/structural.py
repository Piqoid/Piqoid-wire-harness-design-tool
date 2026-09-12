"""Structural rules: S-001 .. S-007 (S-004, S-005, S-007 partial/deferred — see docstrings)."""
from __future__ import annotations

from collections import defaultdict

from ...models.common import Severity
from ...models.net import Net
from ...models.node import NodePort
from ...models.segment import Segment
from ..diagnostic import Diagnostic
from ..graph import NetGraph, build_net_graphs


def check_s001(
    nets: list[Net],
    segments: list[Segment],
    node_ports: list[NodePort],
    net_graphs: dict[str, NetGraph] | None = None,
) -> list[Diagnostic]:
    """S-001: Net's segments do not span all member ports."""
    diagnostics = []
    if net_graphs is None:
        net_graphs = build_net_graphs(nets, segments, node_ports)

    for net in nets:
        g = net_graphs.get(net.id)
        if g is None:
            continue
        if not net.members:
            continue
        unreachable = g.unreachable_members()
        if unreachable:
            port_names = []
            for pid in unreachable:
                port = g.member_ports.get(pid)
                port_names.append(port.pin_name if port else pid)
            diagnostics.append(Diagnostic(
                rule_id="S-001",
                severity=Severity.error,
                message=(
                    f"Net '{net.name}': segment graph does not span all members; "
                    f"unreachable ports: {', '.join(port_names)}"
                ),
                entities=[net.id] + list(unreachable),
            ))
    return diagnostics


def check_s003(
    segments: list[Segment],
    nets: list[Net],
) -> list[Diagnostic]:
    """S-003: Orphan segment with no net_ref."""
    diagnostics = []
    net_ids = {n.id for n in nets}
    for seg in segments:
        if seg.net_ref is None or seg.net_ref not in net_ids:
            diagnostics.append(Diagnostic(
                rule_id="S-003",
                severity=Severity.error,
                message=(
                    f"Segment '{seg.id}' (label='{seg.label or ''}') has no valid net reference"
                ),
                entities=[seg.id],
            ))
    return diagnostics


def check_s006(
    nets: list[Net],
    segments: list[Segment],
    node_ports: list[NodePort],
    buses: list,
    bundles: list,
    pairs: list,
    splices: list,
    cables: list | None = None,
) -> list[Diagnostic]:
    """S-006: Dangling reference — any ref that points to a non-existent entity."""
    diagnostics = []
    all_ids: set[str] = set()
    extra = cables or []
    for e in [*nets, *segments, *node_ports, *buses, *bundles, *pairs, *splices, *extra]:
        all_ids.add(e.id)

    def _check(entity_id: str, ref: str | None, field_name: str) -> None:
        if ref and ref not in all_ids:
            diagnostics.append(Diagnostic(
                rule_id="S-006",
                severity=Severity.error,
                message=f"Entity '{entity_id}': field '{field_name}' references unknown id '{ref}'",
                entities=[entity_id],
            ))

    for net in nets:
        for pid in net.members:
            _check(net.id, pid, "members")
        _check(net.id, net.bus_ref, "bus_ref")
        _check(net.id, net.pair_ref, "pair_ref")

    for seg in segments:
        _check(seg.id, seg.net_ref, "net_ref")
        _check(seg.id, seg.cable_ref, "cable_ref")
        for bref in seg.bundle_refs:
            _check(seg.id, bref, "bundle_refs")
        from_kind = seg.from_.kind if isinstance(seg.from_.kind, str) else seg.from_.kind.value
        to_kind = seg.to.kind if isinstance(seg.to.kind, str) else seg.to.kind.value
        if from_kind == "port":
            _check(seg.id, seg.from_.ref, "from.ref (port)")
        elif from_kind == "splice":
            _check(seg.id, seg.from_.ref, "from.ref (splice)")
        if to_kind == "port":
            _check(seg.id, seg.to.ref, "to.ref (port)")
        elif to_kind == "splice":
            _check(seg.id, seg.to.ref, "to.ref (splice)")

    for port in node_ports:
        if port.net_ref:
            _check(port.id, port.net_ref, "net_ref")

    for bundle in bundles:
        for sref in bundle.segment_refs:
            _check(bundle.id, sref, "segment_refs")
        for cref in bundle.cable_refs:
            _check(bundle.id, cref, "cable_refs")
        _check(bundle.id, bundle.parent_bundle_ref, "parent_bundle_ref")

    for pair in pairs:
        for role, nid in pair.nets.items():
            _check(pair.id, nid, f"nets.{role}")

    for splice in splices:
        _check(splice.id, splice.net_ref, "net_ref")
        _check(splice.id, splice.node_ref, "node_ref")

    return diagnostics


def check_s002(
    nets: list[Net],
    segments: list[Segment],
) -> list[Diagnostic]:
    """S-002: Net graph has a cycle and net is not marked `ring`. Detected via
    union-find over each net's segments: a segment whose two endpoints are
    already in the same connected component closes a cycle."""
    diagnostics = []
    segs_by_net: dict[str, list[Segment]] = defaultdict(list)
    for seg in segments:
        if seg.net_ref:
            segs_by_net[seg.net_ref].append(seg)

    for net in nets:
        if net.ring:
            continue
        net_segs = segs_by_net.get(net.id, [])
        if not net_segs:
            continue
        parent: dict[str, str] = {}

        def find(x: str) -> str:
            parent.setdefault(x, x)
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        cycle_segs = []
        for seg in net_segs:
            a, b = find(seg.from_.ref), find(seg.to.ref)
            if a == b:
                cycle_segs.append(seg)
            else:
                parent[a] = b

        if cycle_segs:
            diagnostics.append(Diagnostic(
                rule_id="S-002",
                severity=Severity.warning,
                message=(
                    f"Net '{net.name}': segment graph has a cycle "
                    f"({', '.join(s.id for s in cycle_segs)}) but net isn't marked ring=true"
                ),
                entities=[net.id] + [s.id for s in cycle_segs],
            ))
    return diagnostics


def check_s004(node_ports: list[NodePort]) -> list[Diagnostic]:
    """S-004: Connector cavity assigned twice. Cheap to check now: NodePort
    already carries (connector_ref, cavity) directly, no connector-library part
    registry needed for this one (unlike S-005/P-004, which do)."""
    diagnostics = []
    by_cavity: dict[tuple[str, int], list[NodePort]] = defaultdict(list)
    for port in node_ports:
        if port.connector_ref is not None and port.cavity is not None:
            by_cavity[(port.connector_ref, port.cavity)].append(port)

    for (connector_ref, cavity), ports in by_cavity.items():
        if len(ports) > 1:
            diagnostics.append(Diagnostic(
                rule_id="S-004",
                severity=Severity.error,
                message=(
                    f"Connector '{connector_ref}' cavity {cavity}: assigned to {len(ports)} ports "
                    f"({', '.join(p.pin_name for p in ports)})"
                ),
                entities=[p.id for p in ports],
            ))
    return diagnostics
