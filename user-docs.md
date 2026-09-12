# Wiring Harness Design Tool — User Documentation

**Current milestone: M3 (rules engine) in progress — M0/M1/M2 complete**
**Schema version: 1**

---

## What is this?

A rule-checked wiring harness database for Piqoid's SCARA robot harnesses. Projects are plain JSON files. A validation engine enforces electrical intent: voltage compatibility, protocol matching, current budgets, and connectivity. M1 added a FastAPI server and a React/Vite UI for browsing and reviewing harness data. M2 made every view editable, added the click-to-click graph canvas editor, and undo/redo. M3 (in progress) is filling out the full validation rule set from spec §4.

---

## Quick start

### Run the UI (production)

```bash
# From the project root (contains project.json)
python -m uvicorn "app.server._factory:make" --factory --host 127.0.0.1 --port 8765
# Open http://127.0.0.1:8765 in a browser
```

The built React app is served directly from `app/static/`. No separate web server needed.

### Run the UI (development — hot reload)

```bash
# Terminal 1: backend
python -m uvicorn "app.server._factory:make" --factory --host 127.0.0.1 --port 8765 --reload

# Terminal 2: frontend dev server (proxies /api and /ws to backend)
cd frontend
npm run dev
# Open http://localhost:5173
```

### CLI commands

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

### Rebuild the frontend

```bash
cd frontend
npm run build   # outputs to app/static/
```

---

## UI reference (M1)

The app loads at the project root URL. The header shows the project name and a harness selector when multiple harnesses are present. Badge counts for active errors and warnings are shown in the header.

### Sidebar views

| View | Description |
|---|---|
| **Graph** | Network diagram: device nodes, splice junction dots, segment edges coloured by net. Hover any edge to highlight that net across all edges. Pan and zoom freely. Positions come from `harness/<name>/layout.json`. |
| **Nets** | Table of all nets. Columns: name (with colour dot), class, port count, bus ref, signal profile, tags. Click a row to highlight that net in all other views. |
| **Wires** | Table of all segments. Columns: label, net (with colour dot), gauge, wire colour swatch, length + source, bundle assignment, tags. Diagnostic count shown per row. |
| **Bundles** | Tree of bundles (supports parent → child nesting). Each row shows fill %, outer diameter, conductor count, sheath type, and shield status. Expand/collapse sub-bundles. Segment chips list the wires inside. |

### Validation panel

A collapsible panel at the bottom of every view. Diagnostics are grouped by severity (errors first, then warnings, then info). Click any diagnostic row to highlight the referenced entities in the active view. A second click clears the highlight. Toggle "show waived" to see suppressed diagnostics.

### Highlighting

Clicking a net, wire, bundle, or diagnostic row dims all unrelated items (opacity 0.35). Click the same row again or press "× clear" in the validation panel header to restore full visibility. Highlighting is cross-view: if you highlight a net in the Nets table and switch to Wires, the dimming follows.

### Multiple harnesses

If the project contains more than one harness folder under `harness/`, a dropdown appears in the header. Switching harnesses reloads all data and opens a new WebSocket validation stream. The broken test harness (`scara_broken`) can be selected to see live error reporting.

---

---

## Editing (M2)

Every view is now editable. Changes autosave (2 s debounce after the last edit) and are also written immediately through the REST API for entity CRUD; layout (node/splice positions, wire waypoints) is a separate autosaved `layout.json` write.

### Graph canvas — click-to-click wiring

1. Click a port to enter wiring mode. It highlights amber, and a ghost wire follows the cursor.
2. Hovering another port runs live pre-validation against `POST /validate/hypothetical` (§ REST API) and colors the target port green (clean), amber (warnings), or red (hard violation), with a tooltip naming the rule.
3. Click the target port to connect. Clicking a port that would produce an `abs_max_v` (E-001) or protocol/physical-layer (E-003) violation refuses the connection with a toast. Softer violations (E-002, E-006, PW-002, ...) connect and just show up in the validation panel.
4. `Esc` or clicking the target's own source port cancels.

