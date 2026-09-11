# Wiring Harness Design Tool — Implementation Brief

**Audience:** the coding agent implementing this.
**Owner / reviewer:** Aditya.
**Status:** approved design intent, v0.2. Supersedes `harness-tool-spec.md`.

---

## 0. How to use this document

This is a staged build with **mandatory review checkpoints**. At each checkpoint you stop, present the listed artifacts, and wait for explicit approval before writing code for the next milestone.

**Checkpoint protocol — follow exactly:**

1. Complete the milestone's scope. Nothing beyond it.
2. Run the milestone's acceptance criteria and capture real output. Not a description of output — the actual output.
3. Present the artifacts listed under **Show at checkpoint**.
4. State explicitly: what you built, what you deviated from and why, what you are uncertain about, and what the next milestone needs from the reviewer.
5. **Stop.** Do not begin the next milestone. Do not "get a head start." Do not refactor ahead.

If you hit something in this document that is wrong, contradictory, or impossible, stop and say so at the point you find it. Do not silently work around it. The schema in particular is the expensive thing to get wrong, and a bad assumption encoded in M0 costs a rewrite later.

If a milestone's acceptance criteria cannot be met, present what passes and what does not. Partial with an honest report beats complete-looking with a hidden gap.

---

## 1. What this is

A rule-checked wiring harness database with a browser UI. Projects are plain JSON files on disk. A validation engine runs on every edit and enforces electrical intent: voltage compatibility, protocol matching, bus termination, current budgets, wire ampacity, and user-defined rules driven by tags.

Primary user is Piqoid's hardware team designing SCARA robot harnesses. It must eventually ship as a desktop executable, and projects must be portable between machines that have never talked to each other.

**In scope for v1:** the entity model, the validation engine, a graph + table editor, manufacturing exports, portable project bundles.

**Out of scope for v1:** 3D routing, formboard drawings, PCB layout, board-level schematic capture, real-time multi-user editing, cloud hosting.

---

## 2. Non-negotiable modelling decisions

These were decided deliberately. Do not re-litigate them mid-build.

### 2.1 Nets and segments are separate

| Concept | Definition | Cardinality |
|---|---|---|
| **Net** | A logical equipotential — the set of pins that are electrically common. A hyperedge. | 1 net : N ports |
| **Segment** | One physical conductor between exactly two termination points. | 1 net : M segments |

A three-pin net can be a daisy chain, a star from a splice, or three home runs. Same net, three different cut lists, three different stub lengths.

**The net is the electrical contract. The segment is the physical realisation.** Validation runs against nets. Manufacturing output comes from segments. A net is valid only if its segments form a connected graph spanning all member ports.

### 2.2 Signal types are structural, not enumerated

A pin's type is a set of constraints, and compatibility is constraint satisfaction. Do **not** implement an enum of signal names — that list never stops growing and cannot express "5 V tolerant 3.3 V CMOS input."

### 2.3 Tolerance is separate from drive capability

`operating_v` is what a pin drives or expects. `abs_max_v` is what it survives. A 24 V net on a 5 V enable pin is an `abs_max_v` violation, not a logic-level violation. Different rule, different message, different severity. Conflating them produces useless error text.

### 2.4 Bus membership is `(node, interface)`, never `node`

This is how one node sits on two CAN networks with no special casing.

### 2.5 Cable ≠ bundle

A cable is a purchased multiconductor part with a jacket and fixed cores. A bundle is a design grouping of things routed together. Both exist. See §3.8 and §6.4.

---

## 3. Entity model

All JSON below is illustrative of shape, not exhaustive of fields. Pydantic models are the source of truth; generate JSON Schema from them.

### 3.1 SignalProfile

```json
{
  "id": "prof_dig_in_5v_ttl",
  "type": "signal_profile",
  "domain": "digital",
  "direction": "input",
  "physical_layer": "logic_5v",
  "reference_role": "gnd_logic",
  "protocol": null,
  "diff_member": null,
  "electrical": {
    "nominal_v": 5.0,
    "operating_v": [0.0, 5.0],
    "abs_max_v": [-0.5, 5.5],
    "v_ih_min": 2.0,
    "v_il_max": 0.8,
    "i_draw_typ_a": 0.008,
    "i_draw_max_a": 0.012
  }
}
```

| Field | Values / meaning |
|---|---|
| `domain` | `digital` \| `analog` \| `power` \| `ground` \| `differential` \| `bus_abstract` \| `passive` \| `no_connect` |
| `direction` | `input` \| `output` \| `bidirectional` \| `open_drain` \| `open_source` \| `high_z` \| `passive` |
| `physical_layer` | See §3.2. The electrical realisation of a protocol. |
| `operating_v` | Range driven (output) or expected (input) |
| `abs_max_v` | Survivable envelope. Violation = hard error. |
| `v_oh_min` / `v_ol_max` | Driver capability |
| `v_ih_min` / `v_il_max` | Receiver thresholds |
| `reference_role` | Which ground this pin is referenced to. Catches isolation-barrier crossings. |

**Power fields** (§3.3 covers the rules):

```json
"electrical": {
  "nominal_v": 24.0,
  "operating_v": [22.8, 25.2],
  "abs_max_v": [-0.5, 30.0],
  "i_supply_max_a": 10.0,
  "i_supply_continuous_a": 8.0,
  "i_draw_typ_a": null,
  "i_draw_max_a": null,
  "i_inrush_a": null,
  "i_inrush_duration_ms": null
}
```

A source declares `i_supply_*` and leaves `i_draw_*` null. A sink does the reverse. A pin that is both (a bus-powered pass-through) may declare both.

### 3.2 `physical_layer` — how the transceiver case is modelled

**Decision: the transceiver is a member of the CAN network.** It is not excluded. What separates the logic side from the wire side is `physical_layer`, not bus membership.

`physical_layer` values (extensible, stored as a library enum):

```
logic_3v3, logic_5v, logic_1v8,
can_logic_3v3, can_logic_5v,     // transceiver-facing TX/RX
can_hs_5v, can_fd_5v, can_sic_5v,
rs485_5v, rs232, lin_12v,
ethernet_mdi, ethernet_rmii, ethernet_rgmii,
analog_se, analog_diff, current_loop,
power_dc, ground
```

