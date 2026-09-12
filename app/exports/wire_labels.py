"""Wire label CSV for Brady/DYMO label printers."""
from __future__ import annotations

import csv
import io
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.project_io import HarnessData


# Brady B-595 / DYMO LabelWriter field layout
HEADERS = [
    "label_id", "line1", "line2", "line3",
    "net_name", "from_node", "from_pin", "to_node", "to_pin",
    "color", "gauge", "length_mm",
]


def generate(harness: "HarnessData") -> str:
    """Return UTF-8 CSV of wire labels, one row per segment."""
    port_map = {p.id: p for p in harness.node_ports}
    node_map = {n.id: n for n in harness.nodes}
    net_map  = {n.id: n for n in harness.nets}

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADERS, extrasaction="ignore")
    w.writeheader()

    for seg in harness.segments:
        net = net_map.get(seg.net_ref or "")

        def endpoint_label(ep) -> tuple[str, str]:
            if ep.kind == "port":
                port = port_map.get(ep.ref)
                if port:
                    node = node_map.get(port.node_ref)
                    node_label = (node.designator or node.name) if node else port.node_ref
                    return node_label, port.pin_name
            return ep.kind, ep.ref

        from_node, from_pin = endpoint_label(seg.from_)
        to_node,   to_pin   = endpoint_label(seg.to)

        c = seg.conductor
        g = c.gauge
        gauge_str = (f"AWG{g.awg}" if g and g.awg else (f"{g.mm2}mm²" if g and g.mm2 else ""))

        # line1: label or net name, line2: from→to, line3: gauge+color
        label_id = seg.label or seg.id
        line1 = seg.label or (net.name if net else "")
        line2 = f"{from_node}/{from_pin} → {to_node}/{to_pin}"
        line3 = f"{gauge_str} {c.color or ''}{('/' + c.stripe) if c.stripe else ''}".strip()

        w.writerow({
            "label_id":  label_id,
            "line1":     line1[:30],
            "line2":     line2[:40],
            "line3":     line3[:20],
            "net_name":  net.name if net else "",
            "from_node": from_node,
            "from_pin":  from_pin,
            "to_node":   to_node,
            "to_pin":    to_pin,
            "color":     c.color or "",
            "gauge":     gauge_str,
            "length_mm": seg.length_mm if seg.length_mm is not None else "",
        })

    return buf.getvalue()
