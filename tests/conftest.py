"""Shared test fixtures."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.project_io import HarnessData, HarnessProject
from app.engine.validator import load_profiles, validate
from app.models.net import Net, NetDisplay
from app.models.node import NodePort
from app.models.project import ProjectMeta, RuleConfig
from app.models.segment import Segment, Endpoint, ConductorSpec, GaugeSpec
from app.models.signal import SignalProfile, ElectricalSpec


PROJECT_ROOT = Path(__file__).parent.parent
LIBRARY_ROOT = PROJECT_ROOT / "library"


@pytest.fixture
def profiles() -> dict[str, SignalProfile]:
    return load_profiles(LIBRARY_ROOT)


@pytest.fixture
def good_project():
    return HarnessProject.load(PROJECT_ROOT)


@pytest.fixture
def broken_project():
    p = HarnessProject.load(PROJECT_ROOT)
    # Return only the broken harness
    good = p.harnesses.get("scara_main")
    broken = p.harnesses.get("scara_broken")
    p.harnesses = {"scara_broken": broken}
    return p


def make_minimal_project(
    nets=None, node_ports=None, segments=None, buses=None,
    bundles=None, pairs=None, splices=None, cables=None,
) -> HarnessProject:
    """Build a minimal in-memory project for rule testing."""
    proj = HarnessProject(PROJECT_ROOT)
    proj.meta = ProjectMeta(id="proj_test", name="Test")
    harness = HarnessData()
    harness.nets = nets or []
    harness.node_ports = node_ports or []
    harness.segments = segments or []
    harness.buses = buses or []
    harness.bundles = bundles or []
    harness.pairs = pairs or []
    harness.splices = splices or []
    harness.cables = cables or []
    proj.harnesses = {"main": harness}
    return proj