**Corners.** While wiring, clicking empty canvas adds a 90°-bend waypoint instead of connecting. The first bend can jog freely (both axes at once); every bend after that is **axis-constrained** — the pending segment from the last placed corner to the cursor only moves along whichever axis you're currently dragging further on (KiCad-style), and a click always places the new corner exactly where that constrained rubber-band currently ends, never at the raw click coordinate. This was a real bug: the invisible node used to anchor the ghost wire's cursor end tracked the mouse and could intercept the click meant for the pane underneath, so a second corner sometimes silently failed to register. Fixed by making that anchor `pointer-events: none` and by having corner placement read the already-known ghost-wire endpoint (`getWireEnd` in `frontend/src/store/project.ts`) instead of re-deriving a position from the click event.

Other canvas mechanics: orthogonal routing by default; hovering a wire highlights its whole net and dims everything else; junction dots (filled circles) render only at real electrical junctions (splices, or 3+ segment meets), never where two segments simply meet end-to-end at a port; crossing wires with no shared junction render as a plain overlap, not a connection.

### Cable vs bundle disambiguation

Creating a grouping presents two cards (Cable = a part you buy with fixed cores; Bundle = wires you route together yourself) rather than a bare dropdown, per spec §5.2. An info icon repeats the one-liner wherever a cable/bundle field appears.

### Undo / redo

`Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`). Snapshot-based (harness + layout state), not patch-based — simpler to reason about at this project's data size, capped at 50 steps each direction.

### Per-net display style

Right-click a net (or use the net inspector) to override color/width/style. Resolution order — per-net `display` > last matching project `display_rules` entry > `net_class` default — is shown with its source in the inspector so it's clear why a color applied.

---

## REST API (M1)

