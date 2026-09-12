"""Net model (§3.4)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .common import NetClass, StrictModel


class DeclaredSignal(StrictModel):
    profile_ref: str
    mode: Literal["strict", "inferred"] = "inferred"


class NetConstraints(StrictModel):
    max_voltage_drop_v: Optional[float] = None
    expected_current_a: Optional[float] = None
    max_stub_length_mm: Optional[float] = None


class NetDisplay(StrictModel):
    color: Optional[str] = None
    width_px: Optional[int] = None
    style: Optional[str] = None
    label_visible: bool = True


class Net(StrictModel):
    id: str
    type: Literal["net"] = "net"
    schema_version: int = 1
    name: str
    net_class: NetClass = NetClass.signal
    declared_signal: Optional[DeclaredSignal] = None
    members: list[str] = Field(default_factory=list)
    bus_ref: Optional[str] = None
    bus_domain: Optional[str] = None
    pair_ref: Optional[str] = None
    constraints: NetConstraints = Field(default_factory=NetConstraints)
    display: NetDisplay = Field(default_factory=NetDisplay)
    tags: dict[str, str] = Field(default_factory=dict)
    ring: bool = False
    # True when >1 declared source on a power net is an intentional parallel
    # supply (PW-006 / current computation), not a design mistake.
    paralleled: bool = False
