"""Power/current budget rules: PW-001, PW-005, PW-007."""
from __future__ import annotations

from ...models.common import NetClass, Severity
from ...models.net import Net
from ...models.node import NodePort
from ...models.project import ProjectMeta
from ...models.signal import SignalProfile
from ..diagnostic import Diagnostic


def check_pw001_pw005_pw007(
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
    rule_config=None,
) -> list[Diagnostic]:
    """PW-001: supply exceeded; PW-005: no source on power net; PW-007: budget report."""
    diagnostics = []
    port_index = {p.id: p for p in node_ports}

    for net in nets:
        if net.net_class != NetClass.power:
            continue

        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        if not member_ports:
            continue

        total_supply_max = 0.0
        total_supply_continuous = 0.0
        total_draw_max = 0.0
        total_draw_typ = 0.0
        has_source = False

        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None:
                continue
            e = prof.electrical
            if e.i_supply_max_a is not None:
                total_supply_max += e.i_supply_max_a
                has_source = True
            if e.i_supply_continuous_a is not None:
                total_supply_continuous += e.i_supply_continuous_a
            if e.i_draw_max_a is not None:
                total_draw_max += e.i_draw_max_a
            if e.i_draw_typ_a is not None:
                total_draw_typ += e.i_draw_typ_a

        # PW-005: no source
        if not has_source:
            diagnostics.append(Diagnostic(
                rule_id="PW-005",
                severity=Severity.error,
                message=f"Net '{net.name}': power net has no source (no port declares i_supply_max_a)",
                entities=[net.id],
            ))
            continue

        # PW-001: supply exceeded
        if total_draw_max > total_supply_max:
            diagnostics.append(Diagnostic(
                rule_id="PW-001",
                severity=Severity.error,
                message=(
                    f"Net '{net.name}': total sink draw {total_draw_max:.3f} A exceeds "
                    f"source capability {total_supply_max:.3f} A"
                ),
                entities=[net.id],
            ))

        # PW-007: budget info (always emit)
        headroom_a = total_supply_max - total_draw_max
        used_pct = (total_draw_max / total_supply_max * 100) if total_supply_max > 0 else 0
        diagnostics.append(Diagnostic(
            rule_id="PW-007",
            severity=Severity.info,
            message=(
                f"Net '{net.name}' budget: supply_max={total_supply_max:.3f} A, "
                f"draw_max={total_draw_max:.3f} A ({used_pct:.1f}%), "
                f"headroom={headroom_a:.3f} A"
                + (f", draw_typ={total_draw_typ:.3f} A" if total_draw_typ > 0 else "")
            ),
            entities=[net.id],
        ))

    return diagnostics
