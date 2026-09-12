"""Tests for M3 validation rules — one passing and one failing fixture per rule
(E-004..E-010, PW-002/003/004/006, B-001..B-011 minus B-006, P-001/002/003/005/006/007,
SH-001..SH-007, S-002, S-004). See app/engine/rules/*.py docstrings for the
handful of rules deliberately deferred (P-004, S-005, S-007: need library parts
that don't exist until M5; B-006: needs a hub/segment-path walk not yet modelled)."""
from __future__ import annotations

from app.engine.rules.bus import (
    check_b001_b002_b003, check_b004_b005, check_b007, check_b008, check_b009, check_b010_b011,
)
from app.engine.rules.electrical import (
    check_e004, check_e005, check_e006, check_e007, check_e008, check_e009, check_e010,
)
from app.engine.rules.physical import check_p001, check_p002, check_p003, check_p005, check_p006, check_p007
from app.engine.rules.power import check_pw002_pw003_pw004_pw006
from app.engine.rules.sheath import (
    check_sh001, check_sh002, check_sh003, check_sh004, check_sh005, check_sh006, check_sh007,
)
from app.engine.rules.structural import check_s002, check_s004
from app.engine.graph import build_net_graphs
from app.engine.tables import load_ampacity_table, load_awg_table, load_derating_table
from app.models.bundle import Bundle, BundleComputed, BundleSheath, FlameSpec, SheathMechanical, SheathShield
from app.models.bus import Bus, BusDomain, BusMember, BusTermination, BusBridge
from app.models.cable import Cable, CableCore, CableShield
from app.models.common import Direction, Domain, NetClass
from app.models.net import Net, NetConstraints
from app.models.node import Interface, Node, NodePort
from app.models.pair import DifferentialPair, DiffPairSpec
from app.models.project import ProjectMeta, RuleConfig
from app.models.segment import ConductorSpec, Endpoint, GaugeSpec, InsulationSpec, Segment
from app.models.signal import DiffMember, ElectricalSpec, ProtocolSpec, SignalIntegrity, SignalProfile

from .conftest import LIBRARY_ROOT

LIB = LIBRARY_ROOT


def _prof(
    id="prof_t", domain=Domain.digital, direction=Direction.output, physical_layer="logic_3v3",
    operating_v=(0.0, 3.3), abs_max_v=(-0.3, 3.6), v_oh_min=None, v_ol_max=None,
    v_ih_min=None, v_il_max=None, i_supply_max_a=None, i_supply_continuous_a=None,
    i_draw_max_a=None, i_draw_typ_a=None, i_inrush_a=None, protocol=None,
    diff_member=None, reference_role=None, nominal_v=None, signal_integrity=None,
) -> SignalProfile:
    return SignalProfile(
        id=id, domain=domain, direction=direction, physical_layer=physical_layer,
        reference_role=reference_role,
        electrical=ElectricalSpec(
            nominal_v=nominal_v, operating_v=operating_v, abs_max_v=abs_max_v,
            v_oh_min=v_oh_min, v_ol_max=v_ol_max, v_ih_min=v_ih_min, v_il_max=v_il_max,
            i_supply_max_a=i_supply_max_a, i_supply_continuous_a=i_supply_continuous_a,
            i_draw_max_a=i_draw_max_a, i_draw_typ_a=i_draw_typ_a, i_inrush_a=i_inrush_a,
        ),
        protocol=protocol, diff_member=diff_member, signal_integrity=signal_integrity,
    )


def _port(id, profile_ref, net_ref=None, node_ref="node_a", interface_ref="if_a") -> NodePort:
    return NodePort(id=id, node_ref=node_ref, interface_ref=interface_ref, pin_name=id,
                     profile_ref=profile_ref, net_ref=net_ref)


def _net(id="net_a", net_class=NetClass.signal, members=None, **kw) -> Net:
    return Net(id=id, name=id, net_class=net_class, members=members or [], **kw)


def _seg(id, net_ref, from_ref, to_ref, from_kind="port", to_kind="port",
         awg=22, mm2=0.34, temp_c=105.0, length_mm=100.0, construction="stranded",
         cable_ref=None, cable_core=None, bundle_refs=None, rating_v=300.0) -> Segment:
    return Segment(
        id=id, net_ref=net_ref,
        **{"from": Endpoint(kind=from_kind, ref=from_ref)},
        to=Endpoint(kind=to_kind, ref=to_ref),
        conductor=ConductorSpec(
            gauge=GaugeSpec(awg=awg, mm2=mm2), construction=construction,
            insulation=InsulationSpec(temp_rating_c=temp_c, rating_v=rating_v),
        ),
        length_mm=length_mm, cable_ref=cable_ref, cable_core=cable_core,
        bundle_refs=bundle_refs or [],
    )


# ── E-004 ─────────────────────────────────────────────────────────────────────

