"""Node and NodePort models."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .common import StrictModel


class NodePort(StrictModel):
    id: str
    type: Literal["node_port"] = "node_port"
    schema_version: int = 1
    node_ref: str
    interface_ref: str
    pin_name: str
    profile_ref: str
    net_ref: Optional[str] = None
    connector_ref: Optional[str] = None
    cavity: Optional[int] = None
    tags: dict[str, str] = Field(default_factory=dict)


class Interface(StrictModel):
    id: str
    name: str
    port_refs: list[str] = Field(default_factory=list)
    bus_ref: Optional[str] = None
    bus_domain: Optional[str] = None


class Node(StrictModel):
    id: str
    type: Literal["node"] = "node"
    schema_version: int = 1
    name: str
    designator: Optional[str] = None
    part_ref: Optional[str] = None
    part_version_hash: Optional[str] = None
    interfaces: list[Interface] = Field(default_factory=list)
    tags: dict[str, str] = Field(default_factory=dict)
