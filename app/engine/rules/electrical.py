"""Electrical rules: E-001, E-002, E-003."""
from __future__ import annotations

from typing import Any

from ...models.common import Severity
from ...models.net import Net
from ...models.node import NodePort
from ...models.signal import SignalProfile
from ..diagnostic import Diagnostic


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