class TestE004:
    def test_passing_roles_match(self):
        p_prof = _prof("p_p", domain=Domain.differential, direction=Direction.bidirectional,
                        diff_member=DiffMember(pair_role="P", partner_role="N"))
        n_prof = _prof("p_n", domain=Domain.differential, direction=Direction.bidirectional,
                        diff_member=DiffMember(pair_role="N", partner_role="P"))
        net_p = _net("net_p", members=["a"])
        net_n = _net("net_n", members=["b"])
        ports = [_port("a", "p_p", "net_p"), _port("b", "p_n", "net_n")]
        pair = DifferentialPair(id="pair1", nets={"P": "net_p", "N": "net_n"})
        diags = check_e004([pair], [net_p, net_n], ports, {"p_p": p_prof, "p_n": n_prof})
        assert not diags

    def test_failing_swapped_roles(self):
        p_prof = _prof("p_p", domain=Domain.differential, direction=Direction.bidirectional,
                        diff_member=DiffMember(pair_role="P", partner_role="N"))
        n_prof = _prof("p_n", domain=Domain.differential, direction=Direction.bidirectional,
                        diff_member=DiffMember(pair_role="N", partner_role="P"))
        # CAN_H/CAN_L swapped: P-role port lands on the net registered as N
        net_p = _net("net_p", members=["b"])
        net_n = _net("net_n", members=["a"])
        ports = [_port("a", "p_p", "net_n"), _port("b", "p_n", "net_p")]
        pair = DifferentialPair(id="pair1", nets={"P": "net_p", "N": "net_n"})
        diags = check_e004([pair], [net_p, net_n], ports, {"p_p": p_prof, "p_n": n_prof})
        assert len(diags) == 2
        assert all(d.rule_id == "E-004" for d in diags)


# ── E-005 ─────────────────────────────────────────────────────────────────────

class TestE005:
    def test_passing_single_driver(self):
        drv = _prof("drv", direction=Direction.output)
        rcv = _prof("rcv", direction=Direction.input)
        net = _net(members=["a", "b"])
        ports = [_port("a", "drv", net.id), _port("b", "rcv", net.id)]
        diags = check_e005([net], ports, {"drv": drv, "rcv": rcv})
        assert not diags

    def test_passing_multiple_open_drain(self):
        od1 = _prof("od1", direction=Direction.open_drain)
        od2 = _prof("od2", direction=Direction.open_drain)
        net = _net(members=["a", "b"])
        ports = [_port("a", "od1", net.id), _port("b", "od2", net.id)]
        diags = check_e005([net], ports, {"od1": od1, "od2": od2})
        assert not diags

    def test_failing_two_push_pull_outputs(self):
        d1 = _prof("d1", direction=Direction.output)
        d2 = _prof("d2", direction=Direction.output)
        net = _net(members=["a", "b"])
        ports = [_port("a", "d1", net.id), _port("b", "d2", net.id)]
        diags = check_e005([net], ports, {"d1": d1, "d2": d2})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-005"


# ── E-006 ─────────────────────────────────────────────────────────────────────

class TestE006:
    def test_passing_has_driver(self):
        drv = _prof("drv", direction=Direction.output)
        rcv = _prof("rcv", direction=Direction.input)
        net = _net(members=["a", "b"])
        ports = [_port("a", "drv", net.id), _port("b", "rcv", net.id)]
        diags = check_e006([net], ports, {"drv": drv, "rcv": rcv})
        assert not diags

    def test_failing_only_inputs(self):
        r1 = _prof("r1", direction=Direction.input)
        r2 = _prof("r2", direction=Direction.input)
        net = _net(members=["a", "b"])
        ports = [_port("a", "r1", net.id), _port("b", "r2", net.id)]
        diags = check_e006([net], ports, {"r1": r1, "r2": r2})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-006"

    def test_passing_power_net_exempt(self):
        r1 = _prof("r1", domain=Domain.power, direction=Direction.input)
        net = _net(net_class=NetClass.power, members=["a"])
        ports = [_port("a", "r1", net.id)]
        diags = check_e006([net], ports, {"r1": r1})
        assert not diags


# ── E-007 ─────────────────────────────────────────────────────────────────────

class TestE007:
    def test_passing_connected(self):
        prof = _prof()
        ports = [_port("a", "prof", "net_a")]
        diags = check_e007(ports, {"prof": prof})
        assert not diags

    def test_passing_marked_no_connect(self):
        prof = _prof("nc", domain=Domain.no_connect, direction=Direction.passive)
        ports = [_port("a", "nc", None)]
        diags = check_e007(ports, {"nc": prof})
        assert not diags

    def test_failing_floating(self):
        prof = _prof()
        ports = [_port("a", "prof", None)]
        diags = check_e007(ports, {"prof": prof})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-007"


# ── E-008 ─────────────────────────────────────────────────────────────────────

class TestE008:
    def test_passing_same_reference(self):
        p1 = _prof("p1", reference_role="gnd_logic")
        p2 = _prof("p2", direction=Direction.input, reference_role="gnd_logic")
        net = _net(members=["a", "b"])
        ports = [_port("a", "p1", net.id), _port("b", "p2", net.id)]
        diags = check_e008([net], ports, {"p1": p1, "p2": p2})
        assert not diags

    def test_failing_different_reference(self):
        p1 = _prof("p1", reference_role="gnd_chassis")
        p2 = _prof("p2", direction=Direction.input, reference_role="gnd_logic")
        net = _net(members=["a", "b"])
        ports = [_port("a", "p1", net.id), _port("b", "p2", net.id)]
        diags = check_e008([net], ports, {"p1": p1, "p2": p2})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-008"