All endpoints are under `/api`. The UI uses these; you can call them from scripts too.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/project` | Project meta + list of harness names |
| GET | `/api/harness/{name}` | All entity collections for the named harness |
| GET | `/api/layout/{name}` | UI node positions (or empty if no layout.json) |
| GET | `/api/profiles` | All signal profiles from `library/profiles/` |
| GET | `/api/validate/{name}` | Run validation and return diagnostics |
| POST | `/api/harness/{name}/entities/{entity_type}` | Create an entity (M2) |
| PUT | `/api/harness/{name}/entities/{entity_type}/{id}` | Update an entity (M2) |
| DELETE | `/api/harness/{name}/entities/{entity_type}/{id}` | Delete an entity (M2) |
| PUT | `/api/layout/{name}` | Save node/splice positions + wire waypoints (M2) |
| POST | `/api/validate/hypothetical` | Live pre-validation for one proposed connection while wiring (M2, §5.1 step 2) |
| WS | `/ws/validate/{name}` | Live validation stream; sends diagnostics on connect, accepts `"refresh"` message, pings every 30 s |

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

## Validation rules

M0 shipped 8 rules (E-001/002/003, PW-001/005/007, S-001/003/006). M3 (in progress) adds the rest of spec §4 — 35 more rule IDs across electrical, power, bus/differential-pair, physical/thermal, sheath, and structural. Every rule below has a passing and a failing pytest fixture (`tests/test_rules.py` for the M0 set, `tests/test_rules_m3.py` for the rest).

### Electrical

| ID | Sev | Check |
|---|---|---|
| E-001 | error | Net's worst-case driver voltage envelope outside a member port's `abs_max_v`. |
| E-002 | error | Per driver/receiver pair: V_OH < V_IH or V_OL > V_IL. |
| E-003 | error | Mixed `physical_layer` or `protocol` on ports sharing a net. Catches CAN logic ports on CAN wire nets. |
| E-004 | error | A `pair_role: P`/`N` port doesn't sit on the net its differential pair registered for that role — catches swapped CAN_H/CAN_L. |
| E-005 | error | ≥2 push-pull (`output`) drivers on one net. Open-drain/open-source multiples are allowed — no pull-up declaration exists in the schema to check against, so they're treated as the intentional escape hatch. |
| E-006 | warn | Net has only receivers, isn't power/ground, and has no `declared_signal`. |
| E-007 | warn | Port has no `net_ref` and isn't `domain: no_connect`. |
| E-008 | warn | Ports on one signal net declare different `reference_role` (different grounds). |
| E-009 | error | Analog driver's `operating_v` range exceeds a receiver's range. (Current-loop sense-resistor check not implemented — no schema field for it.) |
| E-010 | warn | A profile with `signal_integrity.max_edge_rate_ns` sits on a segment tagged `placement: external` with no shielded bundle. |

### Power / current budget

| ID | Sev | Check |
|---|---|---|
| PW-001 | error | Σ sink `i_draw_max_a` exceeds Σ source `i_supply_max_a` on a power net. |
| PW-002 | warn | Σ `i_draw_max_a` exceeds `power_headroom_threshold_pct` (default 80%) of Σ `i_supply_continuous_a`. |
| PW-003 | warn | Σ `i_draw_typ_a` exceeds Σ `i_supply_continuous_a`. |
| PW-004 | warn | Σ `i_inrush_a` exceeds Σ `i_supply_max_a` × `rule_config.inrush_factor`. |
| PW-005 | error | Power net with no port declaring `i_supply_max_a`. |
| PW-006 | warn | >1 source on a power net without `net.paralleled: true`. Falls back to worst-case (full load on every segment) for P-001/P-002 rather than modelling current division — a proper DC solve is v2 per spec §9. |
| PW-007 | info | Current budget report for every power net (always emitted, even when passing). |

### Bus / differential pair

| ID | Sev | Check |
|---|---|---|
| B-001 | error | A pair's declared `nets.P`/`nets.N` id doesn't resolve to a real net. |
| B-002 | error | `require_same_cable` set but the cables carrying P's segments differ from the cables carrying N's segments. |
| B-003 | warn | `require_same_bundle`/skew: total P length vs total N length differs by more than `max_skew_mm`. Approximates the spec's per-hop path comparison with a whole-net length sum. |
| B-004 | error | Terminator count in a bus domain ≠ `termination.required_count`. |
| B-005 | warn | A `linear`-topology domain's terminators aren't exactly at the min/max `position` (the topological extremes). |
| B-006 | — | **Not implemented.** Needs a hub→leaf segment-path walk that `BusMember` alone doesn't carry, and no fixture in this project uses `topology: star` to design it against — left as an honest gap rather than a rule that would either never fire or approximate its way to a wrong answer. |
| B-007 | error | A bus member's interface ports aren't on that domain's declared nets. |
| B-008 | warn | Domain node count exceeds `domain.max_nodes` (new optional field — see Schema additions below). |
| B-009 | error | Bus `protocol.bitrate` exceeds the lowest `protocol.bitrate_max` declared among member ports. |
| B-010 | error | Multi-domain bus whose `bridges` don't connect every domain into one group. |
| B-011 | error | A declared bridge's node isn't a member of both domains it claims to bridge. |

### Physical / thermal

| ID | Sev | Check |
|---|---|---|
| P-001 | error | Segment's expected current exceeds derated ampacity for its gauge/insulation-temp/ambient/bundle-conductor-count. See **Ampacity & derating** below. |
| P-002 | warn | Round-trip voltage drop (`2·R·I` summed along the source→sink path) exceeds `net.constraints.max_voltage_drop_v`. Only computed for nets with exactly one identifiable source. |
| P-003 | error | Segment insulation `rating_v` < net's driver `nominal_v` × `rule_config.insulation_voltage_margin` (default 1.5). |
| P-004 | — | **Not implemented.** Needs a terminal library part registry (`library/terminals/*.json`) that doesn't exist yet — explicitly M5 scope. |
| P-005 | error | Two segments claim the same `(cable_ref, cable_core)`. |
| P-006 | warn | `construction: solid` segment inside a bundle whose sheath is `mechanical.flexible` or `drag_chain_rated`. |
| P-007 | error | Segment length missing/not `measured` when `rule_config.release_require_measured_lengths` is set (default off). |

### Sheath

| ID | Sev | Check |
|---|---|---|
| SH-001 | error | `computed.fill_pct` > `sheath.max_fill_pct`. |
| SH-002 | error | `sheath.shield.shielded` true with no `drain_net_ref`. |
| SH-003 | error | `sheath.temp_range_c` doesn't contain `bundle.computed.max_ambient_c`. |
| SH-004 | warn | Bundle tagged `zone: wrist` or `zone: eoat` (this project's stand-in for "flexing zone" — see note below) without `drag_chain_rated` sheath. |
| SH-005 | warn | Child bundle's `sheath.outer_od_mm` exceeds parent's `sheath.nominal_id_mm`. |
| SH-006 | warn | Shielded bundle's `drain_net_ref` differs from a contained cable's own shield drain net. |
| SH-007 | info | `sheath.cut_length_mm` (new optional field) differs from `bundle.path_length_mm`. Only reported when `cut_length_mm` is actually set. |

### Structural

| ID | Sev | Check |
|---|---|---|
| S-001 | error | Net's segments do not span all member ports (disconnected net graph). |
| S-002 | warn | Net's segment graph has a cycle (union-find over segments) and `net.ring` isn't true. |
| S-003 | error | Segment with no valid `net_ref`. |
| S-004 | error | Two node ports declare the same `(connector_ref, cavity)`. |
| S-005 | — | **Not implemented.** Needs connector library parts (gender/coding) — M5 scope. |
| S-006 | error | Any reference (`net_ref`, `cable_ref`, `bus_ref`, `segment_refs`, `pair.nets`, `splice.net_ref`, ...) points to a non-existent entity ID. M3 widened this from the M0 version to also check bundles, pairs, and splices. |
| S-007 | — | **Not implemented.** Library drift needs a `library/parts/*.json` registry that doesn't exist yet — M5 scope. `part_version_hash` fields already exist on Node/Cable for when it does. |

### Ampacity & derating standard: automotive practice, not IEC 60364-5-52

`project.json` → `rule_config.ampacity_standard` is `"AUTOMOTIVE_PRACTICE"`. This was a real decision point — spec §9 open question 7 explicitly left it for the reviewer to confirm and it never was. Building strict IEC 60364-5-52 support first exposed why: IEC's published tables only start at 1.5 mm² (14 AWG) — nearly this whole harness is 24–20 AWG — and its grouping/conduit-derating factors are calibrated for continuously-loaded mains raceways in walls, not a flexible cable loom in open cabinet air. Applying them here flagged a completely normal 16 AWG/12 A cabinet trunk as an ampacity violation — a textbook case of the "confidently wrong" failure mode spec §8 warns about.

`library/tables/ampacity.json` and `library/tables/derating.json` instead encode a free-air single-conductor ampacity table (by AWG × insulation temperature rating) plus ambient-temperature and conductor-bunching correction factors, sourced from Remington Industries' published "Copper Hook-Up Wire Ampacity by Insulation Temperature Rating" reference — the same style of table used across automotive/electronics wire selection (GXL/SXL/TXL/UL1007/UL1015). Both files cite the source and list what they don't cover (gauges outside 40–0000 AWG, insulation ratings other than the six listed columns, conduit/embedded installations). **This is not a code-compliance certification** — treat P-001 as a thermal sanity check, and revisit if/when Piqoid formally adopts IEC 60364-5-52 or UL 758 for a release-gated harness (the `ampacity_standard` field and per-standard table files are there specifically so that switch doesn't need a schema change).

### Schema additions made while building the M3 rule set

All additive/optional — old project files still load unchanged:
- `Net.paralleled: bool = False` — PW-006 / current-computation escape hatch for an intentionally parallel-sourced power net.
- `BusDomain.max_nodes: Optional[int]` — transceiver-rated fan-out, for B-008.
- `BundleSheath.cut_length_mm: Optional[float]` — actual as-cut sheath length, for SH-007.
- `RuleConfig.ambient_c` (default 30.0), `RuleConfig.insulation_voltage_margin` (default 1.5) — P-001/P-002/P-003 defaults when a bundle/net doesn't declare its own.

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
7. **Ampacity standard** — **Decided during M3 rules work: "automotive practice"**, not IEC 60364-5-52 (see the Ampacity & derating section above for why). `library/tables/ampacity.json` + `derating.json` implement it as cited data tables, `rule_config.ampacity_standard` records the choice per project. Piqoid should still sanity-check this against real-world experience with the harness gauges in use.

---

## Schema fighting notes (CP-0 artifact)

These are places where the model was awkward while encoding the real SCARA harness:

1. **`from` is a Python keyword** — Pydantic field alias required (`from_` in Python, `from` in JSON). Works, but requires `by_alias=True` everywhere in serialization and `populate_by_name=True` in SegmentTermination.

2. **Direction enum on power ports** — The spec uses `direction: output` for power sources and `direction: input` for sinks, but E-001 must not treat a power sink's `operating_v` as a "driver" range. Fixed by filtering on direction in E-001 (only `output`, `bidirectional`, `open_drain`, `open_source`, and power-domain ports contribute to the net voltage envelope). This was a real encoding trap.

3. **Cable round-trip** — S-006 originally didn't include cables in its known-IDs set, causing false "dangling reference" errors on `cable_ref` in segments. Fixed by passing `cables` explicitly.

4. **Null serialization vs defaults** — Pydantic's `model_dump_json()` includes default-valued fields (e.g. `constraints: {}`, `display: {}`) even when hand-written JSON omits them. Round-trip test redefined to compare save-then-load idempotency rather than hand-written-source equality. This is correct: the canonical form includes all defaults.

5. **E-003 and the transceiver** — The spec says "a `can_logic_3v3` port cannot land on a `can_hs_5v` net." This is enforced by the domain model: each bus domain has its own nets, and the transceiver has separate interfaces for each domain. E-003 fires if someone puts a logic-side port ref into the wire-side net's members list (tested in broken harness).

6. **net_enable E-002 vs E-001** — The MCU's `prof_dig_out_3v3` (3.3V output) driving servo drives' `prof_enable_5v_in` (5V tolerant input): E-001 does NOT fire (3.3V < 6.0V abs_max), E-002 does NOT fire (V_OH=2.9V > V_IH=2.5V, V_OL=0.4V < V_IL=0.8V). Verified in test. This is a valid interface.

7. **A real data bug the M3 rule set caught in `scara_main`.** Building B-002 (require_same_cable) and P-005 (duplicate cable core) surfaced that the CAN0_H/L trunk was modelled as one `Cable` entity (`cbl_can0_trunk`) spanning two separate physical hops (xcvr→J1, J1→J2), with both hops' CANH segments claiming `cable_core: 1` on that same cable — the model's `cores[].segment_ref` is deliberately singular (one core = one segment; a cable entity is one continuous cut), so two segments both claiming core 1 is exactly the mistake P-005 exists to catch. Fixed by splitting it into `cbl_can0_trunk_a`/`_b`, one per physical cut, each with its own 2 cores. While there, also found and fixed a stray unlabeled segment (`segment_5ab6cd5207dbb52f`, clearly created via the M2 UI wiring tool and never finished) that `bnd_base_to_j1.segment_refs` already referenced by a different name (`seg_can0_l_xcvr_to_j1`) — S-006 wasn't checking bundle `segment_refs`/`cable_refs` at all at the time, so this dangling reference was silently invisible; S-006 was widened in M3 to cover bundles, pairs, and splices too, and the segment was renamed/completed to match its sibling data. `harness validate` on `scara_main` is clean (0 errors) after both fixes.

8. **`python -m app.cli ...` was silently a no-op.** `app/cli.py` defined the Click group and commands but never called `cli()` — no `if __name__ == "__main__":` guard. Running any command via `-m` printed nothing and exited 0, whether the command would have succeeded or not. The `harness` console-script entry point (used in the Quick start commands above) was unaffected since setuptools/hatchling generates a wrapper that calls `cli()` directly, so this was easy to miss. One-line fix.
