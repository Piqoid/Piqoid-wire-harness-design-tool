import { useEffect, useState } from "react";
import { useProjectStore } from "./store/project";
import { GraphCanvas } from "./views/GraphCanvas";
import { NetTable } from "./views/NetTable";
import { WireTable } from "./views/WireTable";
import { BundleTree } from "./views/BundleTree";
import { ValidationPanel } from "./views/ValidationPanel";
import { InspectorPanel } from "./views/InspectorPanel";

const NAV_ITEMS = [
  { id: "graph",   label: "Graph" },
  { id: "nets",    label: "Nets" },
  { id: "wires",   label: "Wires" },
  { id: "bundles", label: "Bundles" },
] as const;

const S: Record<string, React.CSSProperties> = {
  app:    { display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" },
  header: { display: "flex", alignItems: "center", gap: 12, padding: "6px 14px",
            background: "#1e2433", borderBottom: "1px solid #2d3748", flexShrink: 0 },
  title:  { fontWeight: 700, fontSize: 14, color: "#e2e8f0", letterSpacing: ".04em" },
  hname:  { fontSize: 12, color: "#94a3b8", marginLeft: 8 },
  body:   { display: "flex", flex: 1, overflow: "hidden" },
  nav:    { width: 120, background: "#151922", borderRight: "1px solid #2d3748",
            display: "flex", flexDirection: "column", padding: "8px 0", flexShrink: 0 },
  navBtn: { padding: "7px 14px", cursor: "pointer", border: "none", background: "none",
            color: "#94a3b8", textAlign: "left", fontSize: 12, fontFamily: "inherit",
            transition: "background .12s, color .12s" },
  main:   { flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" },
  vPanel: { flexShrink: 0, borderTop: "1px solid #2d3748" },
  loader: { display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", color: "#60a5fa", fontSize: 14 },
  empty:  { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: "100%", gap: 16, color: "#94a3b8", fontSize: 14 },
};

export default function App() {
  const {
    loadProject, openHarness, meta, currentHarness,
    activeView, setActiveView, diagnostics, undoStack, redoStack, undo, redo,
  } = useProjectStore();
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProject()
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [loadProject]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const handleOpenHarness = async () => {
    setOpening(true);
    setError(null);
    try { await openHarness(); }
    catch (e) { setError(String(e)); }
    finally { setOpening(false); }
  };

  if (loading) return <div style={S.loader}>Loading…</div>;

  const errorCount   = diagnostics.filter((d) => d.severity === "error"   && !d.waived).length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning" && !d.waived).length;

  return (
    <div style={S.app}>
      {/* Header */}
      <header style={S.header}>
        <span style={S.title}>⚡ Harness Tool</span>
        {currentHarness && <span style={S.hname}>{meta?.name ?? currentHarness}</span>}
        <div style={{ flex: 1 }} />

        <button
          onClick={handleOpenHarness}
          disabled={opening}
          style={headerBtn}
        >
          {opening ? "Opening…" : "Open Harness"}
        </button>
        <button disabled style={{ ...headerBtn, opacity: 0.38, cursor: "not-allowed" }}>
          Export
        </button>

        <button
          onClick={undo} disabled={!undoStack.length}
          title="Undo (Ctrl+Z)"
          style={{ ...undoRedoBtn, color: undoStack.length ? "#94a3b8" : "#374151" }}>↩</button>
        <button
          onClick={redo} disabled={!redoStack.length}
          title="Redo (Ctrl+Y)"
          style={{ ...undoRedoBtn, color: redoStack.length ? "#94a3b8" : "#374151" }}>↪</button>

        <DiagBadge count={errorCount}   color="#f87171" label="err" />
        <DiagBadge count={warningCount} color="#fbbf24" label="warn" />
      </header>

      {error && (
        <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: "6px 14px", fontSize: 12 }}>
          {error}
        </div>
      )}

      {!currentHarness ? (
        <div style={S.empty}>
          <span style={{ fontSize: 32 }}>📂</span>
          <span>No harness loaded</span>
          <button onClick={handleOpenHarness} disabled={opening} style={openBtn}>
            {opening ? "Opening…" : "Open Harness Folder"}
          </button>
        </div>
      ) : (
        <div style={S.body}>
          {/* Sidebar nav */}
          <nav style={S.nav}>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                style={{
                  ...S.navBtn,
                  background: activeView === item.id ? "#1e3a5f" : "none",
                  color:       activeView === item.id ? "#60a5fa" : "#94a3b8",
                  borderLeft:  activeView === item.id ? "2px solid #3b82f6" : "2px solid transparent",
                }}
                onClick={() => setActiveView(item.id as typeof activeView)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Main content + validation panel */}
          <div style={S.main}>
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              {activeView === "graph"   && (
                <>
                  <GraphCanvas />
                  <InspectorPanel />
                </>
              )}
              {activeView === "nets"    && <NetTable />}
              {activeView === "wires"   && <WireTable />}
              {activeView === "bundles" && <BundleTree />}
            </div>
            <div style={S.vPanel}>
              <ValidationPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const undoRedoBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 14, padding: "0 4px", fontFamily: "inherit",
};

const headerBtn: React.CSSProperties = {
  background: "#2d3748", color: "#e2e8f0", border: "1px solid #4a5568",
  padding: "3px 10px", borderRadius: 4, fontSize: 12, fontFamily: "inherit",
  cursor: "pointer",
};

const openBtn: React.CSSProperties = {
  background: "#1e3a5f", color: "#60a5fa", border: "1px solid #3b82f6",
  padding: "8px 20px", borderRadius: 6, fontSize: 14, fontFamily: "inherit",
  cursor: "pointer",
};

function DiagBadge({ count, color, label }: { count: number; color: string; label: string }) {
  if (count === 0) return null;
  return (
    <span style={{ background: "#1e293b", color, border: `1px solid ${color}`,
                   borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>
      {count} {label}
    </span>
  );
}
