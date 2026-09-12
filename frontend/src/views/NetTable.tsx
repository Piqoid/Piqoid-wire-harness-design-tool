import { useCallback, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useProjectStore, resolveNetColor } from "../store/project";
import type { Net, NetClass } from "../types";
import { PropertyEditorModal } from "./PropertyEditor";
import type { PropEditorTarget } from "./PropertyEditor";

const col = createColumnHelper<Net>();

// ── constants ─────────────────────────────────────────────────────────────────

const NET_CLASS_OPTS: { value: NetClass; label: string }[] = [
  { value: "signal",     label: "Signal" },
  { value: "power",      label: "Power" },
  { value: "ground",     label: "Ground" },
  { value: "shield",     label: "Shield" },
  { value: "no_connect", label: "No Connect" },
];

// ── create-net modal ──────────────────────────────────────────────────────────

function CreateNetModal({ onClose }: { onClose: () => void }) {
  const { genericCreate } = useProjectStore();
  const [name, setName]         = useState("");
  const [netClass, setNetClass] = useState<NetClass>("signal");
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const doCreate = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true); setErr(null);
    try {
      await genericCreate("nets", {
        type: "net",
        name: name.trim(),
        net_class: netClass,
        members: [],
        tags: {},
      });
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }, [name, netClass, genericCreate, onClose]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#151c2b", border: "1px solid #2d3748", borderRadius: 8,
        padding: 0, minWidth: 340, fontFamily: "inherit",
        boxShadow: "0 12px 40px rgba(0,0,0,.7)",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px",
                      borderBottom: "1px solid #1e2740", background: "#0f1623",
                      borderRadius: "8px 8px 0 0" }}>
          <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, flex: 1 }}>Create Net</span>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: "#64748b",
                     cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <Field label="Name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doCreate()}
              placeholder="VCC, GND, SPI_CLK…"
              style={inputSt}
            />
          </Field>
          <Field label="Class">
            <select value={netClass} onChange={(e) => setNetClass(e.target.value as NetClass)}
                    style={inputSt}>
              {NET_CLASS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {err && <div style={{ color: "#f87171", fontSize: 11, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn primary onClick={doCreate} disabled={!name.trim() || saving}>
              {saving ? "Creating…" : "Create"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── delete confirm ─────────────────────────────────────────────────────────────

function DeleteNetModal({ net, onClose }: { net: Net; onClose: () => void }) {
  const { deleteNet } = useProjectStore();
  const [saving, setSaving] = useState(false);

  const doDelete = useCallback(async () => {
    setSaving(true);
    try { await deleteNet(net.id); onClose(); }
    catch { setSaving(false); }
  }, [deleteNet, net.id, onClose]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#151c2b", border: "1px solid #2d3748", borderRadius: 8,
        padding: "20px 24px", minWidth: 300, fontFamily: "inherit",
        boxShadow: "0 12px 40px rgba(0,0,0,.7)",
      }}>
        <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, marginBottom: 10 }}>
          Delete Net "{net.name}"?
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
          This does not remove segments assigned to this net.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn danger onClick={doDelete} disabled={saving}>
            {saving ? "Deleting…" : "Delete"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function NetTable() {
  const { harness, highlightedEntities, highlightEntities, clearHighlight, diagnostics } = useProjectStore();
  const nets = harness?.nets ?? [];

  const [showCreate, setShowCreate] = useState(false);
  const [propEditor, setPropEditor] = useState<PropEditorTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Net | null>(null);

  const diagByNet = useMemo(() => {
    const m: Record<string, number> = {};
    diagnostics.forEach((d) => d.entities.forEach((eid) => { m[eid] = (m[eid] ?? 0) + 1; }));
    return m;
  }, [diagnostics]);

  const columns = useMemo(() => [
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
      cell: (i) => i.getValue()
        ? <span style={{ color: "#60a5fa" }}>{String(i.getValue())}</span>
        : <span style={{ color: "#475569" }}>—</span>,
    }),
    col.accessor((row) => Object.entries(row.tags ?? {}).map(([k, v]) => `${k}:${v}`).join(" "), {
      id: "tags",
      header: "Tags",
      cell: (i) => <span style={{ color: "#64748b", fontSize: 11 }}>{i.getValue()}</span>,
    }),
  ], []);

  const table = useReactTable({
    data: nets,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", borderBottom: "1px solid #2d3748",
        background: "#1a2035", flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: "#94a3b8", flex: 1 }}>
          {nets.length} net{nets.length !== 1 ? "s" : ""}
        </span>
        <Btn primary onClick={() => setShowCreate(true)}>+ Create Net</Btn>
      </div>

      {/* Table */}
      {nets.length === 0 ? (
        <div style={{ padding: 24, color: "#475569", fontSize: 12 }}>
          No nets yet — click "+ Create Net" to add one.
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} style={{
                  borderBottom: "1px solid #2d3748", background: "#1a2035",
                  position: "sticky", top: 0, zIndex: 1,
                }}>
                  {hg.headers.map((h) => (
                    <th key={h.id}
                        style={{ padding: "6px 12px", textAlign: "left", color: "#64748b",
                                 fontSize: 11, fontWeight: 600, letterSpacing: ".06em",
                                 cursor: h.column.getCanSort() ? "pointer" : "default", whiteSpace: "nowrap" }}
                        onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc" ? " ▲" : h.column.getIsSorted() === "desc" ? " ▼" : ""}
                    </th>
                  ))}
                  <th style={{ padding: "6px 12px", color: "#64748b", fontSize: 11, fontWeight: 600 }}>Diags</th>
                  <th style={{ padding: "6px 12px", color: "#64748b", fontSize: 11, fontWeight: 600 }}>Actions</th>
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const net = row.original;
                const isHighlighted = highlightedEntities.size === 0 || highlightedEntities.has(net.id);
                const diagCount = diagByNet[net.id] ?? 0;
                return (
                  <tr key={row.id} style={{
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
                      {diagCount > 0 && <span style={{ color: "#f87171", fontSize: 11 }}>⚠ {diagCount}</span>}
                    </td>
                    <td style={{ padding: "5px 12px" }}
                        onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <ActionBtn onClick={() => setPropEditor({ entityType: "nets", entityId: net.id })}>
                          Edit
                        </ActionBtn>
                        <ActionBtn danger onClick={() => setDeleteTarget(net)}>
                          Delete
                        </ActionBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateNetModal onClose={() => setShowCreate(false)} />}
      {propEditor && <PropertyEditorModal target={propEditor} onClose={() => setPropEditor(null)} />}
      {deleteTarget && <DeleteNetModal net={deleteTarget} onClose={() => setDeleteTarget(null)} />}
    </div>
  );
}

// ── shared primitives ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase",
                    letterSpacing: ".06em", marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

function Btn({ children, onClick, primary, danger, disabled }: {
  children: React.ReactNode; onClick: () => void;
  primary?: boolean; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "5px 12px", borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "inherit", fontSize: 12,
      background: danger ? "#7f1d1d" : primary ? "#1e3a5f" : "#1a2035",
      border: `1px solid ${danger ? "#dc2626" : primary ? "#3b82f6" : "#2d3748"}`,
      color: danger ? "#fca5a5" : primary ? "#93c5fd" : "#94a3b8",
      opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  );
}

function ActionBtn({ children, onClick, danger }: {
  children: React.ReactNode; onClick: () => void; danger?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      padding: "2px 8px", borderRadius: 3, cursor: "pointer",
      fontFamily: "inherit", fontSize: 11,
      background: "none",
      border: `1px solid ${danger ? "#7f1d1d" : "#2d3748"}`,
      color: danger ? "#f87171" : "#94a3b8",
    }}>{children}</button>
  );
}

const inputSt: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "#111827", border: "1px solid #2d3748",
  color: "#e2e8f0", fontSize: 12, padding: "5px 8px",
  borderRadius: 3, fontFamily: "inherit", outline: "none",
};
