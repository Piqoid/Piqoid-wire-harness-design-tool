"""Electrical rules: E-001 .. E-010."""
from __future__ import annotations

from typing import Any

from ...models.bundle import Bundle
from ...models.common import Direction, Domain, NetClass, Severity
from ...models.net import Net
from ...models.node import NodePort
from ...models.pair import DifferentialPair
from ...models.segment import Segment
from ...models.signal import SignalProfile
from ..diagnostic import Diagnostic

DRIVER_DIRECTIONS = {Direction.output, Direction.open_drain, Direction.open_source, Direction.bidirectional}
POWER_DOMAINS = {Domain.power, Domain.ground}


def check_e001(
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """E-001: Tolerance. Net's worst-case voltage envelope ⊄ a member port's abs_max_v."""
    diagnostics = []
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        if not member_ports:
            continue

        # Compute the net voltage envelope: union of operating_v of DRIVER/source ports only.
        # Input ports are receivers — their operating_v is what they tolerate, not what they drive.
        from ...models.common import Direction, Domain
        DRIVER_DIRECTIONS = {Direction.output, Direction.open_drain, Direction.open_source, Direction.bidirectional}
        POWER_DOMAINS = {Domain.power, Domain.ground}

        driver_max = None
        driver_min = None
        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None:
                continue
            # Include power sources and all output/bidirectional ports
            is_driver = (
                prof.direction in DRIVER_DIRECTIONS
                or prof.domain in POWER_DOMAINS
            )
            if not is_driver:
                continue
            if prof.electrical.operating_v is not None:
                lo, hi = prof.electrical.operating_v
                driver_min = lo if driver_min is None else min(driver_min, lo)
                driver_max = hi if driver_max is None else max(driver_max, hi)

        # Check each port's abs_max_v contains the envelope
        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None:
                continue
            if prof.electrical.abs_max_v is None:
                continue
            abs_lo, abs_hi = prof.electrical.abs_max_v
            if driver_min is not None and driver_min < abs_lo:
                diagnostics.append(Diagnostic(
                    rule_id="E-001",
                    severity=Severity.error,
                    message=(
                        f"Net '{net.name}': port '{port.pin_name}' abs_max_v lower bound {abs_lo} V "
                        f"exceeded by net low voltage {driver_min:.3f} V"
                    ),
                    entities=[net.id, port.id],
                ))
            if driver_max is not None and driver_max > abs_hi:
                diagnostics.append(Diagnostic(
                    rule_id="E-001",
                    severity=Severity.error,
                    message=(
                        f"Net '{net.name}': port '{port.pin_name}' abs_max_v upper bound {abs_hi} V "
                        f"exceeded by net high voltage {driver_max:.3f} V"
                    ),
                    entities=[net.id, port.id],
                ))
    return diagnostics


def check_e002(
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """E-002: Logic levels. Per driver/receiver pair: V_OH >= V_IH and V_OL <= V_IL."""
    diagnostics = []
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        if not member_ports:
            continue

        from ...models.common import Direction
        drivers = []
        receivers = []
        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None:
                continue
            if prof.direction in (Direction.output, Direction.open_drain, Direction.open_source):
                drivers.append((port, prof))
            if prof.direction in (Direction.input, Direction.bidirectional):
                receivers.append((port, prof))

        for d_port, d_prof in drivers:
            for r_port, r_prof in receivers:
                # V_OH >= V_IH
                if (d_prof.electrical.v_oh_min is not None
                        and r_prof.electrical.v_ih_min is not None
                        and d_prof.electrical.v_oh_min < r_prof.electrical.v_ih_min):
                    diagnostics.append(Diagnostic(
                        rule_id="E-002",
                        severity=Severity.error,
                        message=(
                            f"Net '{net.name}': driver '{d_port.pin_name}' V_OH_min "
                            f"{d_prof.electrical.v_oh_min} V < receiver '{r_port.pin_name}' "
                            f"V_IH_min {r_prof.electrical.v_ih_min} V"
                        ),
                        entities=[net.id, d_port.id, r_port.id],
                    ))
                # V_OL <= V_IL
                if (d_prof.electrical.v_ol_max is not None
                        and r_prof.electrical.v_il_max is not None
                        and d_prof.electrical.v_ol_max > r_prof.electrical.v_il_max):
                    diagnostics.append(Diagnostic(
                        rule_id="E-002",
                        severity=Severity.error,
                        message=(
                            f"Net '{net.name}': driver '{d_port.pin_name}' V_OL_max "
                            f"{d_prof.electrical.v_ol_max} V > receiver '{r_port.pin_name}' "
                            f"V_IL_max {r_prof.electrical.v_il_max} V"
                        ),
                        entities=[net.id, d_port.id, r_port.id],
                    ))
    return diagnostics


def check_e003(
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """E-003: Protocol + physical layer compatibility.

    All non-passive ports on a net must share compatible protocol AND physical_layer.
    Compatibility means: same protocol name (if declared) AND same physical_layer
    (or one of them is None/unset/passive).
    """
    diagnostics = []
    port_index = {p.id: p for p in node_ports}

    from ...models.common import Direction, Domain

    for net in nets:
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        if not member_ports:
            continue

        # Collect non-passive port profiles
        active = []
        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None:
                continue
            if prof.domain in (Domain.passive, Domain.no_connect):
                continue
            if prof.direction in (Direction.passive, Direction.high_z):
                continue
            active.append((port, prof))

        if len(active) < 2:
            continue

        # Check physical_layer consistency: all must be the same or cross-layer combinations
        # Rule: a can_logic_3v3 port cannot join a can_hs_5v net
        layers = set(p.physical_layer for _, p in active)
        protocols = set(
            p.protocol.name for _, p in active if p.protocol is not None
        )

        # If multiple physical layers AND all have a protocol declared, check they are compatible
        if len(layers) > 1:
            # Build list of (layer, protocol) pairs for clear reporting
            for i, (p1, prof1) in enumerate(active):
                for p2, prof2 in active[i+1:]:
                    if prof1.physical_layer != prof2.physical_layer:
                        # Both have protocol: must be the same name to even attempt compatibility
                        proto1 = prof1.protocol.name if prof1.protocol else None
                        proto2 = prof2.protocol.name if prof2.protocol else None
                        # Different physical layers are only OK if:
                        # - at least one port has no protocol (generic digital), OR
                        # - they are in the same protocol family but different domains
                        #   (e.g. can_logic_3v3 + can_hs_5v would be caught here as an error)
                        # For M0: flag any two non-passive ports on the same net with different physical_layer
                        # AND both have a protocol declared (the transceiver case).
                        # The bus domain model prevents this at the data level, but validate anyway.
                        if proto1 is not None and proto2 is not None:
                            if proto1 != proto2:
                                diagnostics.append(Diagnostic(
                                    rule_id="E-003",
                                    severity=Severity.error,
                                    message=(
                                        f"Net '{net.name}': ports '{p1.pin_name}' ({prof1.physical_layer}, "
                                        f"protocol={proto1}) and '{p2.pin_name}' ({prof2.physical_layer}, "
                                        f"protocol={proto2}) have incompatible protocols"
                                    ),
                                    entities=[net.id, p1.id, p2.id],
                                ))
                            else:
                                # Same protocol name but different physical layer (e.g. can_logic_3v3 on can_hs_5v net)
                                diagnostics.append(Diagnostic(
                                    rule_id="E-003",
                                    severity=Severity.error,
                                    message=(
                                        f"Net '{net.name}': ports '{p1.pin_name}' (physical_layer={prof1.physical_layer}) "
                                        f"and '{p2.pin_name}' (physical_layer={prof2.physical_layer}) are on the same "
                                        f"net but have different physical layers — likely wrong domain"
                                    ),
                                    entities=[net.id, p1.id, p2.id],
                                ))
    return diagnostics


def check_e004(
    pairs: list[DifferentialPair],
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """E-004: Pair role. A `pair_role: P` port must land on the net registered as P
    (and likewise for N). Catches swapped CAN_H/CAN_L-style wiring."""
    diagnostics = []
    port_index = {p.id: p for p in node_ports}
    net_index = {n.id: n for n in nets}

    for pair in pairs:
        for role, net_id in pair.nets.items():
            net = net_index.get(net_id)
            if net is None:
                continue
            for pid in net.members:
                port = port_index.get(pid)
                if port is None:
                    continue
                prof = profiles.get(port.profile_ref)
                if prof is None or prof.diff_member is None:
                    continue
                if prof.diff_member.pair_role != role:
                    diagnostics.append(Diagnostic(
                        rule_id="E-004",
                        severity=Severity.error,
                        message=(
                            f"Pair '{pair.id}': port '{port.pin_name}' declares pair_role="
                            f"{prof.diff_member.pair_role} but sits on net '{net.name}', "
                            f"registered as {role}"
                        ),
                        entities=[pair.id, net.id, port.id],
                    ))
    return diagnostics


def check_e005(
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """E-005: Drive conflict. >=2 push-pull outputs on one net. Open-drain/open-source
    multiples are allowed (the model has no explicit pull-up declaration to check
    against, so they're treated as the designer's intentional escape hatch)."""
    diagnostics = []
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        push_pull = []
        for pid in net.members:
            port = port_index.get(pid)
            if port is None:
                continue
            prof = profiles.get(port.profile_ref)
            if prof is None:
                continue
            if prof.direction == Direction.output:
                push_pull.append(port)
        if len(push_pull) >= 2:
            diagnostics.append(Diagnostic(
                rule_id="E-005",
                severity=Severity.error,
                message=(
                    f"Net '{net.name}': {len(push_pull)} push-pull outputs drive the same "
                    f"net ({', '.join(p.pin_name for p in push_pull)})"
                ),
                entities=[net.id] + [p.id for p in push_pull],
            ))
    return diagnostics


def check_e006(
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """E-006: No driver. Net has only inputs, isn't power/ground, and has no
    declared_signal (i.e. nothing asserts this net's type/intent on the designer's
    behalf)."""
    diagnostics = []
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        if net.net_class in (NetClass.power, NetClass.ground):
            continue
        if net.declared_signal is not None:
            continue
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        if not member_ports:
            continue
        has_driver = False
        has_input = False
        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None:
                continue
            if prof.direction in DRIVER_DIRECTIONS or prof.domain in POWER_DOMAINS:
                has_driver = True
            if prof.direction == Direction.input:
                has_input = True
        if has_input and not has_driver:
            diagnostics.append(Diagnostic(
                rule_id="E-006",
                severity=Severity.warning,
                message=f"Net '{net.name}': only receivers present, no driver and no declared signal type",
                entities=[net.id],
            ))
    return diagnostics


def check_e007(
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """E-007: Floating port. Not on any net, not marked no_connect."""
    diagnostics = []
    for port in node_ports:
        if port.net_ref is not None:
            continue
        prof = profiles.get(port.profile_ref)
        if prof is not None and prof.domain == Domain.no_connect:
            continue
        diagnostics.append(Diagnostic(
            rule_id="E-007",
            severity=Severity.warning,
            message=f"Port '{port.pin_name}' ({port.id}) is not connected to any net and isn't marked no_connect",
            entities=[port.id],
        ))
    return diagnostics


def check_e008(
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """E-008: Reference mismatch. Ports on one signal net reference different grounds."""
    diagnostics = []
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        if net.net_class != NetClass.signal:
            continue
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        roles = {}
        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None or prof.reference_role is None:
                continue
            roles.setdefault(prof.reference_role, []).append(port)
        if len(roles) > 1:
            detail = "; ".join(f"{role}: {', '.join(p.pin_name for p in ports)}" for role, ports in roles.items())
            diagnostics.append(Diagnostic(
                rule_id="E-008",
                severity=Severity.warning,
                message=f"Net '{net.name}': members reference different grounds ({detail})",
                entities=[net.id] + [p.id for ports in roles.values() for p in ports],
            ))
    return diagnostics


def check_e009(
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
) -> list[Diagnostic]:
    """E-009: Analog range. Driver's operating_v range must fit within each receiver's
    operating_v range on an analog net.

    Current-loop sense-resistor declaration isn't modelled yet (no schema field for
    it), so that half of the rule can't be checked -- deliberately not approximated.
    """
    diagnostics = []
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        drivers = []
        receivers = []
        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None or prof.domain != Domain.analog:
                continue
            if prof.direction in DRIVER_DIRECTIONS:
                drivers.append((port, prof))
            if prof.direction in (Direction.input, Direction.bidirectional):
                receivers.append((port, prof))

        for d_port, d_prof in drivers:
            if d_prof.electrical.operating_v is None:
                continue
            d_lo, d_hi = d_prof.electrical.operating_v
            for r_port, r_prof in receivers:
                if r_prof.electrical.operating_v is None:
                    continue
                r_lo, r_hi = r_prof.electrical.operating_v
                if d_lo < r_lo or d_hi > r_hi:
                    diagnostics.append(Diagnostic(
                        rule_id="E-009",
                        severity=Severity.error,
                        message=(
                            f"Net '{net.name}': analog driver '{d_port.pin_name}' range "
                            f"[{d_lo}, {d_hi}] V exceeds receiver '{r_port.pin_name}' range "
                            f"[{r_lo}, {r_hi}] V"
                        ),
                        entities=[net.id, d_port.id, r_port.id],
                    ))
    return diagnostics


def check_e010(
    nets: list[Net],
    node_ports: list[NodePort],
    segments: list[Segment],
    profiles: dict[str, SignalProfile],
    bundles: list[Bundle],
) -> list[Diagnostic]:
    """E-010: Edge rate. Generic digital profile with max_edge_rate_ns on an
    unshielded external-tagged segment."""
    diagnostics = []
    port_index = {p.id: p for p in node_ports}
    bundle_index = {b.id: b for b in bundles}

    def _is_shielded(seg: Segment) -> bool:
        for bref in seg.bundle_refs:
            b = bundle_index.get(bref)
            if b and b.sheath and b.sheath.shield and b.sheath.shield.shielded:
                return True
        return False

    for net in nets:
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        fast_ports = []
        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None or prof.signal_integrity is None:
                continue
            if prof.signal_integrity.max_edge_rate_ns is not None:
                fast_ports.append(port)
        if not fast_ports:
            continue

        for seg in segments:
            if seg.net_ref != net.id:
                continue
            if str(seg.tags.get("placement")) != "external":
                continue
            if _is_shielded(seg):
                continue
            diagnostics.append(Diagnostic(
                rule_id="E-010",
                severity=Severity.warning,
                message=(
                    f"Segment '{seg.id}' on net '{net.name}' carries a fast edge-rate signal "
                    f"and is external-placement but unshielded"
                ),
                entities=[net.id, seg.id],
            ))
    return diagnostics