# ── E-009 ─────────────────────────────────────────────────────────────────────

class TestE009:
    def test_passing_within_range(self):
        drv = _prof("drv", domain=Domain.analog, direction=Direction.output, operating_v=(1.0, 4.0))
        rcv = _prof("rcv", domain=Domain.analog, direction=Direction.input, operating_v=(0.0, 5.0))
        net = _net(members=["a", "b"])
        ports = [_port("a", "drv", net.id), _port("b", "rcv", net.id)]
        diags = check_e009([net], ports, {"drv": drv, "rcv": rcv})
        assert not diags

    def test_failing_exceeds_range(self):
        drv = _prof("drv", domain=Domain.analog, direction=Direction.output, operating_v=(0.0, 10.0))
        rcv = _prof("rcv", domain=Domain.analog, direction=Direction.input, operating_v=(0.0, 5.0))
        net = _net(members=["a", "b"])
        ports = [_port("a", "drv", net.id), _port("b", "rcv", net.id)]
        diags = check_e009([net], ports, {"drv": drv, "rcv": rcv})
        assert len(diags) == 1
        assert diags[0].rule_id == "E-009"


# ── E-010 ─────────────────────────────────────────────────────────────────────

class TestE010:
    def test_passing_shielded(self):
        drv = _prof("drv", signal_integrity=SignalIntegrity(max_edge_rate_ns=2))
        rcv = _prof("rcv", direction=Direction.input)
        net = _net(members=["a", "b"])
        ports = [_port("a", "drv", net.id), _port("b", "rcv", net.id)]
        seg = _seg("s1", net.id, "a", "b", bundle_refs=["bnd1"])
        seg.tags = {"placement": "external"}
        bundle = Bundle(id="bnd1", name="B1", sheath=BundleSheath(shield=SheathShield(shielded=True)))
        diags = check_e010([net], ports, [seg], {"drv": drv, "rcv": rcv}, [bundle])
        assert not diags

    def test_failing_unshielded_external(self):
        drv = _prof("drv", signal_integrity=SignalIntegrity(max_edge_rate_ns=2))
        rcv = _prof("rcv", direction=Direction.input)
        net = _net(members=["a", "b"])
        ports = [_port("a", "drv", net.id), _port("b", "rcv", net.id)]
        seg = _seg("s1", net.id, "a", "b")
        seg.tags = {"placement": "external"}
        diags = check_e010([net], ports, [seg], {"drv": drv, "rcv": rcv}, [])
        assert len(diags) == 1
        assert diags[0].rule_id == "E-010"


# ── PW-002 / PW-003 / PW-004 / PW-006 ────────────────────────────────────────

class TestPwRules:
    def _net_and_profs(self, supply_max=10.0, supply_cont=10.0, draw_max=9.0, draw_typ=5.0,
                        inrush=0.0, second_source=False):
        net = _net("net_pwr", net_class=NetClass.power, members=["src", "sink"] + (["src2"] if second_source else []))
        profs = {
            "src": _prof("src", domain=Domain.power, direction=Direction.output,
                         i_supply_max_a=supply_max, i_supply_continuous_a=supply_cont),
            "sink": _prof("sink", domain=Domain.power, direction=Direction.input,
                          i_draw_max_a=draw_max, i_draw_typ_a=draw_typ, i_inrush_a=inrush),
        }
        ports = [_port("src", "src", net.id), _port("sink", "sink", net.id)]
        if second_source:
            profs["src2"] = _prof("src2", domain=Domain.power, direction=Direction.output, i_supply_max_a=supply_max)
            ports.append(_port("src2", "src2", net.id))
        return net, ports, profs

    def test_pw002_passing_within_headroom(self):
        net, ports, profs = self._net_and_profs(draw_max=5.0, supply_cont=10.0)
        diags = check_pw002_pw003_pw004_pw006([net], ports, profs)
        assert "PW-002" not in {d.rule_id for d in diags}

    def test_pw002_failing_over_headroom_threshold(self):
        net, ports, profs = self._net_and_profs(draw_max=9.0, supply_cont=10.0)  # 90% > 80%
        diags = check_pw002_pw003_pw004_pw006([net], ports, profs)
        assert "PW-002" in {d.rule_id for d in diags}

    def test_pw003_failing_typical_exceeds_continuous(self):
        net, ports, profs = self._net_and_profs(draw_typ=12.0, supply_cont=10.0, draw_max=1.0)
        diags = check_pw002_pw003_pw004_pw006([net], ports, profs)
        assert "PW-003" in {d.rule_id for d in diags}

    def test_pw004_failing_inrush(self):
        net, ports, profs = self._net_and_profs(inrush=20.0, supply_max=10.0, draw_max=1.0, supply_cont=10.0)
        diags = check_pw002_pw003_pw004_pw006([net], ports, profs, RuleConfig(inrush_factor=1.0))
        assert "PW-004" in {d.rule_id for d in diags}

    def test_pw004_passing_inrush_within_budget(self):
        net, ports, profs = self._net_and_profs(inrush=5.0, supply_max=10.0, draw_max=1.0, supply_cont=10.0)
        diags = check_pw002_pw003_pw004_pw006([net], ports, profs)
        assert "PW-004" not in {d.rule_id for d in diags}

    def test_pw006_failing_multiple_sources_unparalleled(self):
        net, ports, profs = self._net_and_profs(second_source=True, draw_max=1.0, supply_cont=20.0)
        diags = check_pw002_pw003_pw004_pw006([net], ports, profs)
        assert "PW-006" in {d.rule_id for d in diags}

    def test_pw006_passing_paralleled_declared(self):
        net, ports, profs = self._net_and_profs(second_source=True, draw_max=1.0, supply_cont=20.0)
        net.paralleled = True
        diags = check_pw002_pw003_pw004_pw006([net], ports, profs)
        assert "PW-006" not in {d.rule_id for d in diags}


