"""Segment model (§3.5)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .common import EndpointKind, LengthSource, StrictModel


class GaugeSpec(StrictModel):
    awg: Optional[int] = None
    mm2: Optional[float] = None


class InsulationSpec(StrictModel):
    material: Optional[str] = None
    rating_v: Optional[float] = None
    temp_rating_c: Optional[float] = None
    od_mm: Optional[float] = None


class ConductorSpec(StrictModel):
    gauge: GaugeSpec = Field(default_factory=GaugeSpec)
    construction: Optional[str] = None
    stranding: Optional[str] = None
    material: str = "Cu"
    plating: Optional[str] = None
    insulation: InsulationSpec = Field(default_factory=InsulationSpec)
    color: Optional[str] = None
    stripe: Optional[str] = None


class TerminationEnd(StrictModel):
    part_ref: Optional[str] = None
    crimp_spec: Optional[str] = None


class SegmentTermination(StrictModel):
    from_: Optional[TerminationEnd] = Field(None, alias="from")
    to: Optional[TerminationEnd] = None

    model_config = {"populate_by_name": True}


class Endpoint(StrictModel):
    kind: EndpointKind
    ref: str


class Segment(StrictModel):
    id: str
    type: Literal["segment"] = "segment"
    schema_version: int = 1
    net_ref: Optional[str] = None
    from_: Endpoint = Field(..., alias="from")
    to: Endpoint
    conductor: ConductorSpec = Field(default_factory=ConductorSpec)
    length_mm: Optional[float] = None
    length_source: LengthSource = LengthSource.manual
    cable_ref: Optional[str] = None
    cable_core: Optional[int] = None
    bundle_refs: list[str] = Field(default_factory=list)
    label: Optional[str] = None
    termination: Optional[SegmentTermination] = None
    tags: dict[str, str] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}
