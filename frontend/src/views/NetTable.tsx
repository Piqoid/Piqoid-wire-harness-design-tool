import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useProjectStore, resolveNetColor } from "../store/project";
import type { Net } from "../types";

const col = createColumnHelper<Net>();

const COLUMNS = [
  col.accessor("name", {
    header: "Net Name",
    cell: (i) => {
      const net = i.row.original;
      const color = resolveNetColor(net);
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
          <span style={{ color: "#e2e8f0", fontWeight: 500 }}>{i.getValue()}</span>
        </span>
      );
    },
  }),
  col.accessor("net_class", { header: "Class" }),
  col.accessor((row) => row.members.length, { id: "members", header: "Ports" }),
  col.accessor("bus_ref", {
    header: "Bus",
    cell: (i) => i.getValue() ? <span style={{ color: "#60a5fa" }}>{String(i.getValue())}</span> : <span style={{ color: "#475569" }}>—</span>,
  }),
  col.accessor((row) => row.declared_signal?.profile_ref, {
    id: "profile",
    header: "Profile",
    cell: (i) => i.getValue() ? <span style={{ color: "#94a3b8" }}>{String(i.getValue())}</span> : <span style={{ color: "#475569" }}>inferred</span>,
  }),
  col.accessor((row) => Object.entries(row.tags ?? {}).map(([k,v]) => `${k}:${v}`).join(" "), {
    id: "tags",
    header: "Tags",
    cell: (i) => (
      <span style={{ color: "#64748b", fontSize: 11 }}>{i.getValue()}</span>
    ),
  }),
];

export function NetTable() {
  const { harness, highlightedEntities, highlightEntities, clearHighlight, diagnostics } = useProjectStore();
  const nets = harness?.nets ?? [];

  const diagByNet = useMemo(() => {
    const m: Record<string, number> = {};
    diagnostics.forEach((d) => d.entities.forEach((eid) => { m[eid] = (m[eid] ?? 0) + 1; }));
    return m;
  }, [diagnostics]);

  const table = useReactTable({
    data: nets,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (!nets.length) return <Empty msg="No nets in this harness" />;

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} style={{ borderBottom: "1px solid #2d3748", background: "#1a2035", position: "sticky", top: 0, zIndex: 1 }}>
              {hg.headers.map((h) => (
                <th key={h.id} style={{ padding: "6px 12px", textAlign: "left", color: "#64748b",
                                        fontSize: 11, fontWeight: 600, letterSpacing: ".06em",
                                        cursor: h.column.getCanSort() ? "pointer" : "default" }}
                    onClick={h.column.getToggleSortingHandler()}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {h.column.getIsSorted() === "asc" ? " ▲" : h.column.getIsSorted() === "desc" ? " ▼" : ""}
                </th>
              ))}
              <th style={{ padding: "6px 12px", textAlign: "left", color: "#64748b", fontSize: 11, fontWeight: 600 }}>Diags</th>
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const net = row.original;
            const isHighlighted = highlightedEntities.size === 0 || highlightedEntities.has(net.id);
            const diagCount = diagByNet[net.id] ?? 0;
            return (
              <tr
                key={row.id}
                style={{
                  borderBottom: "1px solid #1a2035",
                  background: highlightedEntities.has(net.id) ? "#1e3a5f22" : "transparent",
                  opacity: isHighlighted ? 1 : 0.35,
                  cursor: "pointer",
                }}
                onClick={() => highlightedEntities.has(net.id) ? clearHighlight() : highlightEntities([net.id])}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={{ padding: "5px 12px" }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                <td style={{ padding: "5px 12px" }}>
                  {diagCount > 0 && (
                    <span style={{ color: "#f87171", fontSize: 11 }}>⚠ {diagCount}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 24, color: "#475569" }}>{msg}</div>;
}