So:

```json
// MCU side, option A: CAN-aware
{ "id": "prof_can_tx_3v3", "domain": "digital", "direction": "output",
  "physical_layer": "can_logic_3v3",
  "protocol": { "name": "CAN" },
  "electrical": { "operating_v": [0, 3.3], "abs_max_v": [-0.3, 3.6],
                  "v_oh_min": 2.9, "v_ol_max": 0.4 } }

// MCU side, option B: generic digital, protocol-agnostic
{ "id": "prof_dig_out_3v3_hs", "domain": "digital", "direction": "output",
  "physical_layer": "logic_3v3",
  "protocol": null,
  "electrical": { "operating_v": [0, 3.3], "abs_max_v": [-0.3, 3.6],
                  "v_oh_min": 2.9, "v_ol_max": 0.4 },
  "signal_integrity": { "max_edge_rate_ns": 5, "max_freq_hz": 8000000 } }

// Bus side
{ "id": "prof_can_h_5v", "domain": "differential", "direction": "bidirectional",
  "physical_layer": "can_hs_5v",
  "protocol": { "name": "CAN", "variants": ["CAN_2B","CAN_FD"], "bitrate_max": 5000000 },
  "diff_member": { "pair_role": "P", "partner_role": "N" },
  "electrical": { "operating_v": [2.0, 4.0], "abs_max_v": [-27.0, 40.0], "recessive_v": 2.5 },
  "differential": { "v_diff_dominant_min": 1.5, "v_diff_recessive_max": 0.5,
                    "v_common_mode": [-2.0, 7.0] } }
```

Both MCU-side options are supported. Option A gives stronger checking (a CAN_TX pin cannot land on a random GPIO net). Option B is the escape hatch when you do not want that. Ship both in the starter library.

**Rule E-003 checks `protocol` AND `physical_layer` together.** A `can_logic_3v3` port cannot join a `can_hs_5v` net even though both say protocol CAN. That is what keeps the voltage rules correct without excluding the transceiver from the bus.

### 3.3 Bus — with domains

```json
{
  "id": "bus_can0",
  "type": "bus",
  "name": "Drive CAN",
  "protocol": { "name": "CAN", "variant": "CAN_FD", "bitrate": 1000000, "data_bitrate": 5000000 },
  "domains": [
    {
      "id": "logic",
      "physical_layer": "can_logic_3v3",
      "nets": { "TX": "net_can0_tx", "RX": "net_can0_rx" },
      "members": [
        { "node_ref": "node_mcu",  "interface_ref": "if_can0_logic" },
        { "node_ref": "node_xcvr", "interface_ref": "if_xcvr_logic" }
      ]
    },
    {
      "id": "wire",
      "physical_layer": "can_hs_5v",
      "topology": "linear",
      "nets": { "P": "net_can0_h", "N": "net_can0_l", "REF": "net_gnd_logic" },
      "pair_ref": "pair_can0",
      "members": [
        { "node_ref": "node_xcvr", "interface_ref": "if_xcvr_bus", "position": 0, "terminated": true },
        { "node_ref": "node_j1",   "interface_ref": "if_can0",     "position": 1, "terminated": false },
        { "node_ref": "node_j4",   "interface_ref": "if_can0",     "position": 4, "terminated": true }
      ],
      "termination": { "required_count": 2, "ohms": 120 }
    }
  ],
  "bridges": [
    { "node_ref": "node_xcvr", "from_domain": "logic", "to_domain": "wire" }
  ],
  "tags": { "placement": "internal" }
}
```

The transceiver appears in **both** domains and is declared as the bridge. Rules scope accordingly: termination and stub-length apply to the `wire` domain only; bitrate applies bus-wide; voltage and logic-level rules apply per domain. "Show me everything on Drive CAN" returns the whole thing including the MCU.

A bus may have exactly one domain (an RS-485 net with no separate logic side modelled) — `domains` is a list of one. A bus with more than one domain must declare a bridge for each adjacency or B-010 fires.

### 3.4 Net

```json
{
  "id": "net_01JQZ9AA",
  "type": "net",
  "name": "CAN0_H",
  "net_class": "signal",
  "declared_signal": { "profile_ref": "prof_can_h_5v", "mode": "strict" },
  "members": ["nodeport_j1_canh", "nodeport_xcvr_canh"],
  "bus_ref": "bus_can0",
  "bus_domain": "wire",
  "pair_ref": "pair_can0",
  "constraints": {
    "max_voltage_drop_v": null,
    "expected_current_a": 0.05,
    "max_stub_length_mm": 300
  },
  "display": {
    "color": "#e11d48",
    "width_px": 3,
    "style": "solid",
    "label_visible": true
  },
  "tags": { "placement": "internal", "criticality": "safety" }
}
```

`net_class`: `power` | `signal` | `ground` | `shield` | `no_connect`.

**Typing modes.** `strict` = declared up front, every joining port must satisfy it. `inferred` = envelope computed as the union of connected drivers, conflicts reported. New nets default to `inferred`; offer a one-click "lock to current type" that writes the declaration.

**`display` lives in `nets.json`, not `layout.json`.** Net styling is stable design intent that changes rarely. Node positions churn on every session and go in `layout.json`. Do not mix them.

Project-level default styling, overridden per net:

```json
"display_rules": [
  { "match": { "net_class": "ground" },              "color": "#000000", "width_px": 2 },
  { "match": { "net_class": "power" },               "color": "#dc2626", "width_px": 4 },
  { "match": { "tag": { "placement": "external" } }, "style": "dashed" },
  { "match": { "bus_ref": "bus_can0" },              "color": "#0891b2", "width_px": 3 }
]
```

Resolution order: per-net `display` > last matching display rule > net_class default. Show the resolved style and its source in the net inspector so nobody wonders why a colour did not apply.

### 3.5 Segment

