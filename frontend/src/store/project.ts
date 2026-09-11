import { create } from "zustand";
import type {
  Diagnostic, HarnessData, LayoutData, Net, NodePort,
  ProjectMeta, Segment, SignalProfile,
} from "../types";
import {
  connectValidationWS,
  createEntity, deleteEntity, updateEntity,
  fetchHarness, fetchLayout, fetchProfiles, fetchProject, fetchValidation,
  saveLayout, validateHypothetical,
} from "../api/client";

// ── wiring mode ───────────────────────────────────────────────────────────────

export interface WiringState {
  active: boolean;
  sourcePortId: string | null;
  sourceNodeId: string | null;
  waypoints: { x: number; y: number }[];
  cursorPos: { x: number; y: number } | null;
  /** null = not hovering a port; otherwise the pre-validation result */
  hover: { portId: string; severity: "ok" | "warn" | "error"; message: string } | null;
}

// ── undo/redo (snapshot-based) ────────────────────────────────────────────────

interface Snapshot {
  harness: HarnessData;
  layout: LayoutData;
}

// ── store shape ───────────────────────────────────────────────────────────────

interface ProjectStore {
  // Server data
  meta: ProjectMeta | null;
  harnessNames: string[];
  currentHarness: string | null;
  harness: HarnessData | null;
  layout: LayoutData | null;
  profiles: Record<string, SignalProfile>;
  diagnostics: Diagnostic[];

  // UI state
  activeView: "graph" | "nets" | "wires" | "bundles";
  highlightedEntities: Set<string>;
  hoveredNet: string | null;
  gridSnap: boolean;

  // Selected entity for inspector
  selectedEntity: { type: string; id: string } | null;

  // Wiring mode
  wiring: WiringState;

  // Undo/redo
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  // WS
  ws: WebSocket | null;

  // Autosave timer
  _autosaveTimer: ReturnType<typeof setTimeout> | null;

  // Actions — navigation
  loadProject: () => Promise<void>;
  switchHarness: (name: string) => Promise<void>;
  setActiveView: (v: ProjectStore["activeView"]) => void;
  setSelectedEntity: (type: string, id: string) => void;
  clearSelectedEntity: () => void;

  // Actions — highlighting
  highlightEntities: (ids: string[]) => void;
  clearHighlight: () => void;
  setHoveredNet: (id: string | null) => void;
  toggleGridSnap: () => void;

  // Actions — wiring mode
  startWiring: (sourcePortId: string, sourceNodeId: string) => void;
  cancelWiring: () => void;
  addWaypoint: (x: number, y: number) => void;
  updateCursorPos: (x: number, y: number) => void;
  setWiringHover: (portId: string, fromPortId: string) => Promise<void>;
  clearWiringHover: () => void;
  completeWiring: (targetPortId: string, targetNodeId: string) => Promise<void>;

  // Actions — undo/redo
  undo: () => void;
  redo: () => void;
  _pushSnapshot: () => void;
  _scheduleAutosave: () => void;

