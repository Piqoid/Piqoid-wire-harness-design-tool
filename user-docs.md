# Wiring Harness Design Tool — User Documentation

**Current milestone: M0 — Schema and headless core**
**Schema version: 1**

---

## What is this?

A rule-checked wiring harness database for Piqoid's SCARA robot harnesses. Projects are plain JSON files. A validation engine enforces electrical intent: voltage compatibility, protocol matching, current budgets, and connectivity. This document covers the M0 headless core (no UI, no server).

---

## Quick start

```bash
# Validate a project (prints text summary to stdout)
python -m app.cli validate <project-directory>

# Validate a specific harness within the project
python -m app.cli validate <project-directory> --harness scara_main

# Validate and get JSON output (for CI/scripting)
python -m app.cli validate <project-directory> --format json

# Re-format all project files to canonical form
python -m app.cli fmt <project-directory>

# Export JSON Schema for all entity types
python -m app.cli schema -o schema.json
```

**Exit codes:** 0 = no unwaived errors. 1 = errors present (or project load failure).

---

## Project structure

```
project-root/
  project.json          meta, schema_version, tag_defs, display_rules, rule_config, waivers
  library/
    profiles/*.json     signal profiles (electrical contracts for pins)
    tables/
      awg.json          AWG ↔ mm² lookup (IEC nominal values, not formula)
  harness/<name>/
    nodes.json          physical devices and their interfaces
    node_ports.json     individual pins, each referencing a signal profile
    nets.json           logical equipotentials (hyperedges over ports)
    segments.json       physical wire conductors between two endpoints
    cables.json         purchased multiconductor cables
    bundles.json        design groupings of wires + sheath specifications
    buses.json          protocol buses with domain model (e.g. CAN logic + wire)
    pairs.json          differential pairs with impedance and skew constraints
    splices.json        physical wire junctions
    links.json          abstract field-bus assemblies (e.g. Ethernet patch cable)
    layout.json         UI node positions only (not electrical data)
  exports/              generated output, gitignored
```

---

## Entity model reference

### SignalProfile

The electrical contract for a pin. Stored in `library/profiles/`.

| Field | Meaning |
|---|---|
| `domain` | `digital`, `analog`, `power`, `ground`, `differential`, `bus_abstract`, `passive`, `no_connect` |
| `direction` | `input`, `output`, `bidirectional`, `open_drain`, `open_source`, `high_z`, `passive` |
| `physical_layer` | The transceiver/electrical layer (e.g. `can_logic_3v3`, `can_hs_5v`, `logic_3v3`, `power_dc`) |
| `operating_v` | `[min, max]` — what the pin drives (output) or accepts (input) |
| `abs_max_v` | `[min, max]` — survivable envelope; exceeding it is rule E-001 |
| `v_oh_min` / `v_ol_max` | Driver high/low output capability |
| `v_ih_min` / `v_il_max` | Receiver input thresholds |
| `i_supply_max_a` | Source declares this; leave null for sinks |
| `i_draw_max_a` | Sink declares this; leave null for sources |
| `protocol` | `{name, variants, bitrate_max}` — used by E-003 |

### Net

A logical equipotential. Members are `node_port` IDs.

```json
{
  "id": "net_24v_main",
  "name": "24V_MAIN",
  "net_class": "power",
  "members": ["np_psu_24v_out", "np_mcu_pwr_in", "np_j1_pwr_in"],
  "declared_signal": {"profile_ref": "prof_pwr_24v_source", "mode": "strict"}
}
```

`net_class`: `power` | `signal` | `ground` | `shield` | `no_connect`

**Typing modes:** `strict` (declared upfront, every joining port must satisfy it) or `inferred` (envelope computed from connected drivers). New nets default to `inferred`.

### Segment

One physical conductor between exactly two endpoints.

```json
{
  "id": "seg_pwr_j1",
  "net_ref": "net_24v_main",
  "from": {"kind": "port", "ref": "np_psu_24v_out"},
  "to": {"kind": "port", "ref": "np_j1_pwr_in"},
  "conductor": {
    "gauge": {"awg": 18, "mm2": 0.75},
    "material": "Cu",
    "insulation": {"material": "PVC", "rating_v": 300, "temp_rating_c": 105},
    "color": "RD"
  },
  "length_mm": 850,
  "length_source": "measured"
}
```

`length_source`: `manual` | `measured` | `routed` | `estimated` — mandatory field.

Endpoint `kind`: `port` | `splice` | `ring_lug` | `free_end` | `shield_drain` | `connector_cavity`

**AWG↔mm² values** come from `library/tables/awg.json` (IEC nominal cross-sections, not geometric formula).

### Bus — multi-domain model

CAN buses have a `logic` domain (MCU↔transceiver) and a `wire` domain (bus cable). The transceiver appears in both and is declared as the bridge.

```json
{
  "id": "bus_can0",
  "protocol": {"name": "CAN", "variant": "CAN_FD", "bitrate": 1000000},
  "domains": [
    {"id": "logic", "physical_layer": "can_logic_3v3", "nets": {"TX": "net_can0_tx", "RX": "net_can0_rx"}},
    {"id": "wire", "physical_layer": "can_hs_5v", "topology": "linear",
     "termination": {"required_count": 2, "ohms": 120}}
  ],
  "bridges": [{"node_ref": "node_xcvr", "from_domain": "logic", "to_domain": "wire"}]
}
```

### Bundle + Sheath

A design grouping of segments and cables that travel the same path. Add a sheath for OD, fill %, and shielding.