# ── B-001 / B-002 / B-003 ─────────────────────────────────────────────────────

class TestBusPairRules:
    def test_b001_failing_missing_net(self):
        pair = DifferentialPair(id="pr1", nets={"P": "net_ghost", "N": "net_n"})
        diags = check_b001_b002_b003([pair], [_net("net_n")], [])
        assert any(d.rule_id == "B-001" for d in diags)

    def test_b002_passing_same_cable_set(self):
        net_p, net_n = _net("net_p"), _net("net_n")
        segs = [
            _seg("sp", "net_p", "a", "b", cable_ref="cbl1"),
            _seg("sn", "net_n", "c", "d", cable_ref="cbl1"),
        ]
        pair = DifferentialPair(id="pr1", nets={"P": "net_p", "N": "net_n"}, require_same_cable=True)
        diags = check_b001_b002_b003([pair], [net_p, net_n], segs)
        assert "B-002" not in {d.rule_id for d in diags}

    def test_b002_failing_different_cables(self):
        net_p, net_n = _net("net_p"), _net("net_n")
        segs = [
            _seg("sp", "net_p", "a", "b", cable_ref="cbl1"),
            _seg("sn", "net_n", "c", "d", cable_ref="cbl2"),
        ]
        pair = DifferentialPair(id="pr1", nets={"P": "net_p", "N": "net_n"}, require_same_cable=True)
        diags = check_b001_b002_b003([pair], [net_p, net_n], segs)
        assert any(d.rule_id == "B-002" for d in diags)

    def test_b003_failing_skew(self):
        net_p, net_n = _net("net_p"), _net("net_n")
        segs = [
            _seg("sp", "net_p", "a", "b", length_mm=1000.0),
            _seg("sn", "net_n", "c", "d", length_mm=800.0),
        ]
        pair = DifferentialPair(id="pr1", nets={"P": "net_p", "N": "net_n"},
                                 spec=DiffPairSpec(max_skew_mm=50))
        diags = check_b001_b002_b003([pair], [net_p, net_n], segs)
        assert any(d.rule_id == "B-003" for d in diags)

    def test_b003_passing_within_skew(self):
        net_p, net_n = _net("net_p"), _net("net_n")
        segs = [
            _seg("sp", "net_p", "a", "b", length_mm=1000.0),
            _seg("sn", "net_n", "c", "d", length_mm=995.0),
        ]
        pair = DifferentialPair(id="pr1", nets={"P": "net_p", "N": "net_n"},
                                 spec=DiffPairSpec(max_skew_mm=50))
        diags = check_b001_b002_b003([pair], [net_p, net_n], segs)
        assert not diags


# ── B-004 / B-005 ─────────────────────────────────────────────────────────────

def _bus(domains, bridges=None, bitrate=1000000):
    return Bus(id="bus1", name="Bus 1", protocol=ProtocolSpec(name="CAN", bitrate=bitrate),
               domains=domains, bridges=bridges or [])


class TestBusTermination:
    def test_b004_passing_correct_count(self):
        d = BusDomain(id="wire", physical_layer="can_hs_5v", termination=BusTermination(required_count=2, ohms=120),
                      members=[BusMember(node_ref="n1", interface_ref="i1", position=0, terminated=True),
                               BusMember(node_ref="n2", interface_ref="i2", position=1, terminated=True)])
        diags = check_b004_b005([_bus([d])])
        assert "B-004" not in {x.rule_id for x in diags}

    def test_b004_failing_wrong_count(self):
        d = BusDomain(id="wire", physical_layer="can_hs_5v", termination=BusTermination(required_count=2, ohms=120),
                      members=[BusMember(node_ref="n1", interface_ref="i1", position=0, terminated=True)])
        diags = check_b004_b005([_bus([d])])
        assert any(x.rule_id == "B-004" for x in diags)

    def test_b005_passing_terminators_at_extremes(self):
        d = BusDomain(id="wire", physical_layer="can_hs_5v", topology="linear",
                      members=[BusMember(node_ref="n1", interface_ref="i1", position=0, terminated=True),
                               BusMember(node_ref="n2", interface_ref="i2", position=1, terminated=False),
                               BusMember(node_ref="n3", interface_ref="i3", position=2, terminated=True)])
        diags = check_b004_b005([_bus([d])])
        assert "B-005" not in {x.rule_id for x in diags}

    def test_b005_failing_terminator_at_middle(self):
        d = BusDomain(id="wire", physical_layer="can_hs_5v", topology="linear",
                      members=[BusMember(node_ref="n1", interface_ref="i1", position=0, terminated=False),
                               BusMember(node_ref="n2", interface_ref="i2", position=1, terminated=True),
                               BusMember(node_ref="n3", interface_ref="i3", position=2, terminated=True)])
        diags = check_b004_b005([_bus([d])])
        assert any(x.rule_id == "B-005" for x in diags)


