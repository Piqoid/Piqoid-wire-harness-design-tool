"""DifferentialPair model (§3.6)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .common import StrictModel


class DiffPairSpec(StrictModel):
    z_diff_ohm: Optional[float] = None
    z_tolerance_pct: Optional[float] = None
    twist_lay_mm: Optional[float] = None
    max_skew_mm: Optional[float] = None


class DifferentialPair(StrictModel):
    id: str
    type: Literal["diff_pair"] = "diff_pair"
    schema_version: int = 1
    nets: dict[str, str] = Field(default_factory=dict)
    spec: DiffPairSpec = Field(default_factory=DiffPairSpec)
    require_same_cable: bool = False
    require_same_bundle: bool = False