```json
{
  "id": "seg_01JQZ9BB",
  "type": "segment",
  "net_ref": "net_01JQZ9AA",
  "from": { "kind": "port",   "ref": "nodeport_xcvr_canh" },
  "to":   { "kind": "splice", "ref": "spl_can_t1" },
  "conductor": {
    "gauge": { "awg": 22, "mm2": 0.34 },
    "construction": "stranded",
    "stranding": "7/30",
    "material": "Cu",
    "plating": "tin",
    "insulation": { "material": "PVC", "rating_v": 300, "temp_rating_c": 105, "od_mm": 1.6 },
    "color": "WH",
    "stripe": "BU"
  },
  "length_mm": 850,
  "length_source": "manual",
  "cable_ref": "cbl_01JQZ9CC",
  "cable_core": 3,
  "bundle_refs": ["bnd_base_to_j1"],
  "label": "W-104",
  "termination": {
    "from": { "part_ref": "term_dt_socket_20awg", "crimp_spec": "DT-20-22" },
    "to":   { "part_ref": "term_splice_butt" }
  },
  "tags": { "placement": "internal" }
}
```

`gauge` accepts either `awg` or `mm2`; store both, keep in sync via a lookup table in `library/tables/awg.json`. **Do not compute AWG↔mm² with a formula** — real cable uses nominal cross-sections that do not match the geometric series at the edges.

Endpoint `kind`: `port` | `splice` | `ring_lug` | `free_end` | `shield_drain` | `connector_cavity`.

`length_source`: `manual` | `measured` | `routed` | `estimated`. Mandatory field. Release gating can require `measured`.

### 3.6 DifferentialPair

```json
{
  "id": "pair_can0",
  "type": "diff_pair",
  "nets": { "P": "net_can0_h", "N": "net_can0_l" },
  "spec": { "z_diff_ohm": 120, "z_tolerance_pct": 10, "twist_lay_mm": 25, "max_skew_mm": 10 },
  "require_same_cable": true,
  "require_same_bundle": true
}
```

First-class because half its constraints are relational: both members present, same twisted pair, length-matched, and a `pair_role: P` port must land on the net registered as `P`. That last one catches swapped CAN_H/CAN_L.

### 3.7 Cable

```json
{
  "id": "cbl_01JQZ9CC",
  "type": "cable",
  "part_ref": "cablepart_lapp_unitronic_4x034",
  "designator": "C12",
  "length_mm": 900,
  "cores": [
    { "index": 1, "color": "BN", "awg": 22, "segment_ref": "seg_aa" },
    { "index": 2, "color": "WH", "awg": 22, "segment_ref": "seg_bb" },
    { "index": 3, "color": "BU", "awg": 22, "segment_ref": "seg_cc" },
    { "index": 4, "color": "BK", "awg": 22, "segment_ref": null }
  ],
  "twisted_pairs": [[1, 2], [3, 4]],
  "shield": {
    "type": "braid", "coverage_pct": 85,
    "drain_net_ref": "net_chassis", "termination": "source_end_only"
  },
  "jacket": { "material": "PUR", "od_mm": 6.5, "temp_c": 80, "drag_chain_rated": true },
  "tags": { "placement": "external" }
}
```

### 3.8 Bundle — with sheath

```json
{
  "id": "bnd_base_to_j1",
  "type": "bundle",
  "name": "Base → J1 trunk",
  "parent_bundle_ref": null,
  "segment_refs": ["seg_aa", "seg_bb", "seg_dd"],
  "cable_refs": ["cbl_01JQZ9CC"],
  "path_length_mm": 780,
  "computed": {
    "conductor_count": 14,
    "bundle_od_mm": 9.2,
    "fill_pct": 62.1,
    "max_ambient_c": 60
  },
  "sheath": {
    "part_ref": "sheath_ty_flex_13",
    "type": "split_loom",
    "material": "PA6",
    "color": "BK",
    "nominal_id_mm": 13.0,
    "wall_mm": 0.8,
    "outer_od_mm": 14.6,
    "max_fill_pct": 70,
    "flame": { "rating": "UL94-V0", "self_extinguishing": true },
    "temp_range_c": [-40, 125],
    "shield": {
      "shielded": true,
      "type": "tinned_copper_braid",
      "coverage_pct": 80,
      "grounded": true,
      "drain_net_ref": "net_chassis",
      "termination": "one_end",
      "bond_point": { "node_ref": "node_base_plate", "note": "M4 stud, star washer" }
    },
    "mechanical": {
      "abrasion_class": "ISO 6722 Class C",
      "flexible": true,
      "min_bend_radius_mm": 40,
      "drag_chain_rated": false,
      "ip_rating": null
    },
    "chemical_resistance": ["oil", "coolant"],
    "notes": ""
  },
  "tags": { "placement": "internal", "zone": "j1_arm" }
}
```

`sheath.type`: `none` | `split_loom` | `braided_sleeve` | `spiral_wrap` | `heatshrink` | `conduit_flexible` | `conduit_rigid` | `harness_tape` | `drag_chain`.

Sheath can reference a library part (`part_ref`) which populates the fields, or be fully inline for one-offs. Same reference-plus-pin drift handling as other library parts (§6.5).

Sheath drives rules SH-001..SH-006 (§4). Notably: a `shielded: true` sheath with `drain_net_ref: null` is an error, and a bundle with `fill_pct > max_fill_pct` is an error.

Bundles nest via `parent_bundle_ref` to give a trunk → branch tree.

### 3.9 Link — abstract field buses

For Ethernet, USB, HDMI and anything where you buy a finished assembly:

```json
{
  "id": "lnk_cam_to_switch",
  "type": "link",
  "abstraction": "abstract",
  "protocol": {
    "name": "Ethernet", "speed": "1000BASE-T", "grade_min": "Cat5e",
    "poe": { "mode": "802.3af", "source": "ep0" }
  },
  "endpoints": [
    { "id": "ep0", "node_ref": "node_switch", "interface_ref": "if_eth2" },
    { "id": "ep1", "node_ref": "node_cam",    "interface_ref": "if_eth0" }
  ],
  "assembly": { "part_ref": "cablepart_m12d_to_rj45_2m", "length_mm": 2000 },
  "bundle_refs": ["bnd_base_to_head"],
  "display": { "color": "#7c3aed", "width_px": 5, "style": "solid" },
  "tags": { "placement": "external" }
}
```

