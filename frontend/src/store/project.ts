import { create } from "zustand";
import type {
  Diagnostic, HarnessData, LayoutData, Net, NodePort,
  ProjectMeta, Segment, SignalProfile,
} from "../types";
import {
  connectValidationWS,
  createEntity, deleteEntity, updateEntity,
  fetchHarness, fetchLayout, fetchProfiles, fetchProject, fetchStatus, fetchValidation,
  loadFolderPath, openFolderDialog,
  saveLayout, validateHypothetical,
} from "../api/client";

// ── wiring mode ───────────────────────────────────────────────────────────────

export type PortSide = "left" | "right" | "top" | "bottom";

export interface WiringState {
  active: boolean;
  sourceKind: "port" | "splice";
  sourcePortId: string | null;
  sourceNodeId: string | null;
  portSide: PortSide | null;
  /** axis of the segment currently being drawn: "h" = horizontal, "v" = vertical */
  currentAxis: "h" | "v";
  /** exact flow-coord position of the source handle; set when wiring starts */
  sourceHandlePos: { x: number; y: number } | null;
  waypoints: { x: number; y: number }[];
  cursorPos: { x: number; y: number } | null;
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
  openHarness: () => Promise<void>;
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
  startWiring: (
    sourcePortId: string,
    sourceNodeId: string,
    portSide: PortSide,
    sourceHandlePos: { x: number; y: number } | null,
  ) => void;
  startWiringFromSplice: (
    spliceId: string,
    side: PortSide,
    handlePos: { x: number; y: number } | null,
  ) => void;
  cancelWiring: () => void;
  addWaypoint: () => void;
  updateCursorPos: (x: number, y: number) => void;
  setWiringHover: (portId: string, fromPortId: string) => Promise<void>;
  clearWiringHover: () => void;
  completeWiring: (
    targetPortId: string,
    targetNodeId: string,
    targetPortSide: PortSide,
    targetHandlePos: { x: number; y: number } | null,
  ) => Promise<void>;
  completeWiringToSplice: (
    spliceId: string,
    side: PortSide,
    handlePos: { x: number; y: number } | null,
  ) => Promise<void>;
  updateSpliceDims: (spliceId: string, width: number, height: number) => void;

  // Actions — undo/redo
  undo: () => void;
  redo: () => void;
  _pushSnapshot: () => void;
  _scheduleAutosave: () => void;

  // Actions — layout mutations
  moveNode: (nodeId: string, x: number, y: number) => void;
  moveSplice: (spliceId: string, x: number, y: number) => void;
  updateEdgeWaypoints: (segId: string, waypoints: { x: number; y: number }[]) => void;
  updateNodeStyle: (nodeId: string, style: { width?: number; bgColor?: string }) => void;
  setPortSide: (portId: string, side: PortSide) => void;

