"""Tests for M0 validation rules — one passing and one failing fixture per rule."""
from __future__ import annotations

import pytest

from app.engine.rules.electrical import check_e001, check_e002, check_e003
from app.engine.rules.power import check_pw001_pw005_pw007
from app.engine.rules.structural import check_s001, check_s003, check_s006
from app.engine.validator import load_profiles, validate
from app.models.common import Direction, Domain, NetClass
from app.models.net import Net, NetDisplay
from app.models.node import NodePort
from app.models.project import ProjectMeta
from app.models.segment import ConductorSpec, Endpoint, GaugeSpec, Segment
from app.models.signal import ElectricalSpec, SignalProfile

from .conftest import LIBRARY_ROOT, make_minimal_project


def _prof(
    id="prof_t",
    domain=Domain.digital,
    direction=Direction.output,
    physical_layer="logic_3v3",
    operating_v=(0.0, 3.3),
    abs_max_v=(-0.3, 3.6),
    v_oh_min=None,
    v_ol_max=None,
    v_ih_min=None,
    v_il_max=None,
    i_supply_max_a=None,
    i_supply_continuous_a=None,
    i_draw_max_a=None,
    i_draw_typ_a=None,
    protocol=None,
) -> SignalProfile:
    return SignalProfile(
        id=id,
        domain=domain,
        direction=direction,
        physical_layer=physical_layer,
        electrical=ElectricalSpec(
            operating_v=operating_v,
            abs_max_v=abs_max_v,
            v_oh_min=v_oh_min,
            v_ol_max=v_ol_max,
            v_ih_min=v_ih_min,
            v_il_max=v_il_max,
            i_supply_max_a=i_supply_max_a,
            i_supply_continuous_a=i_supply_continuous_a,
            i_draw_max_a=i_draw_max_a,
            i_draw_typ_a=i_draw_typ_a,
        ),
        protocol=protocol,
    )


def _port(id, profile_ref, net_ref=None) -> NodePort:
    return NodePort(
        id=id, node_ref="node_a", interface_ref="if_a",
        pin_name=id, profile_ref=profile_ref, net_ref=net_ref,
    )


def _net(id="net_a", net_class=NetClass.signal, members=None) -> Net:
    return Net(id=id, name=id, net_class=net_class, members=members or [])


def _seg(id, net_ref, from_ref, to_ref, from_kind="port", to_kind="port") -> Segment:
    return Segment(
        id=id, net_ref=net_ref,
        **{"from": Endpoint(kind=from_kind, ref=from_ref)},
        to=Endpoint(kind=to_kind, ref=to_ref),
        conductor=ConductorSpec(gauge=GaugeSpec(awg=22, mm2=0.34)),
    )


# ── E-001 ─────────────────────────────────────────────────────────────────────

class TestE001:
    def test_passing_within_abs_max(self):
        """3.3 V driver → input with abs_max 5.5 V: no violation."""
        prof_out = _prof("p_out", direction=Direction.output, operating_v=(0.0, 3.3), abs_max_v=(-0.3, 3.6))
        prof_in  = _prof("p_in",  direction=Direction.input,  operating_v=(0.0, 5.0), abs_max_v=(-0.5, 5.5))
        net = _net(members=["p1", "p2"])
        ports = [_port("p1", "p_out", net.id), _port("p2", "p_in", net.id)]
        diags = check_e001([net], ports, {"p_out": prof_out, "p_in": prof_in})
        assert not diags

    def test_failing_voltage_exceeds_abs_max(self):
        """24 V driver → 5 V enable input (abs_max 6 V): E-001 error."""
        prof_24v = _prof("p_24v", domain=Domain.power, direction=Direction.output,
                         operating_v=(22.8, 25.2), abs_max_v=(-0.5, 30.0))
        prof_5v  = _prof("p_5v",  direction=Direction.input,
                         operating_v=(0.0, 5.0),  abs_max_v=(-0.5, 6.0))
        net = _net(net_class=NetClass.power, members=["p1", "p2"])
        ports = [_port("p1", "p_24v", net.id), _port("p2", "p_5v", net.id)]
        diags = check_e001([net], ports, {"p_24v": prof_24v, "p_5v": prof_5v})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-001"
        assert "p2" in diags[0].entities

    def test_failing_3v3_exceeds_abs_max_3v6(self):
        """CAN_H bus (4.0 V max) on MCU logic port (abs_max 3.6 V): E-001 error."""
        prof_canh = _prof("p_canh", domain=Domain.differential, direction=Direction.bidirectional,
                          physical_layer="can_hs_5v", operating_v=(2.0, 4.0), abs_max_v=(-27.0, 40.0))
        prof_mcu  = _prof("p_mcu",  domain=Domain.digital, direction=Direction.output,
                          physical_layer="can_logic_3v3", operating_v=(0.0, 3.3), abs_max_v=(-0.3, 3.6))
        net = _net(members=["p1", "p2"])
        ports = [_port("p1", "p_canh", net.id), _port("p2", "p_mcu", net.id)]
        diags = check_e001([net], ports, {"p_canh": prof_canh, "p_mcu": prof_mcu})
        assert any(d.rule_id == "E-001" for d in diags)