Abstract is not unchecked. Validate: protocol match, connector mating (gender, coding, shell), grade sufficient for speed, PoE source/sink pairing and budget, max length for the standard, bundle diameter contribution, tags.

Provide an **explode** operation converting an abstract link into concrete nets and segments, retaining the original `id` as provenance. One-way. Do not build two-way sync.

### 3.10 Tags

```json
"tag_defs": [
  {
    "key": "placement", "label": "Placement",
    "values": ["internal", "external", "boundary"],
    "applies_to": ["net", "segment", "cable", "bundle", "link", "node"],
    "multi": false,
    "required_on": ["segment", "cable", "link"],
    "inherit": "net_to_segment",
    "display": { "internal": "#2563eb", "external": "#d97706", "boundary": "#7c3aed" }
  },
  {
    "key": "zone", "label": "Robot zone",
    "values": ["base", "j1_arm", "j2_arm", "wrist", "eoat", "cabinet"],
    "applies_to": ["segment", "bundle", "node"], "multi": false
  },
  {
    "key": "criticality", "values": ["standard", "safety", "estop"],
    "applies_to": ["net", "segment"], "multi": false
  }
]
```

Tags are inputs to the rule engine, not just filters:

```json
{ "id": "rule_user_001", "severity": "error", "scope": "bundle",
  "expr": "not (has_tag_value('placement','internal') and has_tag_value('placement','external'))",
  "message": "Internal and external conductors must not share a bundle" }

{ "id": "rule_user_002", "severity": "error", "scope": "bundle",
  "expr": "has_tag_value('placement','external') implies (sheath.flame.rating == 'UL94-V0')",
  "message": "External bundles require V0-rated sheath" }

{ "id": "rule_user_003", "severity": "warning", "scope": "segment",
  "expr": "tag('criticality') == 'estop' implies net.net_class != 'signal' or bundle.sheath.shield.shielded",
  "message": "E-stop signals should run in shielded sheath" }
```

Expression language: small, safe, side-effect-free. **No `eval`.** Parse to an AST, evaluate against a typed entity context. Functions: `tag()`, `has_tag_value()`, `count()`, `sum()`, `any()`, `all()`, `min()`, `max()`, plus dotted attribute access on the entity and its relations. Operators: comparison, boolean, `implies`, `in`. Hold the line here — no loops, no variables, no user functions. If a rule needs more, it becomes a Python rule with an ID.

Tag inheritance is explicit and always overridable at the child level.

---

## 4. Validation rules

Every rule: stable ID, severity, scope, message template, list of implicated entity IDs for UI highlighting.

### Electrical

| ID | Sev | Check |
|---|---|---|
| E-001 | error | **Tolerance.** Net's worst-case voltage envelope ⊄ a member port's `abs_max_v`. |
| E-002 | error | **Logic levels.** Per driver/receiver pair: `V_OH ≥ V_IH` and `V_OL ≤ V_IL`. |
| E-003 | error | **Protocol + physical layer.** All non-passive ports on a net share compatible `protocol` AND `physical_layer`. |
| E-004 | error | **Pair role.** `pair_role: P` port must land on the net registered as `P`. |
| E-005 | error | **Drive conflict.** ≥2 push-pull outputs on one net. OD multiples allowed with a declared pull-up. |
| E-006 | warn | **No driver.** Net has only inputs, is not power/ground, is not declared. |
| E-007 | warn | **Floating port.** Not on any net, not marked `no_connect`. |
| E-008 | warn | **Reference mismatch.** Ports on one signal net reference different grounds. |
| E-009 | error | **Analog range.** Source range exceeds sink input range; current-loop without declared sense resistor. |
| E-010 | warn | **Edge rate.** Generic digital profile with `max_edge_rate_ns` on an unshielded external-tagged segment. |

### Power / current budget

| ID | Sev | Check |
|---|---|---|
| PW-001 | error | **Supply exceeded.** `Σ i_draw_max_a` of sinks on a power net > `Σ i_supply_max_a` of sources. |
| PW-002 | warn | **Headroom.** `Σ i_draw_max_a` > 80% of `Σ i_supply_continuous_a`. Threshold configurable per project. |
| PW-003 | warn | **Typical headroom.** `Σ i_draw_typ_a` > `Σ i_supply_continuous_a`. |
| PW-004 | warn | **Inrush.** `Σ i_inrush_a` > `Σ i_supply_max_a` × inrush factor. Report worst-case simultaneous start. |
| PW-005 | error | **No source.** Net with `net_class: power` and no port declaring `i_supply_max_a`. |
| PW-006 | warn | **Multiple sources.** More than one source on a power net without an explicit `paralleled: true` flag. |
| PW-007 | info | **Budget report.** Not a failure — emit the computed budget per power net for display (source capability, allocated, remaining, % used). |

The current budget must be visible, not only fire on failure. Every power net gets a budget bar in the net inspector: capability, allocated max, allocated typical, headroom. This is the feature, PW-001 is just the alarm on it.

Current flows downstream from the source for segment ampacity (P-001): a segment's expected current is the sum of `i_draw_max_a` of all sinks reachable through it from the source. On a branched net, compute this by rooting the net graph at the source. If there are multiple sources and `paralleled` is not set, report PW-006 and fall back to worst-case (total load on every segment).

### Bus / differential

| ID | Sev | Check |
|---|---|---|
| B-001 | error | Diff pair member net missing. |
| B-002 | error | `require_same_cable` violated. |
| B-003 | warn | Skew: member segment lengths differ by > `max_skew_mm`. |
| B-004 | error | Termination count ≠ `required_count` in the `wire` domain. |
| B-005 | warn | Terminators not at the topological extremes of a `linear` domain. |
| B-006 | warn | Stub length > `max_stub_length_mm`. |
| B-007 | error | Bus member's interface ports not connected to that domain's nets. |
| B-008 | warn | Node count exceeds transceiver rated fan-out. |
| B-009 | error | Bus `bitrate` > lowest `bitrate_max` among member ports. |
| B-010 | error | Multi-domain bus with no declared bridge between adjacent domains. |
| B-011 | error | Declared bridge node is not a member of both domains it bridges. |

