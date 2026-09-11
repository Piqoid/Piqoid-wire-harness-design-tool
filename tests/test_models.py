"""Tests for Pydantic model correctness and JSON Schema export."""
from __future__ import annotations

import json

import pytest


class TestModels:
    def test_signal_profile_round_trips(self):
        from app.models.signal import SignalProfile
        raw = {
            "id": "prof_test",
            "domain": "digital",
            "direction": "output",
            "physical_layer": "logic_3v3",
            "electrical": {"operating_v": [0.0, 3.3], "abs_max_v": [-0.3, 3.6]},
        }
        prof = SignalProfile.model_validate(raw)
        dumped = json.loads(prof.model_dump_json())
        assert dumped["id"] == "prof_test"
        assert dumped["domain"] == "digital"

    def test_net_model(self):
        from app.models.net import Net
        net = Net(id="net_test", name="TEST", net_class="signal", members=["p1", "p2"])
        assert net.net_class == "signal"
        assert "p1" in net.members

    def test_segment_alias(self):
        from app.models.segment import Endpoint, Segment
        seg = Segment(
            id="seg_test", net_ref="net_a",
            **{"from": Endpoint(kind="port", ref="p1")},
            to=Endpoint(kind="port", ref="p2"),
        )
        assert seg.from_.ref == "p1"

    def test_json_schema_export(self):
        """JSON Schema can be generated from all entity models."""
        from app.models.signal import SignalProfile
        from app.models.net import Net
        from app.models.segment import Segment
        from app.models.bus import Bus
        from app.models.cable import Cable
        from app.models.bundle import Bundle
        from app.models.pair import DifferentialPair
        from app.models.project import ProjectMeta

        for model in [SignalProfile, Net, Segment, Bus, Cable, Bundle, DifferentialPair, ProjectMeta]:
            schema = model.model_json_schema()
            assert "properties" in schema or "$defs" in schema or "title" in schema

    def test_project_meta_defaults(self):
        from app.models.project import ProjectMeta
        meta = ProjectMeta(id="proj_x", name="Test")
        assert meta.schema_version == 1
        assert meta.units["length"] == "mm"
        assert meta.rule_config.power_headroom_threshold_pct == 80.0

    def test_bundle_sheath(self):
        from app.models.bundle import Bundle, BundleSheath
        b = Bundle(id="bnd_t", name="Test", sheath=BundleSheath(type="split_loom", nominal_id_mm=13.0))
        assert b.sheath.type == "split_loom"

    def test_waiver_model(self):
        from app.models.project import Waiver
        w = Waiver(
            rule_id="E-001",
            target={"kind": "net", "ref": "net_x"},
            reason="test",
            expires="2027-01-01",
        )
        assert w.expires == "2027-01-01"

    def test_extra_fields_forbidden(self):
        """Extra fields on strict models should raise."""
        from app.models.signal import SignalProfile
        with pytest.raises(Exception):
            SignalProfile(id="x", domain="digital", direction="output",
                          physical_layer="logic_3v3", bogus_field=123)
