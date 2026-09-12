"""Flat netlist generators — CSV and KiCad .net format."""
from __future__ import annotations

import csv
import io
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.project_io import HarnessData


def generate_csv(harness: "HarnessData") -> str:
    """One row per (net, port) membership."""
    port_map = {p.id: p for p in harness.node_ports}
    node_map = {n.id: n for n in harness.nodes}

    headers = [
        "net_id", "net_name", "net_class",
        "port_id", "node_id", "node_name", "node_designator", "pin_name",
        "interface_ref", "profile_ref",
    ]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    w.writeheader()

    for net in harness.nets:
        for member_id in net.members:
            port = port_map.get(member_id)
            if not port:
                continue
            node = node_map.get(port.node_ref)
            w.writerow({
                "net_id":           net.id,
                "net_name":         net.name,
                "net_class":        net.net_class,
                "port_id":          port.id,
                "node_id":          port.node_ref,
                "node_name":        node.name if node else port.node_ref,
                "node_designator":  node.designator if node else "",
                "pin_name":         port.pin_name,
                "interface_ref":    port.interface_ref,
                "profile_ref":      port.profile_ref,
            })

    return buf.getvalue()


def generate_kicad_net(harness: "HarnessData", harness_name: str = "harness") -> str:
    """KiCad .net format (Pcbnew legacy netlist)."""
    port_map = {p.id: p for p in harness.node_ports}
    node_map = {n.id: n for n in harness.nodes}

    lines = [
        "(export (version D)",
        f'  (design (source "{harness_name}")',
        "  )",
        "  (components",
    ]

    for node in harness.nodes:
        desig = node.designator or node.id
        lines.append(f'    (comp (ref "{desig}")')
        lines.append(f'      (value "{node.name}")')
        if node.part_ref:
            lines.append(f'      (libsource (lib "") (part "{node.part_ref}"))')
        lines.append("    )")

    lines.append("  )")
    lines.append("  (nets")

    for net in harness.nets:
        lines.append(f'    (net (code "{net.id}") (name "{net.name}")')
        for member_id in net.members:
            port = port_map.get(member_id)
            if not port:
                continue
            node = node_map.get(port.node_ref)
            desig = node.designator if node else port.node_ref
            lines.append(f'      (node (ref "{desig}") (pin "{port.pin_name}"))')
        lines.append("    )")

    lines.append("  )")
    lines.append(")")

    return "\n".join(lines) + "\n"