### Physical / thermal

| ID | Sev | Check |
|---|---|---|
| P-001 | error | **Ampacity.** Segment current > derated rating for (gauge, insulation temp, ambient, bundle conductor count). |
| P-002 | warn | **Voltage drop.** `2·ρ·L·I / A` > `max_voltage_drop_v`. Round trip. |
| P-003 | error | Insulation voltage rating < net nominal × margin. |
| P-004 | error | Terminal wire-range does not accept the segment gauge. |
| P-005 | error | Two segments on the same core of the same cable. |
| P-006 | warn | Solid-core conductor in a bundle tagged flexing or drag-chain. |
| P-007 | error | Segment length missing where required by release policy. |

### Sheath

| ID | Sev | Check |
|---|---|---|
| SH-001 | error | `computed.fill_pct` > `sheath.max_fill_pct`. |
| SH-002 | error | `sheath.shield.shielded == true` and `drain_net_ref == null`. |
| SH-003 | error | Sheath `temp_range_c` does not contain bundle `max_ambient_c`. |
| SH-004 | warn | Non-drag-chain sheath in a bundle tagged as a flexing zone. |
| SH-005 | warn | Child bundle sheath OD exceeds parent sheath remaining capacity. |
| SH-006 | warn | Shielded sheath drain net differs from the shield net of cables inside it. |
| SH-007 | info | Sheath cut length ≠ `path_length_mm` (report both; sheath is usually cut shorter at breakouts). |

### Structural

| ID | Sev | Check |
|---|---|---|
| S-001 | error | Net's segments do not span all member ports. |
| S-002 | warn | Net graph has a cycle and net is not marked `ring`. |
| S-003 | error | Orphan segment with no net. |
| S-004 | error | Connector cavity assigned twice. |
| S-005 | error | Mating connector gender / coding / position mismatch. |
| S-006 | error | Dangling reference. |
| S-007 | warn | Library instance drifted from current library definition. |

### Waivers

```json
"waivers": [
  { "rule_id": "E-002",
    "target": { "kind": "net", "ref": "net_01JQZ9AA" },
    "reason": "3V3 drives 5V input through a level shifter not modelled in v1",
    "author": "aditya", "created": "2026-09-11", "expires": "2026-12-31" }
]
```

Waivers are project data, appear as their own section in the validation report, and expire. **Ship waivers in the same milestone as the rules they waive.** A tool with no escape hatch gets abandoned the first time it blocks something legitimate.

---

## 5. UI specification

### 5.1 Graph canvas — interaction model

This is the part people will judge the tool on. Be precise.

**Node manipulation**
- Nodes are freely draggable. Grid snap at 10 px, toggleable.
- Multi-select via box drag and shift-click; group drag moves the selection.
- Nodes show their ports on the perimeter, labelled, grouped by interface. Ports show profile name, direction arrow, and a colour chip for domain.
- Collapse/expand: a node with 40 pins can collapse to interface-level stubs.
- Pan with space-drag or middle-drag. Zoom with scroll. `F` fits to view. `Shift+F` fits to selection.

**Wire creation — click-to-click, not drag**
1. Click a port. It enters wiring mode and highlights. A ghost wire follows the cursor.
2. While in wiring mode, hover over any other port runs a **live pre-validation**: the target port highlights green if the connection would be clean, amber if it would produce warnings, red if it would produce errors. A tooltip near the cursor names the specific rule and message.
3. Click the target port to connect. `Esc` cancels. Clicking empty canvas cancels.
4. Clicking a port that would produce an `abs_max_v` (E-001) or protocol (E-003) violation **refuses the connection** with a toast naming the rule. Softer violations (E-002, E-006, PW-002) connect and flag.
5. Clicking an existing net's wire while in wiring mode joins the port to that net rather than creating a new one.

**Wire rendering**
- Orthogonal routing by default, with a per-net toggle for direct/curved.
- Line colour, width and dash come from the resolved net display style (§3.4).
- Hovering any wire highlights the entire net — all segments, all member ports — and dims everything else.
- **Crossing wires are not connected.** A crossing renders as a plain overlap, or optionally a hop/jog arc (project preference).
- **A connection is shown by a large filled junction dot**, KiCad style: filled circle in the net colour, radius ~4.5 px at 100% zoom, scaling with zoom, drawn above the wires. Junction dots appear only at real electrical junctions — a splice, or a T where three or more segments of one net meet. Two segments meeting end to end at a port do not get a dot.
- If a user routes a wire so that it visually passes through an unrelated net's junction, render a warning badge. Visual ambiguity is a real source of build errors.

**Selection and inspection**
- Click a wire → net inspector (class, declared type, members, bus, tags, display style, diagnostics, current budget if power).
- Click a port → port inspector (profile, resolved compatibility with its net, cavity, terminal).
- Click a node → node inspector (part, interfaces, bus memberships, drift status).
- Right-click a net → quick actions: change colour, change width, assign to bundle, add tag, delete.

### 5.2 Cable vs bundle disambiguation

People will pick the wrong one. Build three layers of defence.

**Layer 1 — the picker itself.** When the user creates a grouping, do not present a dropdown with two words. Present two cards:

> **Cable** — a part you buy
> A manufactured multiconductor cable with a jacket and fixed cores. Choose this when the wires already come together in one purchased length — shielded twisted pair, a 4-core PUR cable, a pre-made assembly. The core count, colours and gauges are fixed by the part number. Appears on the BOM as a single line item.
>
> *Examples: LAPP UNITRONIC 4×0.34, M12 A-code patch lead, CAT5e UTP*

> **Bundle** — wires you route together
> A design grouping of separate wires (and whole cables) that travel the same path and get loomed or taped together. You choose what goes in. Add a sheath to it. Appears on the BOM as loom, tape and tie parts — the wires themselves are already on the BOM individually.
>
> *Examples: base-to-J1 trunk, the branch out to the gripper*

Below both: **"Buying it as one part → Cable. Tying wires together yourself → Bundle."**

**Layer 2 — persistent tooltip.** An info icon next to every cable/bundle field in every view, showing the one-line version of the above on hover. Not a one-time dialog — people forget.