# ── E-002 ─────────────────────────────────────────────────────────────────────

class TestE002:
    def test_passing_good_levels(self):
        """3.3 V driver, 3.3 V receiver with compatible thresholds."""
        prof_out = _prof("p_out", v_oh_min=2.9, v_ol_max=0.4)
        prof_in  = _prof("p_in",  direction=Direction.input, v_ih_min=2.0, v_il_max=0.8)
        net = _net(members=["p1", "p2"])
        ports = [_port("p1", "p_out", net.id), _port("p2", "p_in", net.id)]
        diags = check_e002([net], ports, {"p_out": prof_out, "p_in": prof_in})
        assert not diags

    def test_failing_voh_below_vih(self):
        """V_OH_min 1.5 V < V_IH_min 2.0 V: E-002 error."""
        prof_out = _prof("p_out", v_oh_min=1.5, v_ol_max=0.4)
        prof_in  = _prof("p_in",  direction=Direction.input, v_ih_min=2.0, v_il_max=0.8)
        net = _net(members=["p1", "p2"])
        ports = [_port("p1", "p_out", net.id), _port("p2", "p_in", net.id)]
        diags = check_e002([net], ports, {"p_out": prof_out, "p_in": prof_in})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-002"

    def test_failing_vol_above_vil(self):
        """V_OL_max 1.0 V > V_IL_max 0.8 V: E-002 error."""
        prof_out = _prof("p_out", v_oh_min=2.9, v_ol_max=1.0)
        prof_in  = _prof("p_in",  direction=Direction.input, v_ih_min=2.0, v_il_max=0.8)
        net = _net(members=["p1", "p2"])
        ports = [_port("p1", "p_out", net.id), _port("p2", "p_in", net.id)]
        diags = check_e002([net], ports, {"p_out": prof_out, "p_in": prof_in})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-002"


# ── E-003 ─────────────────────────────────────────────────────────────────────