```json
{
  "id": "bnd_base_to_j1",
  "name": "Base → J1 Trunk",
  "segment_refs": ["seg_pwr_j1", "seg_can0_h_xcvr_j1"],
  "sheath": {
    "type": "braided_sleeve",
    "nominal_id_mm": 16.0,
    "max_fill_pct": 75,
    "shield": {"shielded": true, "drain_net_ref": "net_gnd_chassis"}
  }
}
```

**Cable vs Bundle:** A Cable is a part you buy (fixed cores, jacket, part number). A Bundle is wires you route together (you choose what goes in, add loom/tape/sheath). Do not confuse them — they appear separately on the BOM.

---

## Validation rules (M0 set)

| ID | Sev | Check |
|---|---|---|
| E-001 | error | Net's worst-case driver voltage envelope outside a member port's `abs_max_v`. |
| E-002 | error | Per driver/receiver pair: V_OH < V_IH or V_OL > V_IL. |
| E-003 | error | Mixed `physical_layer` or `protocol` on ports sharing a net. Catches CAN logic ports on CAN wire nets. |
| PW-001 | error | Σ sink `i_draw_max_a` exceeds Σ source `i_supply_max_a` on a power net. |
| PW-005 | error | Power net with no port declaring `i_supply_max_a`. |
| PW-007 | info | Current budget report for every power net (always emitted, even when passing). |
| S-001 | error | Net's segments do not span all member ports (disconnected net graph). |
| S-003 | error | Segment with no valid `net_ref`. |
| S-006 | error | Reference (`net_ref`, `cable_ref`, `bus_ref`, etc.) points to a non-existent entity ID. |

### Waivers

Add to `project.json` to suppress a specific rule on a specific entity. Waivers expire.

```json
"waivers": [
  {
    "rule_id": "E-002",
    "target": {"kind": "net", "ref": "net_can0_tx"},
    "reason": "3.3V drives 5V input through external level-shifter not modelled in v1",
    "author": "aditya",
    "created": "2026-09-11",
    "expires": "2026-12-31"
  }
]
```

---

## Canonical file format

All files are written with:
- 2-space indent
- Keys sorted alphabetically
- Arrays of objects-with-id sorted by `id`
- LF line endings
- Trailing newline

Run `harness fmt <project>` to normalise files. Useful as a pre-commit hook. The format is deterministic: same logical data → byte-identical output.

---

## IDs

All entity IDs use a prefixed format: `net_XXXXXXXXXXXXXXXX`, `seg_XXXXXXXXXXXXXXXX`, etc. IDs are immutable — `name` and `slug` fields are display-only and mutable. **All references use `id`.**

---

## Migration framework

Every file carries `schema_version: 1`. On load, migrations are applied as a numbered chain until the current version is reached. The tool refuses to open files newer than its known schema version. Migration chain is tested in `tests/test_migration.py`.

---

## Open questions for reviewer (from spec §9)

Decisions needed at CP-0:

1. **Splices** — first-class entities (implemented in M0 as recommended).
2. **Harness variants** — deferred to v2; use tags and separate harness folders.
3. **Multi-harness projects** — separate harness folders under `harness/`; cross-harness nets not implemented yet.
4. **Multiple sources on power net** — one declared source, or explicit `paralleled: true` flag with worst-case fallback. DC solve deferred to v2.
5. **Units** — SI internally (mm, V, A, mm²). AWG display default (configurable per project).
6. **Library location** — per-project `library/` directory. Shared repo with submodule recommended for M1+.
7. **Ampacity standard** — IEC 60364-5-52 implemented as data table. Piqoid to confirm which standard applies to their harnesses (needed for M3 full rules).

---

## Schema fighting notes (CP-0 artifact)

These are places where the model was awkward while encoding the real SCARA harness:

1. **`from` is a Python keyword** — Pydantic field alias required (`from_` in Python, `from` in JSON). Works, but requires `by_alias=True` everywhere in serialization and `populate_by_name=True` in SegmentTermination.

2. **Direction enum on power ports** — The spec uses `direction: output` for power sources and `direction: input` for sinks, but E-001 must not treat a power sink's `operating_v` as a "driver" range. Fixed by filtering on direction in E-001 (only `output`, `bidirectional`, `open_drain`, `open_source`, and power-domain ports contribute to the net voltage envelope). This was a real encoding trap.

3. **Cable round-trip** — S-006 originally didn't include cables in its known-IDs set, causing false "dangling reference" errors on `cable_ref` in segments. Fixed by passing `cables` explicitly.

4. **Null serialization vs defaults** — Pydantic's `model_dump_json()` includes default-valued fields (e.g. `constraints: {}`, `display: {}`) even when hand-written JSON omits them. Round-trip test redefined to compare save-then-load idempotency rather than hand-written-source equality. This is correct: the canonical form includes all defaults.

5. **E-003 and the transceiver** — The spec says "a `can_logic_3v3` port cannot land on a `can_hs_5v` net." This is enforced by the domain model: each bus domain has its own nets, and the transceiver has separate interfaces for each domain. E-003 fires if someone puts a logic-side port ref into the wire-side net's members list (tested in broken harness).

6. **net_enable E-002 vs E-001** — The MCU's `prof_dig_out_3v3` (3.3V output) driving servo drives' `prof_enable_5v_in` (5V tolerant input): E-001 does NOT fire (3.3V < 6.0V abs_max), E-002 does NOT fire (V_OH=2.9V > V_IH=2.5V, V_OL=0.4V < V_IL=0.8V). Verified in test. This is a valid interface.