**Layer 3 — contextual correction.** Detect the mistake and offer the fix:
- User creates a bundle whose segments all share one `cable_ref` → *"These 4 wires are all cores of cable C12. Did you mean to add the cable to a bundle instead of grouping its cores?"* with a one-click convert.
- User creates a cable and manually types core colours matching no library part → *"This looks like wires you're bundling yourself rather than a purchased cable. Convert to a bundle?"*
- User adds a sheath to a cable → sheath is a bundle property; explain and offer to wrap the cable in a bundle.

### 5.3 Views

| View | Purpose |
|---|---|
| **Graph canvas** | Per §5.1. The demo view. |
| **Wire table** | All segments. Gauge, colour, length, bundle, label, tags. Bulk multi-select and bulk apply are essential — most real work happens here. |
| **Net table** | Class, declared type, member count, bus, current budget, tags, diagnostic count. |
| **Bundle tree** | Nested trunk/branch, sheath, computed OD and fill %, conductor count, derating status. |
| **Bus view** | Per-bus, per-domain topology strip: node order, terminators, stub lengths, bridge nodes. |
| **Power view** | Every power net with its budget bar, source, allocated load, headroom, segment currents. |
| **Connector view** | Per-connector cavity map. |
| **Validation panel** | Always visible. Grouped by severity then rule. Click → highlight entities in the active view. Filter by tag, bundle, bus. |
| **Tag manager** | Tag namespaces, values, colours, and tag-driven rules. |

The wire table and the validation panel are where the tool earns its keep. Do not over-invest in the canvas at their expense.

---

## 6. Files, portability, packaging

### 6.1 Layout

```
project-root/
  project.json          meta, schema_version, tag_defs, display_rules, rule_config, waivers, units
  library/              submodule or vendored snapshot
    profiles/*.json
    parts/*.json
    cables/*.json
    sheaths/*.json
    connectors/*.json
    terminals/*.json
    tables/awg.json, ampacity.json, derating.json, physical_layers.json
  harness/<name>/
    nodes.json  nets.json  segments.json  cables.json
    bundles.json  buses.json  pairs.json  links.json  splices.json
    layout.json         UI coordinates ONLY
  exports/              generated, gitignored
```

Three rules that matter more than they look:

1. **`layout.json` holds only geometry.** Node positions churn constantly; keeping them out of electrical files keeps diffs readable.
2. **Canonical serialisation.** 2-space indent, sorted keys, arrays sorted by `id`, LF, trailing newline, fixed float precision. Implement `harness fmt` and a pre-commit hook. Without this every diff is noise.
3. **Split by entity type, not by subsystem.** An entity's file must not depend on a mutable property.

### 6.2 IDs, versioning

Prefixed ULIDs: `net_01JQZ8XK3MT4V7B2`. Sortable, collision-free across machines, immutable. `slug` and `name` are display-only and mutable. **All references use `id`.**

Every file carries `schema_version`. Migrations are a numbered chain applied on load and written on save. The tool refuses files newer than it knows. **Build the migration framework in M0** — retrofitting it after real projects exist is significantly worse.

### 6.3 Portable project bundle (`.pqh`)

Git is one distribution channel. The other is handing someone a single file.

`.pqh` is a zip:

```
manifest.json
project.json
harness/**
library/**          snapshot of ONLY referenced library items, full copies
attachments/**      optional: datasheets, photos, notes
```

```json
// manifest.json
{
  "format": "pqh",
  "format_version": 1,
  "tool_version": "0.4.2",
  "schema_version": 7,
  "project_id": "proj_01JQ...",
  "project_name": "PiqoBot-S400 harness",
  "exported_at": "2026-09-11T10:22:03Z",
  "exported_by": "aditya",
  "git": { "commit": "a1b2c3d", "dirty": false },
  "contents": ["harness/main", "harness/eoat"],
  "library_snapshot": { "mode": "referenced_only", "item_count": 84 },
  "checksums": { "project.json": "sha256:...", "harness/main/nets.json": "sha256:..." }
}
```

**Export** is deterministic: same project state produces a byte-identical `.pqh` (fixed zip timestamps, sorted entries). This lets two people confirm they have the same design by comparing one hash.

**Import** modes:
- `new` — create a new project from the bundle.
- `merge` — merge a harness into an existing project.
- `library_only` — pull just the library snapshot.

Library ID collisions on import: compare `version_hash`. Identical → skip. Different → import as a new version, link both to the same `slug`, raise S-007 drift on any instance. Never silently overwrite. Never require an interactive prompt — import must work headless with a declared conflict policy.

CLI: `harness export <project> -o out.pqh`, `harness import out.pqh --mode new --into <dir>`, `harness diff a.pqh b.pqh`, `harness validate <project> --format json`.

The `.pqh` format is also the regression-test fixture format. Ship real harnesses as test fixtures.

### 6.4 Architecture

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| Canvas | React Flow (`@xyflow/react`) with custom port-level node renderers |
| Tables | TanStack Table, virtualised |
| State | Zustand + Immer (patch-based undo/redo) |
| Backend | FastAPI |
| Models | Pydantic v2, JSON Schema generated from models |
| Persistence | Plain files, atomic tmp+rename |
| VCS | Abstracted — see below |
| Transport | REST for CRUD, WebSocket for live validation (debounce 100 ms) |

**The validation engine is Python only, server-side.** Do not write a second implementation in TypeScript. The client renders diagnostics; it does not compute them. The one exception is the wiring-mode pre-validation hover (§5.1 step 2), which calls a lightweight `POST /validate/hypothetical` endpoint rather than reimplementing rules client-side.

`validate(doc) -> list[Diagnostic]` is a pure function. No I/O, no mutation. Fully testable, runnable in CI over every harness in the repo.

Do not build incremental revalidation in M0. Measure first. Full revalidation of a 2000-segment harness should land in tens of milliseconds. If it does not, fix it with dirty-set propagation keyed by entity id.

**VCS is abstracted behind an interface.** `subprocess` git when git is present; an internal snapshot-based history when it is not. A packaged exe on a machine without git is a real scenario and must still give the user version history.