# ── B-007 ─────────────────────────────────────────────────────────────────────

class TestB007:
    def test_passing_connected(self):
        node = Node(id="n1", name="N1", interfaces=[Interface(id="i1", name="I1", port_refs=["p1"])])
        port = _port("p1", "prof", "net_wire", node_ref="n1", interface_ref="i1")
        d = BusDomain(id="wire", physical_layer="can_hs_5v", nets={"P": "net_wire"},
                      members=[BusMember(node_ref="n1", interface_ref="i1")])
        diags = check_b007([_bus([d])], [node], [port])
        assert not diags

    def test_failing_wrong_net(self):
        node = Node(id="n1", name="N1", interfaces=[Interface(id="i1", name="I1", port_refs=["p1"])])
        port = _port("p1", "prof", "net_other", node_ref="n1", interface_ref="i1")
        d = BusDomain(id="wire", physical_layer="can_hs_5v", nets={"P": "net_wire"},
                      members=[BusMember(node_ref="n1", interface_ref="i1")])
        diags = check_b007([_bus([d])], [node], [port])
        assert any(x.rule_id == "B-007" for x in diags)


# ── B-008 ─────────────────────────────────────────────────────────────────────

class TestB008:
    def test_passing_within_fanout(self):
        d = BusDomain(id="wire", physical_layer="can_hs_5v", max_nodes=4,
                      members=[BusMember(node_ref=f"n{i}", interface_ref="i") for i in range(3)])
        diags = check_b008([_bus([d])])
        assert not diags

    def test_failing_exceeds_fanout(self):
        d = BusDomain(id="wire", physical_layer="can_hs_5v", max_nodes=2,
                      members=[BusMember(node_ref=f"n{i}", interface_ref="i") for i in range(3)])
        diags = check_b008([_bus([d])])
        assert any(x.rule_id == "B-008" for x in diags)


# ── B-009 ─────────────────────────────────────────────────────────────────────

class TestB009:
    def test_passing_within_bitrate(self):
        node = Node(id="n1", name="N1", interfaces=[Interface(id="i1", name="I1", port_refs=["p1"])])
        port = _port("p1", "prof", "net_wire", node_ref="n1", interface_ref="i1")
        prof = _prof("prof", protocol=ProtocolSpec(name="CAN", bitrate_max=5000000))
        d = BusDomain(id="wire", physical_layer="can_hs_5v", nets={"P": "net_wire"},
                      members=[BusMember(node_ref="n1", interface_ref="i1")])
        diags = check_b009([_bus([d], bitrate=1000000)], [node], [port], {"prof": prof})
        assert not diags

    def test_failing_exceeds_bitrate(self):
        node = Node(id="n1", name="N1", interfaces=[Interface(id="i1", name="I1", port_refs=["p1"])])
        port = _port("p1", "prof", "net_wire", node_ref="n1", interface_ref="i1")
        prof = _prof("prof", protocol=ProtocolSpec(name="CAN", bitrate_max=500000))
        d = BusDomain(id="wire", physical_layer="can_hs_5v", nets={"P": "net_wire"},
                      members=[BusMember(node_ref="n1", interface_ref="i1")])
        diags = check_b009([_bus([d], bitrate=1000000)], [node], [port], {"prof": prof})
        assert any(x.rule_id == "B-009" for x in diags)


# ── B-010 / B-011 ─────────────────────────────────────────────────────────────

class TestB010B011:
    def test_passing_bridge_covers_domains(self):
        logic = BusDomain(id="logic", physical_layer="can_logic_3v3",
                          members=[BusMember(node_ref="xcvr", interface_ref="il")])
        wire = BusDomain(id="wire", physical_layer="can_hs_5v",
                         members=[BusMember(node_ref="xcvr", interface_ref="iw")])
        bridge = BusBridge(node_ref="xcvr", from_domain="logic", to_domain="wire")
        diags = check_b010_b011([_bus([logic, wire], bridges=[bridge])])
        assert not diags

    def test_failing_no_bridge_between_domains(self):
        logic = BusDomain(id="logic", physical_layer="can_logic_3v3",
                          members=[BusMember(node_ref="xcvr", interface_ref="il")])
        wire = BusDomain(id="wire", physical_layer="can_hs_5v",
                         members=[BusMember(node_ref="xcvr", interface_ref="iw")])
        diags = check_b010_b011([_bus([logic, wire])])
        assert any(x.rule_id == "B-010" for x in diags)

    def test_failing_bridge_node_not_member_of_both(self):
        logic = BusDomain(id="logic", physical_layer="can_logic_3v3",
                          members=[BusMember(node_ref="xcvr", interface_ref="il")])
        wire = BusDomain(id="wire", physical_layer="can_hs_5v",
                         members=[BusMember(node_ref="other_node", interface_ref="iw")])
        bridge = BusBridge(node_ref="xcvr", from_domain="logic", to_domain="wire")
        diags = check_b010_b011([_bus([logic, wire], bridges=[bridge])])
        assert any(x.rule_id == "B-011" for x in diags)


