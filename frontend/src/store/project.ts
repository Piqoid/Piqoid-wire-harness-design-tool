import { create } from "zustand";
import type { Diagnostic, HarnessData, LayoutData, Net, ProjectMeta, SignalProfile } from "../types";
import {
  connectValidationWS,
  fetchHarness,
  fetchLayout,
  fetchProfiles,
  fetchProject,
  fetchValidation,
} from "../api/client";

interface ProjectStore {
  // Data
  meta: ProjectMeta | null;
  harnessNames: string[];
  currentHarness: string | null;
  harness: HarnessData | null;
  layout: LayoutData | null;
  profiles: Record<string, SignalProfile>;
  diagnostics: Diagnostic[];

  // UI selection state
  activeView: "graph" | "nets" | "wires" | "bundles" | "validation";
  highlightedEntities: Set<string>;
  hoveredNet: string | null;

  // WS
  ws: WebSocket | null;

  // Actions
  loadProject: () => Promise<void>;
  switchHarness: (name: string) => Promise<void>;
  setActiveView: (v: ProjectStore["activeView"]) => void;
  highlightEntities: (ids: string[]) => void;
  clearHighlight: () => void;
  setHoveredNet: (id: string | null) => void;
}

// Derive net color from net data + display_rules
export function resolveNetColor(net: Net): string {
  const explicit = net.display?.color;
  if (explicit) return explicit;
  switch (net.net_class) {
    case "power":   return "#dc2626";
    case "ground":  return "#64748b";
    case "shield":  return "#78716c";
    default:        return "#60a5fa";
  }
}

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
  ws: null,

  loadProject: async () => {
    const [proj, profs] = await Promise.all([fetchProject(), fetchProfiles()]);
    const profileMap: Record<string, SignalProfile> = {};
    profs.forEach((p) => (profileMap[p.id] = p));
    set({ meta: proj.meta, harnessNames: proj.harness_names, profiles: profileMap });

    // Auto-load first harness that isn't broken
    const preferred = proj.harness_names.find((n) => !n.includes("broken")) ?? proj.harness_names[0];
    if (preferred) await get().switchHarness(preferred);
  },

  switchHarness: async (name: string) => {
    const [harness, layout, diags] = await Promise.all([
      fetchHarness(name),
      fetchLayout(name),
      fetchValidation(name),
    ]);
    // Close old WS
    get().ws?.close();
    // Open new WS
    const ws = connectValidationWS(name, (d) => set({ diagnostics: d }));
    set({ currentHarness: name, harness, layout, diagnostics: diags, ws });
  },

  setActiveView: (v) => set({ activeView: v }),
  highlightEntities: (ids) => set({ highlightedEntities: new Set(ids) }),
  clearHighlight: () => set({ highlightedEntities: new Set() }),
  setHoveredNet: (id) => set({ hoveredNet: id }),
}));