Single user at a time in v1. File lock while a project is open, git branches for parallel work, entity-level three-way merge tool (`harness merge-tool`) keyed on `id`.

### 6.5 Library drift

Node instances store `part_ref` **plus** `part_version_hash`. On load, if the library part's hash differs, raise S-007 with a field-level diff and an explicit "accept upgrade" action. Never auto-upgrade. Never fully copy. Same mechanism for cable parts, sheath parts, connectors and terminals.

### 6.6 Desktop packaging constraints — obey from day one

Packaging with pywebview + PyInstaller is not being built now, but every choice below is cheap now and expensive to retrofit:

- FastAPI serves the built SPA from a static directory. Single origin. No CORS config, no separate dev-server assumption in production code paths.
- Bind `127.0.0.1` on a dynamically chosen free port, written to a known location for the webview shell to read.
- **No absolute paths anywhere.** Config, cache and logs go through `platformdirs`. Project data paths are relative to the user-chosen project root.
- **No runtime network calls.** No CDN fonts, no CDN JS, no telemetry, no remote schema fetch. Everything vendored.
- Frontend build output lands in `app/static/`, and that directory is declared in PyInstaller `datas`. Keep a `--frozen` code path that resolves resources via `sys._MEIPASS`.
- No uvicorn `--reload`, no multiprocessing workers, in the packaged path. Single process, threaded.
- Avoid dependencies that need a compiler at install time or ship platform-specific binaries you cannot bundle. Check this before adding any dependency.
- `main.py` entry point: start the server on a background thread, wait for health, open the webview window. It must also run headless (`--no-window`) for CI and for the CLI.
- Everything the UI can do must be reachable from the CLI. A packaged GUI with no scriptable path is a dead end for CI and for automation.

---

## 7. Milestones and checkpoints

### M0 — Schema and headless core

**Build**
- Pydantic models for every entity in §3. JSON Schema export.
- Load / save with canonical serialisation. `harness fmt`.
- Migration framework with one no-op migration proving the chain works.
- Net graph builder: nets → segments → connectivity, rooting for current flow.
- Rules: E-001, E-002, E-003, PW-001, PW-005, PW-007, S-001, S-003, S-006.
- Waiver mechanism.
- `harness validate <path> --format json|text`.
- **Hand-encode one real SCARA harness** as JSON against this schema, including the CAN bus with transceiver domains, at least one power net with a real current budget, and at least one sheathed bundle.

**No UI. No server. Library and tests only.**

**Acceptance**
- `pytest` green, including a test per rule with a passing and a failing fixture.
- The hand-encoded harness loads, validates, and round-trips byte-identically through save.
- A deliberately broken variant (24 V on the 5 V enable, CAN_H/L swapped, over-budget power net) produces exactly the expected diagnostics and nothing else.

**Show at checkpoint CP-0**
1. The generated JSON Schema.
2. The hand-encoded real harness JSON files.
3. `harness validate` output on both the good and the broken variant, verbatim.
4. `pytest -v` output.
5. **A written list of every place the schema fought you while encoding the real harness.** This is the most important artifact. Where the model was awkward is where it is wrong, and fixing it now costs a day.

**STOP.** Schema changes after this point are expensive. Do not proceed without approval.

---

### M1 — Server and read-only UI

**Build**
- FastAPI app: project open/close, entity CRUD (read only for now), WebSocket validation channel.
- React + Vite shell served from the same origin.
- Net table, wire table, bundle tree, validation panel.
- Net display style resolution (§3.4) applied to table row colouring.
- Read-only graph canvas: nodes positioned from `layout.json`, wires drawn, junction dots rendered, net hover highlight.

**No editing.**

**Acceptance**
- Open the M0 hand-encoded harness and see it correctly in every view.
- Validation panel shows the same diagnostics the CLI produced.
- Clicking a diagnostic highlights the right entities.

**Show at CP-1**
1. Screen recording or screenshots of each view against the real harness.
2. Side-by-side: CLI validation output vs UI panel, proving they match.
3. Confirmation that the frontend has zero runtime network calls outside the local server (network tab screenshot).

**STOP.**

---

### M2 — Editing and the graph canvas

**Build**
- Full CRUD on all entities.
- Graph canvas per §5.1: draggable nodes, click-to-click wiring, live hover pre-validation with rule tooltips, refusal of hard violations, junction dots, crossing-not-connected rendering, whole-net hover highlight.
- Per-net colour and width editing; project-level display rules with resolution order shown in the inspector.
- Undo/redo via Immer patches.
- Autosave (2 s debounce) plus explicit commit through the VCS abstraction.
- Cable vs bundle disambiguation: all three layers of §5.2.

**Acceptance**
- Build a small harness from scratch entirely in the UI, save, reopen, and get byte-identical files to a hand-written equivalent.
- Attempting to wire 24 V to the 5 V enable is refused with the E-001 message before the connection is made.
- Attempting to wire a `can_logic_3v3` port to a `can_hs_5v` net is refused with E-003.
- Undo/redo across 50 mixed operations returns exactly the starting state.
- Two wires crossing show no junction dot; a real T-junction shows one.

**Show at CP-2**
1. Recording of building a harness from empty, including the refused connections and their tooltips.
2. Recording of the cable-vs-bundle picker and at least one contextual correction firing.
3. Diff proving UI-built output matches hand-written output.
4. Undo/redo test output.

**STOP.**

---

### M3 — Full rule set, tags, sheath

**Build**
- All remaining E-*, PW-*, B-*, P-*, SH-*, S-* rules.
- Ampacity and derating as **data tables** in `library/tables/`, each citing its source standard. Project selects which standard applies.
- Tag manager UI, expression parser and evaluator, user-defined rules, waiver UI with expiry.
- Sheath modelling end to end: library sheath parts, bundle OD and fill computation, SH-* rules.
- Power view with per-net budget bars.
- Bus view with per-domain topology, terminators, stub lengths, bridge nodes.

**Acceptance**
- Every rule ID in §4 has a passing and a failing fixture.
- The three example user rules in §3.10 parse, evaluate and fire correctly.
- Expression parser rejects `eval`-style injection attempts and anything outside the allowed grammar; include adversarial tests.
- Power budget on the real harness matches a hand calculation.
- Bundle fill % on the real harness matches a hand calculation.