# ── P-001 (ampacity) ──────────────────────────────────────────────────────────

class TestP001:
    def test_passing_within_ampacity(self):
        net = _net("net_pwr", net_class=NetClass.power, members=["src", "sink"],
                    constraints=NetConstraints(expected_current_a=2.0))
        ports = [_port("src", "src", net.id), _port("sink", "sink", net.id)]
        profs = {"src": _prof("src", domain=Domain.power, direction=Direction.output, i_supply_max_a=5.0),
                 "sink": _prof("sink", domain=Domain.power, direction=Direction.input, i_draw_max_a=2.0)}
        seg = _seg("s1", net.id, "src", "sink", awg=18, temp_c=105.0)  # ~20A base, well over 2A
        graphs = build_net_graphs([net], [seg], ports)
        amp, der = load_ampacity_table(LIB), load_derating_table(LIB)
        diags = check_p001([net], [seg], ports, [], graphs, profs, amp, der)
        assert not diags

    def test_failing_exceeds_ampacity(self):
        net = _net("net_pwr", net_class=NetClass.power, members=["src", "sink"],
                    constraints=NetConstraints(expected_current_a=20.0))
        ports = [_port("src", "src", net.id), _port("sink", "sink", net.id)]
        profs = {"src": _prof("src", domain=Domain.power, direction=Direction.output, i_supply_max_a=25.0),
                 "sink": _prof("sink", domain=Domain.power, direction=Direction.input, i_draw_max_a=20.0)}
        # 24 AWG base ampacity is a few amps at most -- 20A blows way past it
        seg = _seg("s1", net.id, "src", "sink", awg=24, temp_c=105.0)
        graphs = build_net_graphs([net], [seg], ports)
        amp, der = load_ampacity_table(LIB), load_derating_table(LIB)
        diags = check_p001([net], [seg], ports, [], graphs, profs, amp, der)
        assert len(diags) == 1
        assert diags[0].rule_id == "P-001"

    def test_passing_missing_gauge_data_skipped(self):
        net = _net("net_pwr", net_class=NetClass.power, members=["src", "sink"],
                    constraints=NetConstraints(expected_current_a=100.0))
        ports = [_port("src", "src", net.id), _port("sink", "sink", net.id)]
        profs = {"src": _prof("src", domain=Domain.power, direction=Direction.output, i_supply_max_a=100.0),
                 "sink": _prof("sink", domain=Domain.power, direction=Direction.input, i_draw_max_a=100.0)}
        seg = Segment(id="s1", net_ref=net.id, **{"from": Endpoint(kind="port", ref="src")},
                      to=Endpoint(kind="port", ref="sink"))  # no gauge/insulation data at all
        graphs = build_net_graphs([net], [seg], ports)
        amp, der = load_ampacity_table(LIB), load_derating_table(LIB)
        diags = check_p001([net], [seg], ports, [], graphs, profs, amp, der)
        assert not diags  # no data => no false positive


# ── P-002 (voltage drop) ──────────────────────────────────────────────────────

class TestP002:
    def test_passing_within_budget(self):
        net = _net("net_pwr", net_class=NetClass.power, members=["src", "sink"],
                    constraints=NetConstraints(max_voltage_drop_v=1.0))
        ports = [_port("src", "src", net.id), _port("sink", "sink", net.id)]
        profs = {"src": _prof("src", domain=Domain.power, direction=Direction.output, i_supply_max_a=5.0),
                 "sink": _prof("sink", domain=Domain.power, direction=Direction.input, i_draw_max_a=1.0)}
        seg = _seg("s1", net.id, "src", "sink", awg=12, length_mm=100.0)  # short, thick: tiny drop
        graphs = build_net_graphs([net], [seg], ports)
        awg_table = load_awg_table(LIB)
        diags = check_p002([net], [seg], ports, graphs, profs, awg_table)
        assert not diags

    def test_failing_exceeds_budget(self):
        net = _net("net_pwr", net_class=NetClass.power, members=["src", "sink"],
                    constraints=NetConstraints(max_voltage_drop_v=0.01))
        ports = [_port("src", "src", net.id), _port("sink", "sink", net.id)]
        profs = {"src": _prof("src", domain=Domain.power, direction=Direction.output, i_supply_max_a=5.0),
                 "sink": _prof("sink", domain=Domain.power, direction=Direction.input, i_draw_max_a=4.0)}
        seg = _seg("s1", net.id, "src", "sink", awg=24, length_mm=5000.0)  # long, thin: big drop
        graphs = build_net_graphs([net], [seg], ports)
        awg_table = load_awg_table(LIB)
        diags = check_p002([net], [seg], ports, graphs, profs, awg_table)
        assert len(diags) == 1
        assert diags[0].rule_id == "P-002"


