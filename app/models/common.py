"""Shared types, ID generation, base classes."""
from __future__ import annotations

import time
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict


def make_ulid(prefix: str) -> str:
    """Generate a prefixed ULID."""
    import uuid
    import base64
    # Simple ULID-like: prefix + 16 random hex chars from uuid4
    uid = uuid.uuid4().hex[:16].upper()
    return f"{prefix}_{uid}"


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        validate_assignment=True,
        use_enum_values=True,
    )


class Domain(str, Enum):
    digital = "digital"
    analog = "analog"
    power = "power"
    ground = "ground"
    differential = "differential"
    bus_abstract = "bus_abstract"
    passive = "passive"
    no_connect = "no_connect"


class Direction(str, Enum):
    input = "input"
    output = "output"
    bidirectional = "bidirectional"
    open_drain = "open_drain"
    open_source = "open_source"
    high_z = "high_z"
    passive = "passive"


class Severity(str, Enum):
    error = "error"
    warning = "warning"
    info = "info"


class NetClass(str, Enum):
    power = "power"
    signal = "signal"
    ground = "ground"
    shield = "shield"
    no_connect = "no_connect"


class LengthSource(str, Enum):
    manual = "manual"
    measured = "measured"
    routed = "routed"
    estimated = "estimated"


class EndpointKind(str, Enum):
    port = "port"
    splice = "splice"
    ring_lug = "ring_lug"
    free_end = "free_end"
    shield_drain = "shield_drain"
    connector_cavity = "connector_cavity"


class SheathType(str, Enum):
    none = "none"
    split_loom = "split_loom"
    braided_sleeve = "braided_sleeve"
    spiral_wrap = "spiral_wrap"
    heatshrink = "heatshrink"
    conduit_flexible = "conduit_flexible"
    conduit_rigid = "conduit_rigid"
    harness_tape = "harness_tape"
    drag_chain = "drag_chain"
