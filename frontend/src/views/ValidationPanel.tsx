import { useState } from "react";
import { useProjectStore } from "../store/project";
import type { Diagnostic, Severity } from "../types";

const SEV_ORDER: Severity[] = ["error", "warning", "info"];
const SEV_COLOR: Record<Severity, string> = { error: "#f87171", warning: "#fbbf24", info: "#60a5fa" };
const SEV_LABEL: Record<Severity, string> = { error: "Errors", warning: "Warnings", info: "Info" };

export function ValidationPanel() {
  const { diagnostics, highlightedEntities, highlightEntities, clearHighlight } = useProjectStore();
  const [collapsed, setPanelCollapsed] = useState(false);
  const [showWaived, setShowWaived] = useState(false);
  const [openSections, setOpenSections] = useState<Set<Severity>>(new Set(["error", "warning"]));

  const active   = diagnostics.filter((d) => !d.waived);
  const waived   = diagnostics.filter((d) => d.waived);
  const visible  = showWaived ? diagnostics : active;

  const counts = SEV_ORDER.reduce<Record<Severity, number>>((acc, sev) => {
    acc[sev] = active.filter((d) => d.severity === sev).length;
    return acc;
  }, {} as Record<Severity, number>);

  const toggleSection = (s: Severity) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  if (collapsed) {
    return (
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px",
                 cursor: "pointer", background: "#151922" }}
        onClick={() => setPanelCollapsed(false)}
      >
        <span style={{ fontSize: 11, color: "#94a3b8" }}>▶ Validation</span>
        {SEV_ORDER.map((sev) => counts[sev] > 0 && (
          <span key={sev} style={{ fontSize: 11, color: SEV_COLOR[sev] }}>
            {counts[sev]} {sev === "error" ? "err" : sev === "warning" ? "warn" : "info"}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 220, overflow: "auto", background: "#111827" }}>
      {/* Panel header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px",
                    borderBottom: "1px solid #1a2035", background: "#151922", position: "sticky", top: 0, zIndex: 2 }}>
        <span style={{ fontSize: 11, color: "#64748b", cursor: "pointer" }}
              onClick={() => setPanelCollapsed(true)}>▼ Validation</span>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 11, color: "#475569", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={showWaived} onChange={(e) => setShowWaived(e.target.checked)}
                 style={{ cursor: "pointer" }} />
          show waived ({waived.length})
        </label>
        {highlightedEntities.size > 0 && (
          <button onClick={clearHighlight}
                  style={{ fontSize: 11, color: "#94a3b8", background: "none", border: "none",
                           cursor: "pointer", padding: "0 4px" }}>
            × clear
          </button>
        )}
      </div>

      {visible.length === 0 && (
        <div style={{ padding: "10px 14px", fontSize: 12, color: "#22c55e" }}>
          ✓ No diagnostics
        </div>
      )}

      {SEV_ORDER.map((sev) => {
        const rows = visible.filter((d) => d.severity === sev);
        if (rows.length === 0) return null;
        const isOpen = openSections.has(sev);
        return (
          <div key={sev}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 12px",
                       background: "#151922", cursor: "pointer", borderBottom: "1px solid #1a2035" }}
              onClick={() => toggleSection(sev)}
            >
              <span style={{ fontSize: 10, color: "#475569" }}>{isOpen ? "▼" : "▶"}</span>
              <span style={{ fontSize: 11, color: SEV_COLOR[sev], fontWeight: 600 }}>
                {SEV_LABEL[sev]} ({rows.length})
              </span>
            </div>
            {isOpen && rows.map((d, i) => (
              <DiagRow key={i} diag={d} highlighted={highlightedEntities}
                       onHighlight={highlightEntities} onClear={clearHighlight} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DiagRow({ diag, highlighted, onHighlight, onClear }: {
  diag: Diagnostic;
  highlighted: Set<string>;
  onHighlight: (ids: string[]) => void;
  onClear: () => void;
}) {
  const isActive = diag.entities.length > 0 && diag.entities.some((e) => highlighted.has(e));
  const color = SEV_COLOR[diag.severity];

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        padding: "4px 14px 4px 20px",
        borderBottom: "1px solid #1a2035",
        cursor: diag.entities.length > 0 ? "pointer" : "default",
        background: isActive ? "#1e3a5f22" : "transparent",
        opacity: diag.waived ? 0.5 : 1,
      }}
      onClick={() => {
        if (!diag.entities.length) return;
        isActive ? onClear() : onHighlight(diag.entities);
      }}
    >
      <span style={{ fontSize: 10, color, fontFamily: "monospace", marginTop: 1, flexShrink: 0 }}>
        {diag.rule_id}
      </span>
      <span style={{ fontSize: 11, color: "#cbd5e1", flex: 1 }}>{diag.message}</span>
      {diag.waived && (
        <span style={{ fontSize: 10, color: "#475569", flexShrink: 0 }} title={diag.waiver_reason}>
          waived
        </span>
      )}
      {diag.entities.length > 0 && (
        <span style={{ fontSize: 10, color: "#475569", flexShrink: 0 }}>
          {diag.entities.length} ent.
        </span>
      )}
    </div>
  );
}