**Show at CP-3**
1. Rule coverage table: every ID, its fixtures, pass/fail.
2. Power view and bundle tree screenshots on the real harness, with the hand calculations alongside.
3. Expression parser adversarial test output.
4. A note on which ampacity standard you implemented and what it does not cover.

**STOP.**

---

### M4 — Exports and portable bundles

**Build**
- Wire cut list (CSV, XLSX), BOM, flat netlist (CSV + KiCad `.net`), connector pinout tables, wire labels (PDF + Brady/DYMO CSV), SVG harness topology diagram, validation report (JSON + HTML).
- `.pqh` export/import per §6.3, including deterministic byte-identical export.
- CLI: `export`, `import`, `diff`, `validate`.

**Acceptance**
- Export the real harness, import into a clean directory, validate: identical diagnostics, identical file hashes.
- Export twice from identical state: byte-identical `.pqh`.
- Import with a library collision: correct version-hash resolution, S-007 raised, nothing overwritten.
- Cut list and BOM eyeballed against the real harness by the reviewer.

**Show at CP-4**
1. The generated cut list, BOM and SVG topology for the real harness.
2. Hash comparison proving deterministic export.
3. Round-trip test output.
4. Library collision test output.

**STOP.**

---

### M5 — Connectors, terminals, library versioning

**Build**
- Connector and terminal library parts, cavity modelling, connector view, mating checks (S-004, S-005), terminal selection against wire gauge (P-004).
- `part_version_hash` drift detection and the accept-upgrade flow for all library part types.

**Acceptance**
- S-004, S-005, P-004 fixtures pass.
- Editing a library part surfaces drift on existing instances with a correct field-level diff; accept-upgrade updates only the accepted instances.

**Show at CP-5**: connector view on the real harness, drift diff UI, test output. **STOP.**

---

### M6 — Abstract links / field buses

**Build**
- Abstract `Link` entity, protocol and connector validation, PoE budgeting, max-length checks, cable-assembly library, explode-to-segments operation with provenance.

**Acceptance**
- An Ethernet link with a Cat5 assembly at 1000BASE-T fails grade validation.
- A PoE link with two sources fails; with an over-budget sink fails.
- Explode produces segments and nets that validate identically to the abstract link's declared intent.

**Show at CP-6**: link validation fixtures, explode before/after. **STOP.**

---

### M7 — Desktop packaging readiness

**Build**
- Audit against every constraint in §6.6, fix violations.
- `main.py` with `--no-window` headless mode.
- A working pywebview + PyInstaller build on one platform.

**Acceptance**
- Single-file exe opens, creates a project, validates, exports `.pqh`, on a machine with no Python and no git.

**Show at CP-7**: the audit checklist with pass/fail per item, and a recording of the packaged exe doing the above. **STOP.**

---

**Rough effort:** M0 2–3 wk, M1 2 wk, M2 3–4 wk, M3 2–3 wk, M4 2 wk, M5 2–3 wk, M6 1–2 wk, M7 1 wk. Roughly 15–20 weeks of focused work.

If a usable tool is needed sooner: M0 + M3 headless, plus a CSV importer, gives a linter over existing spreadsheets in about six weeks with no editor UI at all. Propose this to the reviewer if schedule pressure appears.

---

## 8. Known failure modes

Ranked by damage.

1. **Net/segment collapse.** Shipping with only nets means rewriting the graph layer, every export, and every physical rule later. Locked in M0.
2. **Type system too strict to use.** Every real design has legitimate exceptions. Severity levels, `passive`/`unspecified` profiles, and waivers ship *with* the rules, never after.
3. **Bidirectional and open-drain semantics.** I²C, CAN_H/L, RS-485 half-duplex and one-wire all break naive output→input checking. Model `open_drain` explicitly, require a declared pull-up on OD nets, treat `bidirectional` as simultaneously driver and receiver.
4. **Ampacity tables.** IEC 60364-5-52, UL 758 and automotive practice give materially different answers. Data files, cited sources, project selects. A hand-rolled formula here produces confidently wrong numbers, which is worse than no check.
5. **Length data quality.** Every physical rule depends on manually entered guesses. `length_source` is mandatory and visible; release gating can require `measured`. Do not build 3D routing to fix this.
6. **Merge conflicts.** Canonical formatting and file splitting reduce them, not eliminate them. The entity-level merge tool is required, not optional.
7. **Library drift.** Reference-plus-pin, decided in M0, because it shapes the node instance schema.
8. **Scope creep into drawing generation.** Formboards, dimensioned layouts and 3D routing are each as large as this whole project. SVG topology diagram and stop.
9. **The expression language growing into a programming language.** Hold at side-effect-free boolean expressions over a fixed function set.
10. **Canvas polish crowding out the wire table.** The canvas demos well; the table is where work happens. Budget accordingly.

---

## 9. Open questions for the reviewer

Raise these at the checkpoint where they first block you; do not decide them unilaterally.

1. **Splices** — first-class entities with a part and location, or plain graph junctions? Recommendation: first-class from M0, minimal fields. *Decide at CP-0.*
2. **Harness variants** — deployment A has an external camera, B does not. Separate harnesses sharing a library, or per-entity variant conditions? Recommendation: defer to v2, use tags and separate harness folders. *Decide at CP-0.*
3. **Multi-harness projects** — base harness, arm harness, interconnect. Nets crossing harness boundaries need an export/import port concept. Sketch it in M0 even if not built. *Decide at CP-0.*
4. **Multiple sources on a power net** — current division on a branched multi-source net. v1 recommendation: one declared source, or explicit `paralleled: true` with worst-case fallback. A proper DC solve is v2. *Decide at CP-0.*
5. **Units** — store SI internally (mm, V, A, mm²), display per project preference. Confirm AWG vs mm² default for display. *Decide at CP-0.*
6. **Library location** — per-project copy, shared repo, or submodule. Recommendation: shared repo with submodule pinning. *Decide at CP-0.*
7. **Ampacity standard** — which one is authoritative for Piqoid harnesses. *Decide at CP-2, needed for M3.*