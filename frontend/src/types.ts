// TypeScript types mirroring the Pydantic models

export type Domain = "digital"|"analog"|"power"|"ground"|"differential"|"bus_abstract"|"passive"|"no_connect";
export type Direction = "input"|"output"|"bidirectional"|"open_drain"|"open_source"|"high_z"|"passive";
export type NetClass = "power"|"signal"|"ground"|"shield"|"no_connect";
export type LengthSource = "manual"|"measured"|"routed"|"estimated";
export type Severity = "error"|"warning"|"info";

export interface ElectricalSpec {
  nominal_v?: number;
  operating_v?: [number, number];
  abs_max_v?: [number, number];
  v_oh_min?: number;
  v_ol_max?: number;
  v_ih_min?: number;
  v_il_max?: number;
  i_supply_max_a?: number;
  i_supply_continuous_a?: number;
  i_draw_max_a?: number;
  i_draw_typ_a?: number;
}

export interface ProtocolSpec {
  name: string;
  variants?: string[];
  bitrate_max?: number;
  variant?: string;
  bitrate?: number;
  data_bitrate?: number;
}

export interface SignalProfile {
  id: string;
  type: "signal_profile";
  domain: Domain;
  direction: Direction;
  physical_layer: string;
  reference_role?: string;
  protocol?: ProtocolSpec;
  electrical: ElectricalSpec;
}

export interface Interface {
  id: string;
  name: string;
  port_refs: string[];
  bus_ref?: string;
  bus_domain?: string;
}

export interface Node {
  id: string;
  type: "node";
  name: string;
  designator?: string;
  part_ref?: string;
  interfaces: Interface[];
  tags: Record<string, string>;
}

export interface NodePort {
  id: string;
  type: "node_port";
  node_ref: string;
  interface_ref: string;
  pin_name: string;
  profile_ref: string;
  net_ref?: string;
  tags: Record<string, string>;
}

export interface NetDisplay {
  color?: string;
  width_px?: number;
  style?: string;
  label_visible?: boolean;
}

export interface Net {
  id: string;
  type: "net";
  name: string;
  net_class: NetClass;
  declared_signal?: { profile_ref: string; mode: string };
  members: string[];
  bus_ref?: string;
  bus_domain?: string;
  pair_ref?: string;
  display?: NetDisplay;
  constraints?: { max_voltage_drop_v?: number; expected_current_a?: number; max_stub_length_mm?: number };
  tags: Record<string, string>;
}

export interface Endpoint { kind: string; ref: string; }

export interface Segment {
  id: string;
  type: "segment";
  net_ref?: string;
  from: Endpoint;
  to: Endpoint;
  conductor: {
    gauge?: { awg?: number; mm2?: number };
    construction?: string;
    material?: string;
    insulation?: { material?: string; rating_v?: number; temp_rating_c?: number };
    color?: string;
    stripe?: string;
  };
  length_mm?: number;
  length_source?: LengthSource;
  cable_ref?: string;
  cable_core?: number;
  bundle_refs?: string[];
  label?: string;
  tags: Record<string, string>;
}

export interface Splice {
  id: string;
  type: "splice";
  name?: string;
  net_ref?: string;
  tags: Record<string, string>;
}

export interface BundleSheath {
  type?: string;
  nominal_id_mm?: number;
  max_fill_pct?: number;
  shield?: { shielded?: boolean; drain_net_ref?: string };
}

export interface Bundle {
  id: string;
  type: "bundle";
  name: string;
  parent_bundle_ref?: string;
  segment_refs: string[];
  cable_refs: string[];
  path_length_mm?: number;
  computed?: { conductor_count?: number; bundle_od_mm?: number; fill_pct?: number };
  sheath?: BundleSheath;
  tags: Record<string, string>;
}

export interface BusDomainData {
  id: string;
  physical_layer: string;
  topology?: string;
  nets: Record<string, string>;
  members: { node_ref: string; interface_ref: string; position?: number; terminated?: boolean }[];
  termination?: { required_count: number; ohms: number };
}

export interface Bus {
  id: string;
  type: "bus";
  name: string;
  protocol: ProtocolSpec;
  domains: BusDomainData[];
  bridges: { node_ref: string; from_domain: string; to_domain: string }[];
}

export interface Cable {
  id: string;
  type: "cable";
  designator?: string;
  length_mm?: number;
  cores: { index: number; color?: string; awg?: number; mm2?: number; segment_ref?: string }[];
}

export interface HarnessData {
  nodes: Node[];
  node_ports: NodePort[];
  nets: Net[];
  segments: Segment[];
  cables: Cable[];
  bundles: Bundle[];
  buses: Bus[];
  pairs: unknown[];
  links: unknown[];
  splices: Splice[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  schema_version: number;
  tag_defs: unknown[];
  display_rules: unknown[];
  waivers: unknown[];
}

export interface Diagnostic {
  rule_id: string;
  severity: Severity;
  message: string;
  entities: string[];
  waived: boolean;
  waiver_reason?: string;
}

export interface LayoutData {
  schema_version: number;
  nodes: Record<string, { x: number; y: number; width?: number; bgColor?: string }>;
  splices: Record<string, { x: number; y: number; width?: number; height?: number }>;
  edges: Record<string, { waypoints: { x: number; y: number }[] }>;
  portSides?: Record<string, "left" | "right" | "top" | "bottom">;
  /** Ordered list of portIds per nodeId; determines handle render order. */
  portOrder?: Record<string, string[]>;
  spliceEdgeSides?: Record<string, {
    srcSide?: "left" | "right" | "top" | "bottom";
    tgtSide?: "left" | "right" | "top" | "bottom";
  }>;
}
