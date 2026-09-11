"""Diagnostic data structure returned by all rules."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from ..models.common import Severity


@dataclass
class Diagnostic:
    rule_id: str
    severity: Severity
    message: str
    # IDs of implicated entities for UI highlighting
    entities: list[str] = field(default_factory=list)
    # If waived, this is the waiver record
    waived: bool = False
    waiver_reason: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "rule_id": self.rule_id,
            "severity": self.severity,
            "message": self.message,
            "entities": self.entities,
            "waived": self.waived,
            "waiver_reason": self.waiver_reason,
        }