class TestE003:
    def test_passing_same_physical_layer(self):
        """Two CAN HS ports on same physical layer: no E-003."""
        from app.models.signal import ProtocolSpec
        proto = ProtocolSpec(name="CAN")
        p1 = _prof("p1", domain=Domain.differential, direction=Direction.bidirectional,
                   physical_layer="can_hs_5v", protocol=proto)
        p2 = _prof("p2", domain=Domain.differential, direction=Direction.bidirectional,
                   physical_layer="can_hs_5v", protocol=proto)
        net = _net(members=["a", "b"])
        ports = [_port("a", "p1", net.id), _port("b", "p2", net.id)]
        diags = check_e003([net], ports, {"p1": p1, "p2": p2})
        assert not diags

    def test_passing_no_protocol_generic(self):
        """Generic digital ports (no protocol) on same physical layer: no E-003."""
        p1 = _prof("p1", physical_layer="logic_3v3")
        p2 = _prof("p2", direction=Direction.input, physical_layer="logic_3v3")
        net = _net(members=["a", "b"])
        ports = [_port("a", "p1", net.id), _port("b", "p2", net.id)]
        diags = check_e003([net], ports, {"p1": p1, "p2": p2})
        assert not diags

    def test_failing_mixed_physical_layer_same_protocol(self):
        """can_logic_3v3 + can_hs_5v on same net: E-003 wrong domain."""
        from app.models.signal import ProtocolSpec
        proto = ProtocolSpec(name="CAN")
        p1 = _prof("p1", domain=Domain.digital, direction=Direction.output,
                   physical_layer="can_logic_3v3", protocol=proto)
        p2 = _prof("p2", domain=Domain.differential, direction=Direction.bidirectional,
                   physical_layer="can_hs_5v", protocol=proto)
        net = _net(members=["a", "b"])
        ports = [_port("a", "p1", net.id), _port("b", "p2", net.id)]
        diags = check_e003([net], ports, {"p1": p1, "p2": p2})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-003"

    def test_failing_different_protocols(self):
        """CAN vs RS485 on same net: E-003 protocol mismatch."""
        from app.models.signal import ProtocolSpec
        p1 = _prof("p1", domain=Domain.differential, direction=Direction.bidirectional,
                   physical_layer="can_hs_5v", protocol=ProtocolSpec(name="CAN"))
        p2 = _prof("p2", domain=Domain.differential, direction=Direction.bidirectional,
                   physical_layer="rs485_5v", protocol=ProtocolSpec(name="RS485"))
        net = _net(members=["a", "b"])
        ports = [_port("a", "p1", net.id), _port("b", "p2", net.id)]
        diags = check_e003([net], ports, {"p1": p1, "p2": p2})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-003"


# ── PW-001 / PW-005 / PW-007 ─────────────────────────────────────────────────

class TestPowerRules:
    def _make_power_net(self, supply_max, draws):
        net = _net("net_pwr", net_class=NetClass.power, members=["src"] + [f"sink{i}" for i in range(len(draws))])
        profs = {
            "src": _prof("src", domain=Domain.power, direction=Direction.output,
                         physical_layer="power_dc", i_supply_max_a=supply_max, i_supply_continuous_a=supply_max * 0.9),
        }
        ports = [_port("src", "src", net.id)]
        for i, draw in enumerate(draws):
            pid = f"sink{i}"
            profs[pid] = _prof(pid, domain=Domain.power, direction=Direction.input,
                               physical_layer="power_dc", i_draw_max_a=draw, i_draw_typ_a=draw * 0.8)
            ports.append(_port(pid, pid, net.id))
        return [net], ports, profs

    def test_passing_within_budget(self):
        nets, ports, profs = self._make_power_net(10.0, [2.0, 3.0])
        diags = check_pw001_pw005_pw007(nets, ports, profs)
        rule_ids = [d.rule_id for d in diags]
        assert "PW-001" not in rule_ids
        assert "PW-005" not in rule_ids
        assert "PW-007" in rule_ids

    def test_failing_pw001_over_budget(self):
        nets, ports, profs = self._make_power_net(5.0, [4.0, 4.0])
        diags = check_pw001_pw005_pw007(nets, ports, profs)
        rule_ids = [d.rule_id for d in diags]
        assert "PW-001" in rule_ids

    def test_failing_pw005_no_source(self):
        net = _net("net_pwr", net_class=NetClass.power, members=["sink1"])
        prof = _prof("sink1", domain=Domain.power, direction=Direction.input,
                     physical_layer="power_dc", i_draw_max_a=2.0)
        port = _port("sink1", "sink1", net.id)
        diags = check_pw001_pw005_pw007([net], [port], {"sink1": prof})
        rule_ids = [d.rule_id for d in diags]
        assert "PW-005" in rule_ids

    def test_pw007_always_emits_info(self):
        nets, ports, profs = self._make_power_net(10.0, [2.0])
        diags = check_pw001_pw005_pw007(nets, ports, profs)
        assert any(d.rule_id == "PW-007" and d.severity == "info" for d in diags)


# ── S-001 ─────────────────────────────────────────────────────────────────────

