"""Bill of materials generator — nodes, cables, bundles sheath parts."""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.project_io import HarnessData


def generate(harness: "HarnessData") -> str:
    """Return UTF-8 CSV BOM string."""
    rows: list[dict] = []

    # --- Nodes / components ---
    for node in harness.nodes:
        rows.append({
            "category":   "component",
            "designator": node.designator or "",
            "name":       node.name,
            "part_ref":   node.part_ref or "",
            "qty":        1,
            "detail":     "",
            "tags":       "|".join(f"{k}={v}" for k, v in node.tags.items()),
        })

    # --- Cables (purchased multiconductor assemblies) ---
    for cable in harness.cables:
        rows.append({
            "category":   "cable",
            "designator": cable.designator or cable.id,
            "name":       f"Cable {cable.designator or cable.id}",
            "part_ref":   "",
            "qty":        1,
            "detail":     f"{len(cable.cores)}-core, {cable.length_mm or '?'}mm",
            "tags":       "",
        })

    # --- Bundle sheath parts ---
    for bundle in harness.bundles:
        if bundle.sheath and bundle.sheath.part_ref:
            rows.append({
                "category":   "sheath",
                "designator": bundle.id,
                "name":       bundle.name,
                "part_ref":   bundle.sheath.part_ref,
                "qty":        1,
                "detail":     (
                    f"{bundle.sheath.type or ''} "
                    f"id={bundle.sheath.nominal_id_mm or '?'}mm "
                    f"len={bundle.path_length_mm or '?'}mm"
                ).strip(),
                "tags":       "|".join(f"{k}={v}" for k, v in bundle.tags.items()),
            })

    # --- Wire totals by gauge+color (for purchasing raw wire) ---
    wire_totals: dict[tuple, float] = defaultdict(float)
    for seg in harness.segments:
        c = seg.conductor
        g = c.gauge
        if g and (g.awg or g.mm2):
            key = (
                f"AWG{g.awg}" if g.awg else f"{g.mm2}mm2",
                c.color or "?",
                c.stripe or "",
                c.material or "Cu",
            )
            wire_totals[key] += seg.length_mm or 0

    for (gauge, color, stripe, material), total_mm in sorted(wire_totals.items()):
        stripe_str = f"/{stripe}" if stripe else ""
        rows.append({
            "category":   "wire",
            "designator": "",
            "name":       f"{gauge} {color}{stripe_str} {material}",
            "part_ref":   "",
            "qty":        "",
            "detail":     f"{total_mm:.0f} mm total",
            "tags":       "",
        })

    headers = ["category", "designator", "name", "part_ref", "qty", "detail", "tags"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()
