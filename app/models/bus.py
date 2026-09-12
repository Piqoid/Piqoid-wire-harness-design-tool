"""Bus model (§3.3)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .common import StrictModel
from .signal import ProtocolSpec


class BusMember(StrictModel):
    node_ref: str
    interface_ref: str
    position: Optional[int] = None
    terminated: bool = False


class BusTermination(StrictModel):
    required_count: int
    ohms: float


class BusDomain(StrictModel):
    id: str
    physical_layer: str
    topology: Optional[str] = None
    nets: dict[str, str] = Field(default_factory=dict)
    pair_ref: Optional[str] = None
    members: list[BusMember] = Field(default_factory=list)
    termination: Optional[BusTermination] = None
    # Transceiver-rated max node count for this domain (B-008). None = not declared / unchecked.
    max_nodes: Optional[int] = None


class BusBridge(StrictModel):
    node_ref: str
    from_domain: str
    to_domain: str


class Bus(StrictModel):
    id: str
    type: Literal["bus"] = "bus"
    schema_version: int = 1
    name: str
    protocol: ProtocolSpec
    domains: list[BusDomain] = Field(default_factory=list)
    bridges: list[BusBridge] = Field(default_factory=list)
    tags: dict[str, str] = Field(default_factory=dict)