# ── P-003 (insulation rating) ─────────────────────────────────────────────────

class TestP003:
    def test_passing_adequate_rating(self):
        drv = _prof("drv", domain=Domain.power, direction=Direction.output, nominal_v=24.0)
        net = _net("net_pwr", net_class=NetClass.power, members=["a"])
        ports = [_port("a", "drv", net.id)]
        seg = _seg("s1", net.id, "a", "b", rating_v=300.0)
        diags = check_p003([net], [seg], ports, {"drv": drv})
        assert not diags

    def test_failing_inadequate_rating(self):
        drv = _prof("drv", domain=Domain.power, direction=Direction.output, nominal_v=600.0)
        net = _net("net_pwr", net_class=NetClass.power, members=["a"])
        ports = [_port("a", "drv", net.id)]
        seg = _seg("s1", net.id, "a", "b", rating_v=300.0)  # 300V rated on a 600V*1.5=900V-required net
        diags = check_p003([net], [seg], ports, {"drv": drv})
        assert len(diags) == 1
        assert diags[0].rule_id == "P-003"


# ── P-005 (duplicate cable core) ──────────────────────────────────────────────

class TestP005:
    def test_passing_distinct_cores(self):
        segs = [_seg("s1", "net_a", "a", "b", cable_ref="cbl1", cable_core=1),
                _seg("s2", "net_a", "c", "d", cable_ref="cbl1", cable_core=2)]
        diags = check_p005(segs, [])
        assert not diags

    def test_failing_same_core_twice(self):
        segs = [_seg("s1", "net_a", "a", "b", cable_ref="cbl1", cable_core=1),
                _seg("s2", "net_a", "c", "d", cable_ref="cbl1", cable_core=1)]
        diags = check_p005(segs, [])
        assert len(diags) == 1
        assert diags[0].rule_id == "P-005"


# ── P-006 (solid core in flexible bundle) ─────────────────────────────────────

class TestP006:
    def test_passing_stranded(self):
        bundle = Bundle(id="b1", name="B1", sheath=BundleSheath(mechanical=SheathMechanical(flexible=True)))
        seg = _seg("s1", "net_a", "a", "b", construction="stranded", bundle_refs=["b1"])
        diags = check_p006([seg], [bundle])
        assert not diags

    def test_failing_solid_in_flexible_bundle(self):
        bundle = Bundle(id="b1", name="B1", sheath=BundleSheath(mechanical=SheathMechanical(flexible=True)))
        seg = _seg("s1", "net_a", "a", "b", construction="solid", bundle_refs=["b1"])
        diags = check_p006([seg], [bundle])
        assert len(diags) == 1
        assert diags[0].rule_id == "P-006"


# ── P-007 (missing measured length) ───────────────────────────────────────────

class TestP007:
    def test_passing_policy_off(self):
        seg = Segment(id="s1", net_ref="net_a", **{"from": Endpoint(kind="port", ref="a")},
                      to=Endpoint(kind="port", ref="b"))
        diags = check_p007([seg], RuleConfig(release_require_measured_lengths=False))
        assert not diags

    def test_failing_policy_on_no_length(self):
        seg = Segment(id="s1", net_ref="net_a", **{"from": Endpoint(kind="port", ref="a")},
                      to=Endpoint(kind="port", ref="b"))
        diags = check_p007([seg], RuleConfig(release_require_measured_lengths=True))
        assert len(diags) == 1
        assert diags[0].rule_id == "P-007"

    def test_passing_policy_on_with_measured_length(self):
        seg = _seg("s1", "net_a", "a", "b", length_mm=500.0)
        seg.length_source = "measured"
        diags = check_p007([seg], RuleConfig(release_require_measured_lengths=True))
        assert not diags


# ── SH-001 .. SH-007 ───────────────────────────────────────────────────────────

