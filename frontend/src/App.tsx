import { useEffect, useState } from "react";
import { useProjectStore } from "./store/project";
import { GraphCanvas } from "./views/GraphCanvas";
import { NetTable } from "./views/NetTable";
import { WireTable } from "./views/WireTable";
import { BundleTree } from "./views/BundleTree";
import { ValidationPanel } from "./views/ValidationPanel";

const NAV_ITEMS = [
  { id: "graph",      label: "Graph" },
  { id: "nets",       label: "Nets" },
  { id: "wires",      label: "Wires" },
  { id: "bundles",    label: "Bundles" },
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
};

export default function App() {
  const { loadProject, meta, currentHarness, harnessNames, switchHarness, activeView, setActiveView, diagnostics } =
    useProjectStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProject()
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [loadProject]);

  if (loading) return <div style={S.loader}>Loading project…</div>;
  if (error)   return <div style={{ ...S.loader, color: "#f87171" }}>Error: {error}</div>;

  const errorCount   = diagnostics.filter((d) => d.severity === "error"   && !d.waived).length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning" && !d.waived).length;

  return (
    <div style={S.app}>
      {/* Header */}
      <header style={S.header}>
        <span style={S.title}>⚡ Harness Tool</span>
        <span style={S.hname}>{meta?.name}</span>
        <div style={{ flex: 1 }} />
        {harnessNames.length > 1 && (
          <select
            value={currentHarness ?? ""}
            onChange={(e) => switchHarness(e.target.value)}
            style={{ background: "#2d3748", color: "#e2e8f0", border: "1px solid #4a5568",
                     padding: "3px 6px", borderRadius: 4, fontSize: 12, fontFamily: "inherit" }}
          >
            {harnessNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        <DiagBadge count={errorCount} color="#f87171" label="err" />
        <DiagBadge count={warningCount} color="#fbbf24" label="warn" />
      </header>

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
          <div style={{ flex: 1, overflow: "hidden" }}>
            {activeView === "graph"   && <GraphCanvas />}
            {activeView === "nets"    && <NetTable />}
            {activeView === "wires"   && <WireTable />}
            {activeView === "bundles" && <BundleTree />}
          </div>
          <div style={S.vPanel}>
            <ValidationPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function DiagBadge({ count, color, label }: { count: number; color: string; label: string }) {
  if (count === 0) return null;
  return (
    <span style={{ background: "#1e293b", color, border: `1px solid ${color}`,
                   borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>
      {count} {label}
    </span>
  );
}
