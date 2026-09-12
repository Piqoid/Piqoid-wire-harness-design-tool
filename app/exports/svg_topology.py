"""SVG harness topology diagram — nodes as boxes, segments as lines."""
from __future__ import annotations

import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.project_io import HarnessData

# Layout constants
NODE_W  = 140
NODE_H  = 40
H_GAP   = 80
V_GAP   = 60
MARGIN  = 40
FONT    = "monospace"


_NET_CLASS_COLORS = {
    "power":      "#dc2626",
    "ground":     "#1e293b",
    "signal":     "#3b82f6",
    "shield":     "#94a3b8",
    "no_connect": "#e5e7eb",
}


def generate(harness: "HarnessData") -> str:
    """Return an SVG string of the harness topology."""
    nodes    = harness.nodes
    segments = harness.segments
    splices  = harness.splices
    net_map  = {n.id: n for n in harness.nets}
    port_map = {p.id: p for p in harness.node_ports}

    # --- Assign grid positions (simple left-to-right, top-to-bottom) ---
    cols = max(1, math.ceil(math.sqrt(len(nodes) + len(splices))))
    positions: dict[str, tuple[float, float]] = {}

    items = [(n.id, n.designator or n.name, "node") for n in nodes]
    items += [(s.id, s.name or s.id, "splice") for s in splices]

    for i, (eid, _label, _kind) in enumerate(items):
        col = i % cols
        row = i // cols
        x = MARGIN + col * (NODE_W + H_GAP)
        y = MARGIN + row * (NODE_H + V_GAP)
        positions[eid] = (x, y)

    # canvas size
    max_x = max((x + NODE_W for x, _ in positions.values()), default=400) + MARGIN
    max_y = max((y + NODE_H for _, y in positions.values()), default=300) + MARGIN

    parts: list[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{max_x}" height="{max_y}" '
        f'font-family="{FONT}" font-size="11">'
    )
    parts.append(f'  <rect width="{max_x}" height="{max_y}" fill="#f8fafc"/>')

    # --- Draw segments as lines ---
    for seg in segments:
        net = net_map.get(seg.net_ref or "")
        color = _NET_CLASS_COLORS.get(net.net_class if net else "", "#64748b")
        if net and net.display and net.display.color:
            color = net.display.color
        stroke_w = 2

        def ep_center(ep) -> tuple[float, float] | None:
            if ep.kind == "port":
                port = port_map.get(ep.ref)
                if port:
                    pos = positions.get(port.node_ref)
                    if pos:
                        return pos[0] + NODE_W / 2, pos[1] + NODE_H / 2
            elif ep.kind == "splice":
                pos = positions.get(ep.ref)
                if pos:
                    return pos[0] + NODE_W / 2, pos[1] + NODE_H / 2
            return None

        p1 = ep_center(seg.from_)
        p2 = ep_center(seg.to)
        if p1 and p2:
            label = seg.label or ""
            mid_x = (p1[0] + p2[0]) / 2
            mid_y = (p1[1] + p2[1]) / 2
            parts.append(
                f'  <line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" '
                f'x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" '
                f'stroke="{color}" stroke-width="{stroke_w}" opacity="0.8"/>'
            )
            if label:
                parts.append(
                    f'  <text x="{mid_x:.1f}" y="{mid_y - 3:.1f}" '
                    f'text-anchor="middle" fill="{color}" font-size="9">{_esc(label)}</text>'
                )

    # --- Draw nodes ---
    for node in nodes:
        pos = positions.get(node.id)
        if not pos:
            continue
        x, y = pos
        label = (node.designator or "") + (" " if node.designator else "") + node.name
        parts.append(
            f'  <rect x="{x}" y="{y}" width="{NODE_W}" height="{NODE_H}" '
            f'rx="4" fill="#1e3a5f" stroke="#3b82f6" stroke-width="1.5"/>'
        )
        parts.append(
            f'  <text x="{x + NODE_W/2:.1f}" y="{y + NODE_H/2 + 4:.1f}" '
            f'text-anchor="middle" fill="#e2e8f0">{_esc(label[:20])}</text>'
        )

    # --- Draw splices ---
    for splice in splices:
        pos = positions.get(splice.id)
        if not pos:
            continue
        x, y = pos
        cx, cy = x + NODE_W / 2, y + NODE_H / 2
        r = 10
        parts.append(
            f'  <circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" '
            f'fill="#fbbf24" stroke="#d97706" stroke-width="1.5"/>'
        )
        lbl = splice.name or splice.id
        parts.append(
            f'  <text x="{cx:.1f}" y="{cy + 4:.1f}" '
            f'text-anchor="middle" fill="#1e293b" font-size="9">{_esc(lbl[:8])}</text>'
        )

    parts.append("</svg>")
    return "\n".join(parts)


def _esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
    )