class TestSheathRules:
    def test_sh001_failing_overfill(self):
        b = Bundle(id="b1", name="B1", computed=BundleComputed(fill_pct=80.0),
                   sheath=BundleSheath(max_fill_pct=70.0))
        diags = check_sh001([b])
        assert any(d.rule_id == "SH-001" for d in diags)

    def test_sh001_passing_within_fill(self):
        b = Bundle(id="b1", name="B1", computed=BundleComputed(fill_pct=50.0),
                   sheath=BundleSheath(max_fill_pct=70.0))
        diags = check_sh001([b])
        assert not diags

    def test_sh002_failing_shielded_no_drain(self):
        b = Bundle(id="b1", name="B1", sheath=BundleSheath(shield=SheathShield(shielded=True, drain_net_ref=None)))
        diags = check_sh002([b])
        assert any(d.rule_id == "SH-002" for d in diags)

    def test_sh002_passing_shielded_with_drain(self):
        b = Bundle(id="b1", name="B1", sheath=BundleSheath(shield=SheathShield(shielded=True, drain_net_ref="net_gnd")))
        diags = check_sh002([b])
        assert not diags

    def test_sh003_failing_ambient_out_of_range(self):
        b = Bundle(id="b1", name="B1", computed=BundleComputed(max_ambient_c=150.0),
                   sheath=BundleSheath(temp_range_c=(-40.0, 125.0)))
        diags = check_sh003([b])
        assert any(d.rule_id == "SH-003" for d in diags)

    def test_sh003_passing_ambient_in_range(self):
        b = Bundle(id="b1", name="B1", computed=BundleComputed(max_ambient_c=60.0),
                   sheath=BundleSheath(temp_range_c=(-40.0, 125.0)))
        diags = check_sh003([b])
        assert not diags

    def test_sh004_failing_flexing_zone_not_drag_chain(self):
        b = Bundle(id="b1", name="B1", tags={"zone": "wrist"},
                   sheath=BundleSheath(mechanical=SheathMechanical(drag_chain_rated=False)))
        diags = check_sh004([b])
        assert any(d.rule_id == "SH-004" for d in diags)

    def test_sh004_passing_flexing_zone_drag_chain_rated(self):
        b = Bundle(id="b1", name="B1", tags={"zone": "wrist"},
                   sheath=BundleSheath(mechanical=SheathMechanical(drag_chain_rated=True)))
        diags = check_sh004([b])
        assert not diags

    def test_sh005_failing_child_exceeds_parent_capacity(self):
        parent = Bundle(id="p1", name="P1", sheath=BundleSheath(nominal_id_mm=10.0))
        child = Bundle(id="c1", name="C1", parent_bundle_ref="p1", sheath=BundleSheath(outer_od_mm=15.0))
        diags = check_sh005([parent, child])
        assert any(d.rule_id == "SH-005" for d in diags)

    def test_sh005_passing_child_fits(self):
        parent = Bundle(id="p1", name="P1", sheath=BundleSheath(nominal_id_mm=20.0))
        child = Bundle(id="c1", name="C1", parent_bundle_ref="p1", sheath=BundleSheath(outer_od_mm=15.0))
        diags = check_sh005([parent, child])
        assert not diags

    def test_sh006_failing_drain_mismatch(self):
        cable = Cable(id="cbl1", shield=CableShield(type="braid", drain_net_ref="net_gnd_a"))
        b = Bundle(id="b1", name="B1", cable_refs=["cbl1"],
                   sheath=BundleSheath(shield=SheathShield(shielded=True, drain_net_ref="net_gnd_b")))
        diags = check_sh006([b], [cable])
        assert any(d.rule_id == "SH-006" for d in diags)

    def test_sh006_passing_drain_matches(self):
        cable = Cable(id="cbl1", shield=CableShield(type="braid", drain_net_ref="net_gnd_a"))
        b = Bundle(id="b1", name="B1", cable_refs=["cbl1"],
                   sheath=BundleSheath(shield=SheathShield(shielded=True, drain_net_ref="net_gnd_a")))
        diags = check_sh006([b], [cable])
        assert not diags

    def test_sh007_info_mismatched_cut_length(self):
        b = Bundle(id="b1", name="B1", path_length_mm=500.0, sheath=BundleSheath(cut_length_mm=420.0))
        diags = check_sh007([b])
        assert len(diags) == 1
        assert diags[0].rule_id == "SH-007"
        assert diags[0].severity == "info"

    def test_sh007_no_report_when_not_set(self):
        b = Bundle(id="b1", name="B1", path_length_mm=500.0, sheath=BundleSheath())
        diags = check_sh007([b])
        assert not diags


# ── S-002 (cycle without ring) ─────────────────────────────────────────────────

class TestS002:
    def test_passing_tree(self):
        net = _net(members=["a", "b", "c"])
        segs = [_seg("s1", net.id, "a", "b"), _seg("s2", net.id, "b", "c")]
        diags = check_s002([net], segs)
        assert not diags

    def test_failing_cycle_not_marked_ring(self):
        net = _net(members=["a", "b", "c"])
        segs = [_seg("s1", net.id, "a", "b"), _seg("s2", net.id, "b", "c"), _seg("s3", net.id, "c", "a")]
        diags = check_s002([net], segs)
        assert any(d.rule_id == "S-002" for d in diags)

    def test_passing_cycle_marked_ring(self):
        net = _net(members=["a", "b", "c"], ring=True)
        segs = [_seg("s1", net.id, "a", "b"), _seg("s2", net.id, "b", "c"), _seg("s3", net.id, "c", "a")]
        diags = check_s002([net], segs)
        assert not diags


# ── S-004 (duplicate cavity) ────────────────────────────────────────────────────

class TestS004:
    def test_passing_distinct_cavities(self):
        p1 = _port("p1", "prof", "net_a")
        p1.connector_ref, p1.cavity = "conn1", 1
        p2 = _port("p2", "prof", "net_a")
        p2.connector_ref, p2.cavity = "conn1", 2
        diags = check_s004([p1, p2])
        assert not diags

    def test_failing_duplicate_cavity(self):
        p1 = _port("p1", "prof", "net_a")
        p1.connector_ref, p1.cavity = "conn1", 1
        p2 = _port("p2", "prof", "net_a")
        p2.connector_ref, p2.cavity = "conn1", 1
        diags = check_s004([p1, p2])
        assert len(diags) == 1
        assert diags[0].rule_id == "S-004"
