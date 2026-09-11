"""Bundle model (§3.8)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .common import SheathType, StrictModel


class FlameSpec(StrictModel):
    rating: Optional[str] = None
    self_extinguishing: bool = False


class SheathShield(StrictModel):
    shielded: bool = False
    type: Optional[str] = None
    coverage_pct: Optional[float] = None
    grounded: bool = False
    drain_net_ref: Optional[str] = None
    termination: Optional[str] = None
    bond_point: Optional[dict] = None


class SheathMechanical(StrictModel):
    abrasion_class: Optional[str] = None
    flexible: bool = False
    min_bend_radius_mm: Optional[float] = None
    drag_chain_rated: bool = False
    ip_rating: Optional[str] = None


class BundleSheath(StrictModel):
    part_ref: Optional[str] = None
    type: SheathType = SheathType.none
    material: Optional[str] = None
    color: Optional[str] = None
    nominal_id_mm: Optional[float] = None
    wall_mm: Optional[float] = None
    outer_od_mm: Optional[float] = None
    max_fill_pct: Optional[float] = None
    flame: Optional[FlameSpec] = None
    temp_range_c: Optional[tuple[float, float]] = None
    shield: Optional[SheathShield] = None
    mechanical: Optional[SheathMechanical] = None
    chemical_resistance: list[str] = Field(default_factory=list)
    notes: str = ""


class BundleComputed(StrictModel):
    conductor_count: Optional[int] = None
    bundle_od_mm: Optional[float] = None
    fill_pct: Optional[float] = None
    max_ambient_c: Optional[float] = None


class Bundle(StrictModel):
    id: str
    type: Literal["bundle"] = "bundle"
    schema_version: int = 1
    name: str
    parent_bundle_ref: Optional[str] = None
    segment_refs: list[str] = Field(default_factory=list)
    cable_refs: list[str] = Field(default_factory=list)
    path_length_mm: Optional[float] = None
    computed: BundleComputed = Field(default_factory=BundleComputed)
    sheath: Optional[BundleSheath] = None
    tags: dict[str, str] = Field(default_factory=dict)
