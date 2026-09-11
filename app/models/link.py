"""Link model - abstract field buses (§3.9)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .common import StrictModel
from .signal import ProtocolSpec


class LinkEndpoint(StrictModel):
    id: str
    node_ref: str
    interface_ref: str


class LinkAssembly(StrictModel):
    part_ref: Optional[str] = None
    length_mm: Optional[float] = None


class LinkDisplay(StrictModel):
    color: Optional[str] = None
    width_px: Optional[int] = None
    style: Optional[str] = None


class Link(StrictModel):
    id: str
    type: Literal["link"] = "link"
    schema_version: int = 1
    abstraction: Literal["abstract", "concrete"] = "abstract"
    protocol: ProtocolSpec
    endpoints: list[LinkEndpoint] = Field(default_factory=list)
    assembly: Optional[LinkAssembly] = None
    bundle_refs: list[str] = Field(default_factory=list)
    display: LinkDisplay = Field(default_factory=LinkDisplay)
    tags: dict[str, str] = Field(default_factory=dict)