  // Actions — mutations
  createSegment: (seg: Partial<Segment>) => Promise<Segment | null>;
  deleteSegment: (id: string) => Promise<void>;
  createSplice: (splice: Record<string, unknown>) => Promise<void>;
  deleteSplice: (id: string) => Promise<void>;
  moveNode: (nodeId: string, x: number, y: number) => void;
  moveSplice: (spliceId: string, x: number, y: number) => void;
  updateEdgeWaypoints: (segId: string, waypoints: { x: number; y: number }[]) => void;
  updateNet: (id: string, partial: Record<string, unknown>) => Promise<void>;
  deleteNet: (id: string) => Promise<void>;
  genericCreate: (entityType: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  genericUpdate: (entityType: string, id: string, body: Record<string, unknown>) => Promise<void>;
  genericDelete: (entityType: string, id: string) => Promise<void>;
  reloadHarness: () => Promise<void>;
}

// ── helpers ───────────────────────────────────────────────────────────────────

export function resolveNetColor(net: Net): string {
  const explicit = net.display?.color;
  if (explicit) return explicit;
  switch (net.net_class) {
    case "power":  return "#dc2626";
    case "ground": return "#64748b";
    case "shield": return "#78716c";
    default:       return "#60a5fa";
  }
}

const EMPTY_WIRING: WiringState = {
  active: false,
  sourcePortId: null,
  sourceNodeId: null,
  waypoints: [],
  cursorPos: null,
  hover: null,
};

const EMPTY_LAYOUT: LayoutData = { schema_version: 1, nodes: {}, splices: {}, edges: {} };

// ── store ─────────────────────────────────────────────────────────────────────

export const useProjectStore = create<ProjectStore>((set, get) => ({
  meta: null,
  harnessNames: [],
  currentHarness: null,
  harness: null,
  layout: null,
  profiles: {},
  diagnostics: [],
  activeView: "graph",
  highlightedEntities: new Set(),
  hoveredNet: null,
  gridSnap: true,
  selectedEntity: null,
  wiring: EMPTY_WIRING,
  undoStack: [],
  redoStack: [],
  ws: null,
  _autosaveTimer: null,

  // ── navigation ─────────────────────────────────────────────────────────────

  loadProject: async () => {
    const [proj, profs] = await Promise.all([fetchProject(), fetchProfiles()]);
    const profileMap: Record<string, SignalProfile> = {};
    profs.forEach((p) => (profileMap[p.id] = p));
    set({ meta: proj.meta, harnessNames: proj.harness_names, profiles: profileMap });
    const preferred = proj.harness_names.find((n) => !n.includes("broken")) ?? proj.harness_names[0];
    if (preferred) await get().switchHarness(preferred);
  },

  switchHarness: async (name: string) => {
    const [harness, layout, diags] = await Promise.all([
      fetchHarness(name),
      fetchLayout(name),
      fetchValidation(name),
    ]);
    get().ws?.close();
    const ws = connectValidationWS(name, (d) => set({ diagnostics: d }));
    set({
      currentHarness: name, harness, layout, diagnostics: diags, ws,
      undoStack: [], redoStack: [], wiring: EMPTY_WIRING, selectedEntity: null,
    });
  },

  setActiveView: (v) => set({ activeView: v }),
  setSelectedEntity: (type, id) => set({ selectedEntity: { type, id } }),
  clearSelectedEntity: () => set({ selectedEntity: null }),

  // ── highlighting ────────────────────────────────────────────────────────────

  highlightEntities: (ids) => set({ highlightedEntities: new Set(ids) }),
  clearHighlight: () => set({ highlightedEntities: new Set() }),
  setHoveredNet: (id) => set({ hoveredNet: id }),
  toggleGridSnap: () => set((s) => ({ gridSnap: !s.gridSnap })),

  // ── wiring mode ─────────────────────────────────────────────────────────────

  startWiring: (sourcePortId, sourceNodeId) => {
    set({ wiring: { ...EMPTY_WIRING, active: true, sourcePortId, sourceNodeId } });
  },

  cancelWiring: () => set({ wiring: EMPTY_WIRING }),

  addWaypoint: (x, y) => set((s) => ({
    wiring: { ...s.wiring, waypoints: [...s.wiring.waypoints, { x, y }] },
  })),

  updateCursorPos: (x, y) => set((s) => ({
    wiring: { ...s.wiring, cursorPos: { x, y } },
  })),

  setWiringHover: async (targetPortId, fromPortId) => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    try {
      const result = await validateHypothetical(currentHarness, fromPortId, targetPortId);
      set((s) => ({
        wiring: { ...s.wiring, hover: { portId: targetPortId, severity: result.severity, message: result.message } },
      }));
    } catch {
      set((s) => ({ wiring: { ...s.wiring, hover: { portId: targetPortId, severity: "ok", message: "" } } }));
    }
  },

  clearWiringHover: () => set((s) => ({
    wiring: { ...s.wiring, hover: null },
  })),

  completeWiring: async (targetPortId, targetNodeId) => {
    const { wiring, currentHarness, harness } = get();
    if (!wiring.active || !wiring.sourcePortId || !currentHarness || !harness) return;

    // Find or determine net for both ports
    const portIndex = Object.fromEntries(harness.node_ports.map((p) => [p.id, p]));
    const srcPort = portIndex[wiring.sourcePortId];
    const tgtPort = portIndex[targetPortId];

    if (!srcPort || !tgtPort) {
      set({ wiring: EMPTY_WIRING });
      return;
    }

    // Check hard violations first
    if (wiring.hover?.severity === "error") {
      // Toast is shown by the canvas; just cancel
      set({ wiring: EMPTY_WIRING });
      return;
    }

    get()._pushSnapshot();

    // Determine net_ref: prefer existing net, else null (user assigns later)
    const netRef = srcPort.net_ref ?? tgtPort.net_ref ?? null;

    // Determine from/to endpoint kinds
    const fromKind = "node_port";
    const toKind   = "node_port";

    const segBody: Record<string, unknown> = {
      type: "segment",
      net_ref: netRef,
      from: { kind: fromKind, ref: wiring.sourcePortId },
      to:   { kind: toKind,   ref: targetPortId },
      conductor: {},
      length_source: "manual",
    };

    try {
      const created = await createEntity(currentHarness, "segments", segBody);
      const newSeg = created as unknown as Segment;

      // Store waypoints in layout
      const layout = get().layout ?? EMPTY_LAYOUT;
      const newLayout: LayoutData = {
        ...layout,
        edges: {
          ...layout.edges,
          [newSeg.id]: { waypoints: wiring.waypoints },
        },
      };
      await saveLayout(currentHarness, newLayout);

      // Refresh harness data
      await get().reloadHarness();
      get().ws?.send("refresh");
    } catch (e) {
      console.error("Failed to create segment:", e);
    }

    set({ wiring: EMPTY_WIRING });
  },

  // ── undo/redo ───────────────────────────────────────────────────────────────

  _pushSnapshot: () => {
    const { harness, layout } = get();
    if (!harness || !layout) return;
    const snap: Snapshot = {
      harness: JSON.parse(JSON.stringify(harness)),
      layout:  JSON.parse(JSON.stringify(layout)),
    };
    set((s) => ({
      undoStack: [...s.undoStack.slice(-49), snap],
      redoStack: [],
    }));
  },

  undo: () => {
    const { undoStack, harness, layout } = get();
    if (!undoStack.length || !harness || !layout) return;
    const prev = undoStack[undoStack.length - 1];
    const current: Snapshot = {
      harness: JSON.parse(JSON.stringify(harness)),
      layout:  JSON.parse(JSON.stringify(layout)),
    };
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack.slice(-49), current],
      harness: prev.harness,
      layout: prev.layout,
    }));
    get()._scheduleAutosave();
  },

  redo: () => {
    const { redoStack, harness, layout } = get();
    if (!redoStack.length || !harness || !layout) return;
    const next = redoStack[redoStack.length - 1];
    const current: Snapshot = {
      harness: JSON.parse(JSON.stringify(harness)),
      layout:  JSON.parse(JSON.stringify(layout)),
    };
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack.slice(-49), current],
      harness: next.harness,
      layout: next.layout,
    }));
    get()._scheduleAutosave();
  },

  _scheduleAutosave: () => {
    const timer = get()._autosaveTimer;
    if (timer) clearTimeout(timer);
    const newTimer = setTimeout(async () => {
      const { currentHarness, layout } = get();
      if (currentHarness && layout) {
        await saveLayout(currentHarness, layout).catch(console.error);
      }
    }, 2000);
    set({ _autosaveTimer: newTimer });
  },

  // ── layout mutations (no server entity write needed, just layout.json) ─────

  moveNode: (nodeId, x, y) => {
    set((s) => {
      if (!s.layout) return s;
      return {
        layout: {
          ...s.layout,
          nodes: { ...s.layout.nodes, [nodeId]: { x, y } },
        },
      };
    });
    get()._scheduleAutosave();
  },

  moveSplice: (spliceId, x, y) => {
    set((s) => {
      if (!s.layout) return s;
      return {
        layout: {
          ...s.layout,
          splices: { ...s.layout.splices, [spliceId]: { x, y } },
        },
      };
    });
    get()._scheduleAutosave();
  },

  updateEdgeWaypoints: (segId, waypoints) => {
    set((s) => {
      if (!s.layout) return s;
      return {
        layout: {
          ...s.layout,
          edges: { ...s.layout.edges, [segId]: { waypoints } },
        },
      };
    });
    get()._scheduleAutosave();
  },

  // ── entity mutations ────────────────────────────────────────────────────────

  reloadHarness: async () => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    const [harness, layout] = await Promise.all([
      fetchHarness(currentHarness),
      fetchLayout(currentHarness),
    ]);
    set({ harness, layout });
  },

  createSegment: async (seg) => {
    const { currentHarness } = get();
    if (!currentHarness) return null;
    get()._pushSnapshot();
    const created = await createEntity(currentHarness, "segments", seg as Record<string, unknown>);
    await get().reloadHarness();
    get().ws?.send("refresh");
    return created as unknown as Segment;
  },

  deleteSegment: async (id) => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    get()._pushSnapshot();
    await deleteEntity(currentHarness, "segments", id);
    // Remove from layout.edges too
    set((s) => {
      if (!s.layout) return s;
      const edges = { ...s.layout.edges };
      delete edges[id];
      return { layout: { ...s.layout, edges } };
    });
    await get().reloadHarness();
    get().ws?.send("refresh");
  },

  createSplice: async (splice) => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    get()._pushSnapshot();
    await createEntity(currentHarness, "splices", splice);
    await get().reloadHarness();
    get().ws?.send("refresh");
  },

  deleteSplice: async (id) => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    get()._pushSnapshot();
    await deleteEntity(currentHarness, "splices", id);
    set((s) => {
      if (!s.layout) return s;
      const splices = { ...s.layout.splices };
      delete splices[id];
      return { layout: { ...s.layout, splices } };
    });
    await get().reloadHarness();
    get().ws?.send("refresh");
  },

  updateNet: async (id, partial) => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    get()._pushSnapshot();
    await updateEntity(currentHarness, "nets", id, partial);
    await get().reloadHarness();
    get().ws?.send("refresh");
  },

  deleteNet: async (id) => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    get()._pushSnapshot();
    await deleteEntity(currentHarness, "nets", id);
    await get().reloadHarness();
    get().ws?.send("refresh");
  },

  genericCreate: async (entityType, body) => {
    const { currentHarness } = get();
    if (!currentHarness) throw new Error("No harness loaded");
    get()._pushSnapshot();
    const result = await createEntity(currentHarness, entityType, body);
    await get().reloadHarness();
    get().ws?.send("refresh");
    return result;
  },

  genericUpdate: async (entityType, id, body) => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    get()._pushSnapshot();
    await updateEntity(currentHarness, entityType, id, body);
    await get().reloadHarness();
    get().ws?.send("refresh");
  },

  genericDelete: async (entityType, id) => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    get()._pushSnapshot();
    await deleteEntity(currentHarness, entityType, id);
    await get().reloadHarness();
    get().ws?.send("refresh");
  },
}));
