"""Power/current budget rules: PW-001 .. PW-007."""
from __future__ import annotations

from ...models.common import NetClass, Severity
from ...models.net import Net
from ...models.node import NodePort
from ...models.project import ProjectMeta, RuleConfig
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


def check_pw002_pw003_pw004_pw006(
    nets: list[Net],
    node_ports: list[NodePort],
    profiles: dict[str, SignalProfile],
    rule_config: RuleConfig | None = None,
) -> list[Diagnostic]:
    """PW-002: headroom warning; PW-003: typical-draw headroom warning;
    PW-004: inrush warning; PW-006: multiple unparalleled sources warning."""
    diagnostics = []
    port_index = {p.id: p for p in node_ports}
    cfg = rule_config or RuleConfig()

    for net in nets:
        if net.net_class != NetClass.power:
            continue
        member_ports = [port_index[pid] for pid in net.members if pid in port_index]
        if not member_ports:
            continue

        sources = []
        total_supply_max = 0.0
        total_supply_continuous = 0.0
        total_inrush = 0.0
        total_draw_max = 0.0
        total_draw_typ = 0.0

        for port in member_ports:
            prof = profiles.get(port.profile_ref)
            if prof is None:
                continue
            e = prof.electrical
            if e.i_supply_max_a is not None:
                sources.append(port)
                total_supply_max += e.i_supply_max_a
            if e.i_supply_continuous_a is not None:
                total_supply_continuous += e.i_supply_continuous_a
            if e.i_inrush_a is not None:
                total_inrush += e.i_inrush_a
            if e.i_draw_max_a is not None:
                total_draw_max += e.i_draw_max_a
            if e.i_draw_typ_a is not None:
                total_draw_typ += e.i_draw_typ_a

        if not sources:
            continue  # PW-005 already covers this case

        # PW-002: max draw vs continuous supply headroom threshold
        if total_supply_continuous > 0:
            used_pct = total_draw_max / total_supply_continuous * 100
            if used_pct > cfg.power_headroom_threshold_pct:
                diagnostics.append(Diagnostic(
                    rule_id="PW-002",
                    severity=Severity.warning,
                    message=(
                        f"Net '{net.name}': draw_max {total_draw_max:.3f} A is "
                        f"{used_pct:.1f}% of continuous supply capability "
                        f"{total_supply_continuous:.3f} A (threshold {cfg.power_headroom_threshold_pct:.0f}%)"
                    ),
                    entities=[net.id],
                ))

        # PW-003: typical draw vs continuous supply
        if total_supply_continuous > 0 and total_draw_typ > total_supply_continuous:
            diagnostics.append(Diagnostic(
                rule_id="PW-003",
                severity=Severity.warning,
                message=(
                    f"Net '{net.name}': typical draw {total_draw_typ:.3f} A exceeds "
                    f"continuous supply capability {total_supply_continuous:.3f} A"
                ),
                entities=[net.id],
            ))

        # PW-004: worst-case simultaneous inrush vs supply max * inrush factor
        if total_inrush > total_supply_max * cfg.inrush_factor:
            diagnostics.append(Diagnostic(
                rule_id="PW-004",
                severity=Severity.warning,
                message=(
                    f"Net '{net.name}': worst-case simultaneous inrush {total_inrush:.3f} A "
                    f"exceeds source capability {total_supply_max:.3f} A "
                    f"x inrush_factor {cfg.inrush_factor}"
                ),
                entities=[net.id],
            ))

        # PW-006: multiple sources without an explicit paralleled declaration
        if len(sources) > 1 and not net.paralleled:
            diagnostics.append(Diagnostic(
                rule_id="PW-006",
                severity=Severity.warning,
                message=(
                    f"Net '{net.name}': {len(sources)} sources "
                    f"({', '.join(p.pin_name for p in sources)}) without paralleled=true; "
                    f"current division not modelled, falling back to worst-case for ampacity"
                ),
                entities=[net.id] + [p.id for p in sources],
            ))

    return diagnostics
