import { useState } from "react";

interface ExportItem {
  label: string;
  url: string;
  desc: string;
  ext: string;
}

const EXPORTS: ExportItem[] = [
  { label: "Wire Cut List",        url: "/api/export/cut-list.csv",   desc: "One row per conductor segment",       ext: "csv"  },
  { label: "Bill of Materials",    url: "/api/export/bom.csv",        desc: "Components, cables, sheath parts",    ext: "csv"  },
  { label: "Flat Netlist (CSV)",   url: "/api/export/netlist.csv",    desc: "Net → port membership table",         ext: "csv"  },
  { label: "KiCad Netlist (.net)", url: "/api/export/netlist.net",    desc: "Pcbnew legacy netlist format",        ext: "net"  },
  { label: "Connector Pinouts",    url: "/api/export/pinouts.csv",    desc: "All nodes combined pinout table",     ext: "csv"  },
  { label: "Pinouts (per node)",   url: "/api/export/pinouts.zip",    desc: "ZIP of one CSV per connector",        ext: "zip"  },
  { label: "Wire Labels (Brady)",  url: "/api/export/wire-labels.csv",desc: "Brady/DYMO label printer CSV",        ext: "csv"  },
  { label: "Topology SVG",         url: "/api/export/topology.svg",   desc: "SVG harness topology diagram",        ext: "svg"  },
  { label: "Validation Report",    url: "/api/export/report.html",    desc: "HTML report with all diagnostics",    ext: "html" },
  { label: "Validation (JSON)",    url: "/api/export/report.json",    desc: "Machine-readable diagnostics",        ext: "json" },
  { label: "Portable Bundle (.pqh)", url: "/api/export/bundle.pqh",  desc: "Deterministic zip — share with anyone", ext: "pqh" },
];

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  panel: {
    background: "#1e2433", border: "1px solid #2d3748", borderRadius: 8,
    width: 520, maxHeight: "80vh", display: "flex", flexDirection: "column",
    boxShadow: "0 20px 40px rgba(0,0,0,.5)",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 16px", borderBottom: "1px solid #2d3748",
  },
  title: { fontWeight: 700, fontSize: 14, color: "#e2e8f0" },
  close: {
    background: "none", border: "none", color: "#94a3b8", fontSize: 18,
    cursor: "pointer", padding: "0 4px", lineHeight: 1,
  },
  list: { overflow: "auto", padding: "8px 0" },
  row: {
    display: "flex", alignItems: "center", gap: 12,
    padding: "7px 16px", borderBottom: "1px solid #1a2035",
  },
  info: { flex: 1, minWidth: 0 },
  label: { fontSize: 13, color: "#e2e8f0", fontWeight: 500 },
  desc:  { fontSize: 11, color: "#64748b", marginTop: 1 },
  dlBtn: {
    background: "#1e3a5f", color: "#60a5fa", border: "1px solid #3b82f6",
    borderRadius: 4, padding: "3px 10px", fontSize: 12, cursor: "pointer",
    fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
  },
  dlBtnBusy: {
    opacity: 0.6, cursor: "wait",
  },
  extBadge: {
    background: "#0f172a", color: "#94a3b8", border: "1px solid #334155",
    borderRadius: 3, padding: "1px 6px", fontSize: 10, fontFamily: "monospace",
    flexShrink: 0,
  },
  footer: {
    padding: "10px 16px", borderTop: "1px solid #2d3748",
    fontSize: 11, color: "#475569",
  },
};

export function ExportPanel({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (item: ExportItem) => {
    setError(null);
    setBusy(item.url);
    try {
      const r = await fetch(item.url);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        throw new Error((err as { detail?: string }).detail ?? r.statusText);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      // extract filename from content-disposition or use url basename
      const cd = r.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename="?([^";\n]+)"?/);
      a.href = url;
      a.download = match ? match[1] : item.url.split("/").pop()!;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.panel}>
        <div style={S.header}>
          <span style={S.title}>Export</span>
          <button style={S.close} onClick={onClose}>×</button>
        </div>

        {error && (
          <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: "6px 16px", fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={S.list}>
          {EXPORTS.map((item) => (
            <div key={item.url} style={S.row}>
              <div style={S.info}>
                <div style={S.label}>{item.label}</div>
                <div style={S.desc}>{item.desc}</div>
              </div>
              <span style={S.extBadge}>{item.ext}</span>
              <button
                style={{ ...S.dlBtn, ...(busy === item.url ? S.dlBtnBusy : {}) }}
                disabled={busy !== null}
                onClick={() => handleDownload(item)}
              >
                {busy === item.url ? "…" : "Download"}
              </button>
            </div>
          ))}
        </div>

        <div style={S.footer}>
          Downloads go to your browser&apos;s default download folder.
        </div>
      </div>
    </div>
  );
}
