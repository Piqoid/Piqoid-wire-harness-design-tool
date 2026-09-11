"""SignalProfile model (§3.1, §3.2)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field, model_validator

from .common import Domain, Direction, StrictModel


class ElectricalSpec(StrictModel):
    nominal_v: Optional[float] = None
    operating_v: Optional[tuple[float, float]] = None
    abs_max_v: Optional[tuple[float, float]] = None
    # Driver capability
    v_oh_min: Optional[float] = None
    v_ol_max: Optional[float] = None
    # Receiver thresholds
    v_ih_min: Optional[float] = None
    v_il_max: Optional[float] = None
    # Current - source
    i_supply_max_a: Optional[float] = None
    i_supply_continuous_a: Optional[float] = None
    # Current - sink
    i_draw_typ_a: Optional[float] = None
    i_draw_max_a: Optional[float] = None
    i_inrush_a: Optional[float] = None
    i_inrush_duration_ms: Optional[float] = None
    # Recessive voltage (CAN, RS-485)
    recessive_v: Optional[float] = None


class DifferentialSpec(StrictModel):
    v_diff_dominant_min: Optional[float] = None
    v_diff_recessive_max: Optional[float] = None
    v_common_mode: Optional[tuple[float, float]] = None


class DiffMember(StrictModel):
    pair_role: Literal["P", "N"]
    partner_role: Literal["P", "N"]


class ProtocolSpec(StrictModel):
    name: str
    variants: Optional[list[str]] = None
    bitrate_max: Optional[int] = None
    variant: Optional[str] = None
    bitrate: Optional[int] = None
    data_bitrate: Optional[int] = None
    speed: Optional[str] = None
    grade_min: Optional[str] = None
    poe: Optional[dict] = None


class SignalIntegrity(StrictModel):
    max_edge_rate_ns: Optional[float] = None
    max_freq_hz: Optional[float] = None


class SignalProfile(StrictModel):
    id: str
    type: Literal["signal_profile"] = "signal_profile"
    schema_version: int = 1
    domain: Domain
    direction: Direction
    physical_layer: str
    reference_role: Optional[str] = None
    protocol: Optional[ProtocolSpec] = None
    diff_member: Optional[DiffMember] = None
    electrical: ElectricalSpec = Field(default_factory=ElectricalSpec)
    differential: Optional[DifferentialSpec] = None
    signal_integrity: Optional[SignalIntegrity] = None
    tags: dict[str, str] = Field(default_factory=dict)
