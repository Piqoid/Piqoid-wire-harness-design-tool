"""Shared per-segment expected-current computation, used by P-001 (ampacity) and
P-002 (voltage drop). Not a diagnostic-producing rule itself -- pure numbers.

Priority, per §4 of the spec ("Current flows downstream from the source..."):
  1. An explicit net.constraints.expected_current_a overrides everything (flat
     across every segment of the net) -- the designer said what the number is.
  2. Exactly one declared source: root the net's segment graph there and sum
     downstream sink draws per segment (branches only carry what's below them).
  3. Zero or >1 sources: worst case -- total draw of every sink applied flat to
     every segment. (Matches PW-006's documented fallback for un-paralleled
     multi-source nets; zero-source signal nets get the same safe-direction
     treatment rather than being left at 0.)
"""
from __future__ import annotations

from ..models.net import Net
from ..models.node import NodePort
from ..models.signal import SignalProfile
from .graph import NetGraph


def compute_segment_currents(
    net: Net,
    member_ports: list[NodePort],
    net_graph: NetGraph,
    profiles: dict[str, SignalProfile],
) -> tuple[dict[str, float], int]:
    """Returns ({seg_id: expected_current_a}, source_count)."""
    seg_ids = list(net_graph.segments.keys())
    if not seg_ids:
        return {}, 0

    if net.constraints.expected_current_a is not None:
        flat = net.constraints.expected_current_a
        source_count = sum(
            1 for p in member_ports
            if (prof := profiles.get(p.profile_ref)) is not None
            and prof.electrical.i_supply_max_a is not None
        )
        return {sid: flat for sid in seg_ids}, source_count

    sources: list[NodePort] = []
    draws: dict[str, float] = {}
    for port in member_ports:
        prof = profiles.get(port.profile_ref)
        if prof is None:
            continue
        e = prof.electrical
        if e.i_supply_max_a is not None:
            sources.append(port)
        if e.i_draw_max_a is not None:
            draws[port.id] = e.i_draw_max_a

    if len(sources) == 1:
        seg_current = net_graph.current_load_per_segment(sources[0].id, draws)
        return {sid: seg_current.get(sid, 0.0) for sid in seg_ids}, 1

    total = sum(draws.values())
    return {sid: total for sid in seg_ids}, len(sources)