  // Actions — entity mutations
  createSegment: (seg: Partial<Segment>) => Promise<Segment | null>;
  deleteSegment: (id: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  createSplice: (splice: Record<string, unknown>) => Promise<void>;
  deleteSplice: (id: string) => Promise<void>;
  updateNet: (id: string, partial: Record<string, unknown>) => Promise<void>;
  deleteNet: (id: string) => Promise<void>;
  genericCreate: (entityType: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  genericUpdate: (entityType: string, id: string, body: Record<string, unknown>) => Promise<void>;
  genericDelete: (entityType: string, id: string) => Promise<void>;
  reloadHarness: () => Promise<void>;
  createHarness: (name: string) => Promise<void>;
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

/**
 * Returns the constrained cursor position during wiring:
 * - First segment exits perpendicular to source port's node edge (currentAxis)
 * - Each corner placement toggles the axis (H→V→H...)
 * - The returned point is where the rubber-band wire currently ends
 */
export function getConstrainedCursorPos(
  wiring: WiringState,
): { x: number; y: number } | null {
  if (!wiring.cursorPos) return null;

  const anchor =
    wiring.waypoints.length > 0
      ? wiring.waypoints[wiring.waypoints.length - 1]
      : wiring.sourceHandlePos;

  if (!anchor) return wiring.cursorPos; // Fallback before source pos is known

  return wiring.currentAxis === "h"
    ? { x: wiring.cursorPos.x, y: anchor.y } // Horizontal: y locked to anchor
    : { x: anchor.x, y: wiring.cursorPos.y }; // Vertical: x locked to anchor
}

const EMPTY_WIRING: WiringState = {
  active: false,
  sourceKind: "port",
  sourcePortId: null,
  sourceNodeId: null,
  portSide: null,
  currentAxis: "h",
  sourceHandlePos: null,
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
    const [status, profs] = await Promise.all([fetchStatus(), fetchProfiles()]);
    const profileMap: Record<string, SignalProfile> = {};
    profs.forEach((p) => (profileMap[p.id] = p));
    set({ profiles: profileMap });
    if (status.loaded && status.harness_name) {
      const proj = await fetchProject();
      set({ meta: proj.meta, harnessNames: proj.harness_names });
      await get().switchHarness(status.harness_name);
    }
  },

  openHarness: async () => {
    const path = await openFolderDialog();
    if (!path) return;
    const { harness_name } = await loadFolderPath(path);
    const [proj, profs] = await Promise.all([fetchProject(), fetchProfiles()]);
    const profileMap: Record<string, SignalProfile> = {};
    profs.forEach((p) => (profileMap[p.id] = p));
    set({ meta: proj.meta, harnessNames: proj.harness_names, profiles: profileMap });
    await get().switchHarness(harness_name);
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

  startWiring: (sourcePortId, sourceNodeId, portSide, sourceHandlePos) => {
    const currentAxis: "h" | "v" =
      portSide === "left" || portSide === "right" ? "h" : "v";
    set({
      wiring: {
        ...EMPTY_WIRING,
        active: true,
        sourceKind: "port",
        sourcePortId,
        sourceNodeId,
        portSide,
        currentAxis,
        sourceHandlePos,
      },
    });
  },

  startWiringFromSplice: (spliceId, side, handlePos) => {
    const currentAxis: "h" | "v" = side === "left" || side === "right" ? "h" : "v";
    set({
      wiring: {
        ...EMPTY_WIRING,
        active: true,
        sourceKind: "splice",
        sourcePortId: spliceId,
        sourceNodeId: spliceId,
        portSide: side,
        currentAxis,
        sourceHandlePos: handlePos,
      },
    });
  },

  cancelWiring: () => set({ wiring: EMPTY_WIRING }),

  addWaypoint: () =>
    set((s) => {
      const end = getConstrainedCursorPos(s.wiring);
      if (!end) return s;
      const newAxis: "h" | "v" = s.wiring.currentAxis === "h" ? "v" : "h";
      return {
        wiring: {
          ...s.wiring,
          waypoints: [...s.wiring.waypoints, end],
          currentAxis: newAxis,
        },
      };
    }),

  updateCursorPos: (x, y) =>
    set((s) => ({ wiring: { ...s.wiring, cursorPos: { x, y } } })),

  setWiringHover: async (targetPortId, fromPortId) => {
    const { currentHarness } = get();
    if (!currentHarness) return;
    try {
      const result = await validateHypothetical(currentHarness, fromPortId, targetPortId);
      set((s) => ({
        wiring: {
          ...s.wiring,
          hover: { portId: targetPortId, severity: result.severity, message: result.message },
        },
      }));
    } catch {
      set((s) => ({
        wiring: { ...s.wiring, hover: { portId: targetPortId, severity: "ok", message: "" } },
      }));
    }
  },

  clearWiringHover: () => set((s) => ({ wiring: { ...s.wiring, hover: null } })),

  completeWiring: async (targetPortId, targetNodeId, targetPortSide, targetHandlePos) => {
    const { wiring, currentHarness, harness } = get();
    if (!wiring.active || !wiring.sourcePortId || !currentHarness || !harness) return;

    const portIndex = Object.fromEntries(harness.node_ports.map((p) => [p.id, p]));

    // If source is a port, validate it exists
    const srcPort = wiring.sourceKind === "port" ? portIndex[wiring.sourcePortId] : null;
    if (wiring.sourceKind === "port" && !srcPort) { set({ wiring: EMPTY_WIRING }); return; }
    const tgtPort = portIndex[targetPortId];
    if (!tgtPort) { set({ wiring: EMPTY_WIRING }); return; }

    // Net mismatch check: both ports assigned → nets must match
    if (srcPort?.net_ref && tgtPort.net_ref && srcPort.net_ref !== tgtPort.net_ref) {
      const srcNetName = harness.nets.find((n) => n.id === srcPort.net_ref)?.name ?? srcPort.net_ref;
      const tgtNetName = harness.nets.find((n) => n.id === tgtPort.net_ref)?.name ?? tgtPort.net_ref;
      set((s) => ({
        wiring: {
          ...s.wiring,
          hover: { portId: targetPortId, severity: "error", message: `Net mismatch: ${srcNetName} ≠ ${tgtNetName}` },
        },
      }));
      return;
    }

    if (wiring.hover?.severity === "error") {
      set({ wiring: EMPTY_WIRING });
      return;
    }

    get()._pushSnapshot();

    // Auto-add final corner when current axis doesn't match destination entry axis
    const destEntryAxis: "h" | "v" =
      targetPortSide === "left" || targetPortSide === "right" ? "h" : "v";
    let finalWaypoints = [...wiring.waypoints];

    if (wiring.currentAxis !== destEntryAxis && targetHandlePos) {
      const anchor =
        finalWaypoints.length > 0
          ? finalWaypoints[finalWaypoints.length - 1]
          : wiring.sourceHandlePos;
      if (anchor) {
        finalWaypoints.push(
          destEntryAxis === "h"
            ? { x: anchor.x, y: targetHandlePos.y }
            : { x: targetHandlePos.x, y: anchor.y },
        );
      }
    }

    const netRef = srcPort?.net_ref ?? tgtPort.net_ref ?? null;
    const fromEndpoint =
      wiring.sourceKind === "splice"
        ? { kind: "splice", ref: wiring.sourcePortId }
        : { kind: "port",   ref: wiring.sourcePortId };

    const segBody: Record<string, unknown> = {
      type: "segment",
      net_ref: netRef,
      from: fromEndpoint,
      to:   { kind: "port", ref: targetPortId },
      conductor: {},
      length_source: "manual",
    };

    try {
      const created = await createEntity(currentHarness, "segments", segBody);
      const newSeg = created as unknown as Segment;
      const layout = get().layout ?? EMPTY_LAYOUT;
      const spliceEdgeSidesPatch = wiring.sourceKind === "splice" ? {
        spliceEdgeSides: {
          ...(layout.spliceEdgeSides ?? {}),
          [newSeg.id]: { srcSide: wiring.portSide ?? undefined },
        },
      } : {};
      const newLayout: LayoutData = {
        ...layout,
        edges: { ...layout.edges, [newSeg.id]: { waypoints: finalWaypoints } },
        ...spliceEdgeSidesPatch,
      };
      await saveLayout(currentHarness, newLayout);
      await get().reloadHarness();
      get().ws?.send("refresh");
    } catch (e) {
      console.error("Failed to create segment:", e);
    }

    set({ wiring: EMPTY_WIRING });
  },

  completeWiringToSplice: async (spliceId, side, handlePos) => {
    const { wiring, currentHarness, harness } = get();
    if (!wiring.active || !wiring.sourcePortId || !currentHarness || !harness) return;
    // Prevent self-loop on same splice
    if (wiring.sourceKind === "splice" && wiring.sourceNodeId === spliceId && wiring.portSide === side) {
      set({ wiring: EMPTY_WIRING }); return;
    }

    get()._pushSnapshot();

    // Auto-add final corner when axis doesn't match destination entry axis
    const destEntryAxis: "h" | "v" = side === "left" || side === "right" ? "h" : "v";
    let finalWaypoints = [...wiring.waypoints];

    if (wiring.currentAxis !== destEntryAxis && handlePos) {
      const anchor = finalWaypoints.length > 0
        ? finalWaypoints[finalWaypoints.length - 1]
        : wiring.sourceHandlePos;
      if (anchor) {
        finalWaypoints.push(
          destEntryAxis === "h"
            ? { x: anchor.x, y: handlePos.y }
            : { x: handlePos.x, y: anchor.y },
        );
      }
    }

    const portIndex = Object.fromEntries(harness.node_ports.map((p) => [p.id, p]));
    const spliceList = harness.splices;
    const srcSplice = wiring.sourceKind === "splice" ? spliceList.find((s) => s.id === wiring.sourcePortId) : null;
    const srcPort   = wiring.sourceKind === "port"   ? portIndex[wiring.sourcePortId] : null;
    const tgtSplice = spliceList.find((s) => s.id === spliceId);

    const netRef = srcPort?.net_ref ?? srcSplice?.net_ref ?? tgtSplice?.net_ref ?? null;
    const fromEndpoint =
      wiring.sourceKind === "splice"
        ? { kind: "splice", ref: wiring.sourcePortId }
        : { kind: "port",   ref: wiring.sourcePortId };

    const segBody: Record<string, unknown> = {
      type: "segment",
      net_ref: netRef,
      from: fromEndpoint,
      to:   { kind: "splice", ref: spliceId },
      conductor: {},
      length_source: "manual",
    };

    try {
      const created = await createEntity(currentHarness, "segments", segBody);
      const newSeg = created as unknown as Segment;
      const layout = get().layout ?? EMPTY_LAYOUT;
      const newLayout: LayoutData = {
        ...layout,
        edges: { ...layout.edges, [newSeg.id]: { waypoints: finalWaypoints } },
        spliceEdgeSides: {
          ...(layout.spliceEdgeSides ?? {}),
          [newSeg.id]: {
            ...(wiring.sourceKind === "splice" ? { srcSide: wiring.portSide ?? undefined } : {}),
            tgtSide: side,
          },
        },
      };
      await saveLayout(currentHarness, newLayout);
      await get().reloadHarness();
      get().ws?.send("refresh");
    } catch (e) {
      console.error("Failed to create segment to splice:", e);
    }

    set({ wiring: EMPTY_WIRING });
  },

  updateSpliceDims: (spliceId, width, height) => {
    set((s) => {
      if (!s.layout) return s;
      const existing = s.layout.splices[spliceId] ?? { x: 0, y: 0 };
      return {
        layout: {
          ...s.layout,
          splices: { ...s.layout.splices, [spliceId]: { ...existing, width, height } },
        },
      };
    });
    get()._scheduleAutosave();
  },

  // ── undo/redo ───────────────────────────────────────────────────────────────

  _pushSnapshot: () => {
    const { harness, layout } = get();
    if (!harness || !layout) return;
    const snap: Snapshot = {
      harness: JSON.parse(JSON.stringify(harness)),
      layout:  JSON.parse(JSON.stringify(layout)),
    };
    set((s) => ({ undoStack: [...s.undoStack.slice(-49), snap], redoStack: [] }));
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

  // ── layout mutations ────────────────────────────────────────────────────────

  moveNode: (nodeId, x, y) => {
    set((s) => {
      if (!s.layout) return s;
      const existing = s.layout.nodes[nodeId] ?? {};
      return {
        layout: {
          ...s.layout,
          nodes: { ...s.layout.nodes, [nodeId]: { ...existing, x, y } },
        },
      };
    });
    get()._scheduleAutosave();
  },

  moveSplice: (spliceId, x, y) => {
    set((s) => {
      if (!s.layout) return s;
      const existing = s.layout.splices[spliceId] ?? {};
      return {
        layout: {
          ...s.layout,
          splices: { ...s.layout.splices, [spliceId]: { ...existing, x, y } },
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

  updateNodeStyle: (nodeId, style) => {
    set((s) => {
      if (!s.layout) return s;
      const existing = s.layout.nodes[nodeId] ?? { x: 0, y: 0 };
      return {
        layout: {
          ...s.layout,
          nodes: { ...s.layout.nodes, [nodeId]: { ...existing, ...style } },
        },
      };
    });
    get()._scheduleAutosave();
  },

  setPortSide: (portId, side) => {
    set((s) => {
      if (!s.layout) return s;
      return {
        layout: {
          ...s.layout,
          portSides: { ...(s.layout.portSides ?? {}), [portId]: side },
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
    const { currentHarness, harness } = get();
    if (!currentHarness || !harness) return;
    get()._pushSnapshot();

    // Cascade: strip this segment from any bundle that references it
    const affectedBundles = harness.bundles.filter((b) => b.segment_refs.includes(id));
    await Promise.all(
      affectedBundles.map((b) =>
        updateEntity(currentHarness, "bundles", b.id, {
          segment_refs: b.segment_refs.filter((r) => r !== id),
        }).catch(() => {}),
      ),
    );

    await deleteEntity(currentHarness, "segments", id);

    set((s) => {
      if (!s.layout) return s;
      const edges = { ...s.layout.edges };
      delete edges[id];
      const spliceEdgeSides = { ...(s.layout.spliceEdgeSides ?? {}) };
      delete spliceEdgeSides[id];
      return { layout: { ...s.layout, edges, spliceEdgeSides } };
    });
    await get().reloadHarness();
    get().ws?.send("refresh");
  },

  deleteNode: async (id) => {
    const { currentHarness, harness } = get();
    if (!currentHarness || !harness) return;
    get()._pushSnapshot();
    // Delete all ports belonging to this node first
    const ports = harness.node_ports.filter((p) => p.node_ref === id);
    for (const p of ports) {
      await deleteEntity(currentHarness, "node_ports", p.id).catch(() => {});
    }
    // Delete segments connected to those ports
    const portIds = new Set(ports.map((p) => p.id));
    const connectedSegs = harness.segments.filter(
      (s) => portIds.has(s.from.ref) || portIds.has(s.to.ref),
    );
    for (const s of connectedSegs) {
      await deleteEntity(currentHarness, "segments", s.id).catch(() => {});
    }
    await deleteEntity(currentHarness, "nodes", id);
    set((s) => {
      if (!s.layout) return s;
      const nodes = { ...s.layout.nodes };
      delete nodes[id];
      return { layout: { ...s.layout, nodes } };
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

  createHarness: async (name) => {
    const resp = await fetch("/api/harness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text);
    }
    const proj = await fetchProject();
    set({ harnessNames: proj.harness_names });
    await get().switchHarness(name);
  },
}));
