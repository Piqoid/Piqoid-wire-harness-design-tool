"""Loaders and lookups for library/tables/*.json (ampacity, derating, awg)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


def _load_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_ampacity_table(library_root: Path) -> Optional[dict]:
    return _load_json(library_root / "tables" / "ampacity.json")


def load_derating_table(library_root: Path) -> Optional[dict]:
    return _load_json(library_root / "tables" / "derating.json")


def load_awg_table(library_root: Path) -> Optional[dict]:
    return _load_json(library_root / "tables" / "awg.json")


def _nearest_temp_column(columns: list[str], temp_rating_c: float) -> Optional[str]:
    """Pick the column whose numeric value is the largest one <= temp_rating_c.
    Never round up (that would overstate ampacity)."""
    candidates = sorted((float(c) for c in columns), reverse=True)
    for c in candidates:
        if c <= temp_rating_c:
            return str(int(c)) if c == int(c) else str(c)
    return None


def lookup_base_ampacity(ampacity_table: dict, awg: int, temp_rating_c: float) -> Optional[float]:
    """Base single-conductor free-air ampacity for a gauge at/under a given insulation rating."""
    table = ampacity_table.get("single_conductor_free_air", {})
    col = _nearest_temp_column(list(table.keys()), temp_rating_c)
    if col is None:
        return None
    row = table.get(col, {})
    return row.get(str(awg))


def _in_range(value: float, range_key: str) -> bool:
    lo_s, hi_s = range_key.split("-")
    return float(lo_s) <= value <= float(hi_s)


def lookup_ambient_factor(derating_table: dict, temp_rating_c: float, ambient_c: float) -> float:
    """1.0 for ambient at/below the table's own reference ambient (30C) or when the
    insulation rating has no correction column — never invents a >1.0 bonus."""
    table = derating_table.get("ambient_temperature_correction", {})
    col = _nearest_temp_column([k for k in table.keys() if k != "description"], temp_rating_c)
    if col is None or ambient_c <= 30:
        return 1.0
    row = table.get(col, {})
    for range_key, factor in row.items():
        if _in_range(ambient_c, range_key):
            return factor
    # Above the table's highest bucket: use the most severe (lowest) factor available.
    if row:
        return min(row.values())
    return 1.0


def lookup_resistance_ohm_per_km(awg_table: dict, awg: int) -> Optional[float]:
    for entry in awg_table.get("entries", []):
        if entry.get("awg") == awg:
            return entry.get("resistance_ohm_per_km")
    return None


def lookup_count_factor(derating_table: dict, conductor_count: int) -> float:
    table = derating_table.get("conductor_count_correction", {})
    for range_key, factor in table.items():
        if range_key == "description":
            continue
        if _in_range(conductor_count, range_key):
            return factor
    return 1.0
