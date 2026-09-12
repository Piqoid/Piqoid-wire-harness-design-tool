"""Project meta and top-level harness document models."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import Field

from .common import StrictModel


class TagValueDisplay(StrictModel):
    model_config = {"extra": "allow"}


class TagDef(StrictModel):
    key: str
    label: Optional[str] = None
    values: list[str] = Field(default_factory=list)
    applies_to: list[str] = Field(default_factory=list)
    multi: bool = False
    required_on: list[str] = Field(default_factory=list)
    inherit: Optional[str] = None
    display: dict[str, str] = Field(default_factory=dict)


class DisplayRule(StrictModel):
    match: dict[str, Any]
    color: Optional[str] = None
    width_px: Optional[int] = None
    style: Optional[str] = None


class RuleConfig(StrictModel):
    power_headroom_threshold_pct: float = 80.0
    release_require_measured_lengths: bool = False
    # "AUTOMOTIVE_PRACTICE" (library/tables/ampacity.json, library/tables/derating.json)
    # or "IEC_60364_5_52" / "UL_758" once those table sets exist.
    ampacity_standard: str = "AUTOMOTIVE_PRACTICE"
    inrush_factor: float = 1.0
    # Default ambient for P-001/P-002 when a segment's bundle doesn't declare
    # computed.max_ambient_c. Matches the ampacity table's own reference ambient.
    ambient_c: float = 30.0
    # abs_max insulation rating_v must be >= net nominal_v * this factor (P-003).
    insulation_voltage_margin: float = 1.5


class Waiver(StrictModel):
    rule_id: str
    target: dict[str, str]
    reason: str
    author: Optional[str] = None
    created: Optional[str] = None
    expires: Optional[str] = None


class UserRule(StrictModel):
    id: str
    severity: str
    scope: str
    expr: str
    message: str
    enabled: bool = True


class ProjectMeta(StrictModel):
    id: str
    type: Literal["project"] = "project"
    schema_version: int = 1
    name: str
    description: Optional[str] = None
    created: Optional[str] = None
    units: dict[str, str] = Field(default_factory=lambda: {
        "length": "mm",
        "voltage": "V",
        "current": "A",
        "area": "mm2",
    })
    tag_defs: list[TagDef] = Field(default_factory=list)
    display_rules: list[DisplayRule] = Field(default_factory=list)
    rule_config: RuleConfig = Field(default_factory=RuleConfig)
    waivers: list[Waiver] = Field(default_factory=list)
    user_rules: list[UserRule] = Field(default_factory=list)


class HarnessDocument(StrictModel):
    """Container for all entities in one harness folder."""
    nodes: list[dict] = Field(default_factory=list)
    node_ports: list[dict] = Field(default_factory=list)
    nets: list[dict] = Field(default_factory=list)
    segments: list[dict] = Field(default_factory=list)
    cables: list[dict] = Field(default_factory=list)
    bundles: list[dict] = Field(default_factory=list)
    buses: list[dict] = Field(default_factory=list)
    pairs: list[dict] = Field(default_factory=list)
    links: list[dict] = Field(default_factory=list)
    splices: list[dict] = Field(default_factory=list)
