"""Wire cut list generator — CSV rows, one row per segment."""
from __future__ import annotations

import csv
import io
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.project_io import HarnessData


HEADERS = [
    "label", "segment_id", "net_name", "net_class",
    "from_kind", "from_ref", "to_kind", "to_ref",
    "awg", "mm2", "color", "stripe", "material", "construction",
    "insulation_material", "insulation_rating_v", "insulation_temp_c",
    "length_mm", "length_source",
    "cable_ref", "cable_core",
    "bundle_refs",
    "tags",
]


def generate(harness: "HarnessData") -> str:
    """Return UTF-8 CSV string for the wire cut list."""
    net_map = {n.id: n for n in harness.nets}

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADERS, extrasaction="ignore")
    w.writeheader()

    for seg in harness.segments:
        net = net_map.get(seg.net_ref or "")
        c = seg.conductor
        g = c.gauge
        ins = c.insulation

        w.writerow({
            "label":               seg.label or "",
            "segment_id":          seg.id,
            "net_name":            net.name if net else (seg.net_ref or ""),
            "net_class":           net.net_class if net else "",
            "from_kind":           seg.from_.kind,
            "from_ref":            seg.from_.ref,
            "to_kind":             seg.to.kind,
            "to_ref":              seg.to.ref,
            "awg":                 g.awg if g else "",
            "mm2":                 g.mm2 if g else "",
            "color":               c.color or "",
            "stripe":              c.stripe or "",
            "material":            c.material or "",
            "construction":        c.construction or "",
            "insulation_material": ins.material if ins else "",
            "insulation_rating_v": ins.rating_v if ins else "",
            "insulation_temp_c":   ins.temp_rating_c if ins else "",
            "length_mm":           seg.length_mm if seg.length_mm is not None else "",
            "length_source":       seg.length_source if seg.length_source else "",
            "cable_ref":           seg.cable_ref or "",
            "cable_core":          seg.cable_core if seg.cable_core is not None else "",
            "bundle_refs":         "|".join(seg.bundle_refs),
            "tags":                "|".join(f"{k}={v}" for k, v in seg.tags.items()),
        })

    return buf.getvalue()
