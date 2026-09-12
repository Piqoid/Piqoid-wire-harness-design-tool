"""Connector pinout tables — one CSV per node."""
from __future__ import annotations

import csv
import io
import zipfile
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.project_io import HarnessData


def generate_node_pinout(harness: "HarnessData", node_id: str) -> str:
    """CSV pinout for a single node."""
    node_map = {n.id: n for n in harness.nodes}
    node = node_map.get(node_id)
    if not node:
        return ""

    net_map = {n.id: n for n in harness.nets}
    ports = [p for p in harness.node_ports if p.node_ref == node_id]
    ports.sort(key=lambda p: p.pin_name)

    headers = ["pin_name", "interface", "profile_ref", "net_id", "net_name", "net_class", "direction", "tags"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    w.writeheader()

    for port in ports:
        net = net_map.get(port.net_ref or "")
        w.writerow({
            "pin_name":   port.pin_name,
            "interface":  port.interface_ref,
            "profile_ref": port.profile_ref,
            "net_id":     net.id if net else "",
            "net_name":   net.name if net else "",
            "net_class":  net.net_class if net else "",
            "direction":  "",  # would come from resolved profile
            "tags":       "|".join(f"{k}={v}" for k, v in port.tags.items()),
        })

    return buf.getvalue()


def generate_all_zip(harness: "HarnessData") -> bytes:
    """ZIP of one CSV per node, named by designator or id."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for node in harness.nodes:
            fname = f"{node.designator or node.id}_pinout.csv"
            csv_text = generate_node_pinout(harness, node.id)
            zf.writestr(fname, csv_text.encode("utf-8"))
    return buf.getvalue()


def generate_combined_csv(harness: "HarnessData") -> str:
    """Single CSV with all pinouts, with a node_id/designator column prepended."""
    node_map = {n.id: n for n in harness.nodes}
    net_map  = {n.id: n for n in harness.nets}
    ports    = harness.node_ports

    headers = [
        "node_id", "node_name", "designator",
        "pin_name", "interface", "profile_ref",
        "net_id", "net_name", "net_class", "tags",
    ]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    w.writeheader()

    for port in sorted(ports, key=lambda p: (p.node_ref, p.pin_name)):
        node = node_map.get(port.node_ref)
        net  = net_map.get(port.net_ref or "")
        w.writerow({
            "node_id":    port.node_ref,
            "node_name":  node.name if node else port.node_ref,
            "designator": node.designator if node else "",
            "pin_name":   port.pin_name,
            "interface":  port.interface_ref,
            "profile_ref": port.profile_ref,
            "net_id":     net.id if net else "",
            "net_name":   net.name if net else "",
            "net_class":  net.net_class if net else "",
            "tags":       "|".join(f"{k}={v}" for k, v in port.tags.items()),
        })

    return buf.getvalue()
