import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useProjectStore, resolveNetColor } from "../store/project";
import type { Segment } from "../types";

const col = createColumnHelper<Segment>();

function GaugeCell({ seg }: { seg: Segment }) {
  const g = seg.conductor?.gauge;
  if (!g) return <span style={{ color: "#475569" }}>—</span>;
  const parts = [];
  if (g.awg != null) parts.push(`AWG ${g.awg}`);
  if (g.mm2 != null) parts.push(`${g.mm2} mm²`);
  return <span>{parts.join(" / ")}</span>;
}

function ColorCell({ seg }: { seg: Segment }) {
  const c = seg.conductor?.color;
  if (!c) return <span style={{ color: "#475569" }}>—</span>;
  const stripe = seg.conductor?.stripe;
  const label = stripe ? `${c}/${stripe}` : c;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{
        width: 12, height: 12, borderRadius: 2,
        background: WIRE_COLORS[c] ?? "#64748b",
        border: "1px solid #4a5568", flexShrink: 0,
      }} />
      {label}
    </span>
  );
}

const WIRE_COLORS: Record<string, string> = {
  RD: "#ef4444", BK: "#1e293b", WH: "#f8fafc", BU: "#3b82f6",
  GN: "#22c55e", YL: "#eab308", VT: "#a855f7", BN: "#92400e",
  GY: "#94a3b8", OR: "#f97316",
};

const COLUMNS = [
  col.accessor("label", {
    header: "Label",
    cell: (i) => <span style={{ color: "#60a5fa", fontWeight: 500 }}>{i.getValue() ?? "—"}</span>,
  }),
  col.accessor("net_ref", {
    header: "Net",
    cell: (i) => {
      const netRef = i.getValue();
      const { harness } = useProjectStore.getState();
      const net = harness?.nets.find((n) => n.id === netRef);
      if (!net) return <span style={{ color: "#475569" }}>{netRef ?? "—"}</span>;
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: resolveNetColor(net), flexShrink: 0 }} />
          <span style={{ color: "#e2e8f0" }}>{net.name}</span>
        </span>
      );
    },
  }),
  col.display({ id: "gauge", header: "Gauge", cell: (i) => <GaugeCell seg={i.row.original} /> }),
  col.display({ id: "color", header: "Color", cell: (i) => <ColorCell seg={i.row.original} /> }),
  col.accessor("length_mm", {
    header: "Length",
    cell: (i) => {
      const v = i.getValue();
      const src = i.row.original.length_source;
      const srcColor = src === "measured" ? "#22c55e" : src === "routed" ? "#60a5fa" : "#94a3b8";
      return v != null
        ? <span>{v} mm <span style={{ color: srcColor, fontSize: 11 }}>({src})</span></span>
        : <span style={{ color: "#475569" }}>—</span>;
    },
  }),
  col.accessor((row) => row.bundle_refs?.join(", "), {
    id: "bundles",
    header: "Bundle(s)",
    cell: (i) => <span style={{ color: "#64748b", fontSize: 11 }}>{i.getValue() ?? "—"}</span>,
  }),
  col.accessor((row) => Object.entries(row.tags ?? {}).map(([k,v]) => `${k}:${v}`).join(" "), {
    id: "tags", header: "Tags",
    cell: (i) => <span style={{ color: "#475569", fontSize: 11 }}>{i.getValue()}</span>,
  }),
];

export function WireTable() {
  const { harness, highlightedEntities, highlightEntities, clearHighlight, diagnostics } = useProjectStore();
  const segments = harness?.segments ?? [];

  const diagBySeg = useMemo(() => {
    const m: Record<string, number> = {};
    diagnostics.forEach((d) => d.entities.forEach((eid) => { m[eid] = (m[eid] ?? 0) + 1; }));
    return m;
  }, [diagnostics]);

  const table = useReactTable({
    data: segments,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (!segments.length) return <div style={{ padding: 24, color: "#475569" }}>No segments in this harness</div>;

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} style={{ borderBottom: "1px solid #2d3748", background: "#1a2035", position: "sticky", top: 0 }}>
              {hg.headers.map((h) => (
                <th key={h.id} style={{ padding: "6px 12px", textAlign: "left", color: "#64748b",
                                        fontSize: 11, fontWeight: 600, letterSpacing: ".06em",
                                        cursor: h.column.getCanSort() ? "pointer" : "default" }}
                    onClick={h.column.getToggleSortingHandler()}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
              <th style={{ padding: "6px 12px", color: "#64748b", fontSize: 11, fontWeight: 600 }}>Diags</th>
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const seg = row.original;
            const isHighlighted = highlightedEntities.size === 0 || highlightedEntities.has(seg.id);
            const diagCount = diagBySeg[seg.id] ?? 0;
            return (
              <tr
                key={row.id}
                style={{
                  borderBottom: "1px solid #1a2035",
                  opacity: isHighlighted ? 1 : 0.35,
                  background: highlightedEntities.has(seg.id) ? "#1e3a5f22" : "transparent",
                  cursor: "pointer",
                }}
                onClick={() => highlightedEntities.has(seg.id) ? clearHighlight() : highlightEntities([seg.id])}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={{ padding: "5px 12px" }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                <td style={{ padding: "5px 12px" }}>
                  {diagCount > 0 && <span style={{ color: "#f87171", fontSize: 11 }}>⚠ {diagCount}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