class TestS001:
    def test_passing_connected(self):
        net = _net(members=["p1", "p2"])
        ports = [_port("p1", "prof", net.id), _port("p2", "prof", net.id)]
        segs = [_seg("s1", net.id, "p1", "p2")]
        diags = check_s001([net], segs, ports)
        assert not diags

    def test_passing_star_via_splice(self):
        net = _net(members=["p1", "p2", "p3"])
        ports = [_port("p1", "prof", net.id), _port("p2", "prof", net.id), _port("p3", "prof", net.id)]
        segs = [
            _seg("s1", net.id, "p1", "spl1", to_kind="splice"),
            _seg("s2", net.id, "spl1", "p2", from_kind="splice"),
            _seg("s3", net.id, "spl1", "p3", from_kind="splice"),
        ]
        diags = check_s001([net], segs, ports)
        assert not diags

    def test_failing_disconnected_member(self):
        net = _net(members=["p1", "p2", "p3"])
        ports = [_port("p1", "prof", net.id), _port("p2", "prof", net.id), _port("p3", "prof", net.id)]
        # Only p1-p2 connected; p3 is isolated
        segs = [_seg("s1", net.id, "p1", "p2")]
        diags = check_s001([net], segs, ports)
        assert len(diags) == 1
        assert diags[0].rule_id == "S-001"
        assert "p3" in diags[0].entities


# ── S-003 ─────────────────────────────────────────────────────────────────────

class TestS003:
    def test_passing_seg_with_valid_net(self):
        net = _net()
        seg = _seg("s1", net.id, "p1", "p2")
        diags = check_s003([seg], [net])
        assert not diags

    def test_failing_orphan_segment(self):
        net = _net()
        seg = _seg("s1", "net_nonexistent", "p1", "p2")
        diags = check_s003([seg], [net])
        assert len(diags) == 1
        assert diags[0].rule_id == "S-003"

    def test_failing_no_net_ref(self):
        seg = Segment(
            id="s1", net_ref=None,
            **{"from": Endpoint(kind="port", ref="p1")},
            to=Endpoint(kind="port", ref="p2"),
        )
        diags = check_s003([seg], [])
        assert len(diags) == 1
        assert diags[0].rule_id == "S-003"


# ── S-006 ─────────────────────────────────────────────────────────────────────

class TestS006:
    def test_passing_all_refs_valid(self):
        net = _net(members=["p1"])
        port = _port("p1", "prof", net.id)
        seg = _seg("s1", net.id, "p1", "p2")
        port2 = _port("p2", "prof", net.id)
        net.members = ["p1", "p2"]
        diags = check_s006([net], [seg], [port, port2], [], [], [], [])
        assert not diags

    def test_failing_segment_net_ref_missing(self):
        net = _net()
        seg = _seg("s1", "net_ghost", "p1", "p2")
        port = _port("p1", "prof")
        diags = check_s006([net], [seg], [port], [], [], [], [])
        assert any(d.rule_id == "S-006" and "net_ghost" in d.message for d in diags)

    def test_failing_net_member_ref_missing(self):
        net = _net(members=["nonexistent_port"])
        diags = check_s006([net], [], [], [], [], [], [])
        assert any(d.rule_id == "S-006" for d in diags)


# ── Integration: good harness clean, broken harness produces expected errors ──

class TestIntegration:
    def test_good_harness_no_errors(self, good_project, profiles):
        diags = validate(good_project, harness_name="scara_main", library_root=LIBRARY_ROOT)
        errors = [d for d in diags if d.severity == "error" and not d.waived]
        assert errors == [], f"Unexpected errors: {errors}"

    def test_broken_harness_expected_errors(self, broken_project):
        diags = validate(broken_project, harness_name="scara_broken", library_root=LIBRARY_ROOT)
        rule_ids = {d.rule_id for d in diags if not d.waived}
        assert "E-001" in rule_ids, "Expected E-001 (24V on 5V pin)"
        assert "E-003" in rule_ids, "Expected E-003 (physical layer mismatch)"

    def test_waiver_suppresses_error(self, broken_project):
        from app.models.project import Waiver
        broken_project.meta.waivers = [
            Waiver(
                rule_id="E-001",
                target={"kind": "net", "ref": "net_24v_bad"},
                reason="Intentional test waiver",
                author="test",
                created="2026-09-11",
                expires="2027-01-01",
            )
        ]
        diags = validate(broken_project, harness_name="scara_broken", library_root=LIBRARY_ROOT)
        waived = [d for d in diags if d.waived and d.rule_id == "E-001"]
        assert waived, "Waiver should suppress at least one E-001"
        assert waived[0].waiver_reason == "Intentional test waiver"
