"""Structural rules: S-001, S-003, S-006."""
from __future__ import annotations

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

    return diagnostics
