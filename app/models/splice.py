"""Splice model - first-class entity (§9 open question: recommend first-class from M0)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .common import StrictModel


class Splice(StrictModel):
    id: str
    type: Literal["splice"] = "splice"
    schema_version: int = 1
    name: Optional[str] = None
    part_ref: Optional[str] = None
    net_ref: Optional[str] = None
    node_ref: Optional[str] = None
    location_note: Optional[str] = None
    tags: dict[str, str] = Field(default_factory=dict)
