"""Cable model (§3.7)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .common import StrictModel


class CableCore(StrictModel):
    index: int
    color: Optional[str] = None
    awg: Optional[int] = None
    mm2: Optional[float] = None
    segment_ref: Optional[str] = None


class CableShield(StrictModel):
    type: str
    coverage_pct: Optional[float] = None
    drain_net_ref: Optional[str] = None
    termination: Optional[str] = None


class CableJacket(StrictModel):
    material: Optional[str] = None
    od_mm: Optional[float] = None
    temp_c: Optional[float] = None
    drag_chain_rated: bool = False


class Cable(StrictModel):
    id: str
    type: Literal["cable"] = "cable"
    schema_version: int = 1
    part_ref: Optional[str] = None
    part_version_hash: Optional[str] = None
    designator: Optional[str] = None
    length_mm: Optional[float] = None
    cores: list[CableCore] = Field(default_factory=list)
    twisted_pairs: list[list[int]] = Field(default_factory=list)
    shield: Optional[CableShield] = None
    jacket: Optional[CableJacket] = None
    tags: dict[str, str] = Field(default_factory=dict)
