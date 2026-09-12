import { useCallback, useMemo, useState } from "react";
import { useProjectStore } from "../store/project";
import type { Bundle, BundleSheath } from "../types";

// ── shared primitives ─────────────────────────────────────────────────────────

const inputSt: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "#111827", border: "1px solid #2d3748",
  color: "#e2e8f0", fontSize: 12, padding: "5px 8px",
  borderRadius: 3, fontFamily: "inherit", outline: "none",
};
const labelSt: React.CSSProperties = {
  fontSize: 9, color: "#475569", textTransform: "uppercase",
  letterSpacing: ".06em", marginBottom: 2, display: "block",
};
const sectionSt: React.CSSProperties = {
  fontSize: 9, color: "#4b5563", textTransform: "uppercase",
  letterSpacing: ".06em", marginTop: 12, marginBottom: 4,
  borderTop: "1px solid #1e2740", paddingTop: 8,
};

function FField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 8 }}><span style={labelSt}>{label}</span>{children}</div>;
}
function FText({ label, value, onChange, placeholder, readonly }: {
  label: string; value: string; onChange?: (v: string) => void; placeholder?: string; readonly?: boolean;
}) {
  return (
    <FField label={label}>
      <input value={value ?? ""} readOnly={readonly} placeholder={placeholder}
             onChange={(e) => onChange?.(e.target.value)}
             style={readonly ? { ...inputSt, color: "#475569", background: "#0f1623", cursor: "not-allowed" } : inputSt} />
    </FField>
  );
}
function FNum({ label, value, onChange }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void;
}) {
  return (
    <FField label={label}>
      <input type="number" value={value ?? ""} placeholder="—"
             onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
             style={inputSt} />
    </FField>
  );
}
function FSelect({ label, value, onChange, options, allowEmpty }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; allowEmpty?: boolean;
}) {
  return (
    <FField label={label}>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={inputSt}>
        {allowEmpty && <option value="">— none —</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FField>
  );
}
function FCheck({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)}
             style={{ cursor: "pointer", accentColor: "#3b82f6" }} />
      <span style={{ fontSize: 12, color: "#94a3b8" }}>{label}</span>
    </div>
  );
}

function MultiPicker({ label, allItems, selected, onChange }: {
  label: string;
  allItems: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <FField label={`${label} (${selected.length})`}>
      <div style={{
        maxHeight: 120, overflowY: "auto", border: "1px solid #2d3748",
        borderRadius: 3, background: "#0f1623",
      }}>
        {allItems.length === 0 && (
          <div style={{ padding: "6px 8px", fontSize: 11, color: "#475569" }}>None available</div>
        )}
        {allItems.map((item) => (
          <label key={item.id} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "3px 8px", cursor: "pointer",
            background: selected.includes(item.id) ? "#1e3a5f22" : "transparent",
          }}>
            <input type="checkbox" checked={selected.includes(item.id)}
                   onChange={() => toggle(item.id)}
                   style={{ cursor: "pointer", accentColor: "#3b82f6" }} />
            <span style={{ fontSize: 11, color: selected.includes(item.id) ? "#60a5fa" : "#94a3b8" }}>
              {item.label}
            </span>
          </label>
        ))}
      </div>
    </FField>
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
      padding: "2px 7px", borderRadius: 3, cursor: "pointer",
      fontFamily: "inherit", fontSize: 11, background: "none",
      border: `1px solid ${danger ? "#7f1d1d" : "#2d3748"}`,
      color: danger ? "#f87171" : "#94a3b8",
    }}>{children}</button>
  );
}

// ── bundle editor modal ───────────────────────────────────────────────────────

const SHEATH_TYPES = ["none", "conduit", "corrugated_conduit", "split_loom", "braided_sleeve",
                      "heat_shrink", "tape_wrap", "cable_duct"];

function BundleEditorModal({
  initial, bundles, onClose,
}: {
  initial: Partial<Bundle> | null; // null = create mode
  bundles: Bundle[];
  onClose: () => void;
}) {
  const { harness, genericCreate, genericUpdate } = useProjectStore();
  const isCreate = initial == null || !("id" in (initial ?? {}));

  const [name, setName]         = useState(initial?.name ?? "");
  const [parentRef, setParentRef] = useState(initial?.parent_bundle_ref ?? "");
  const [segRefs, setSegRefs]   = useState<string[]>(initial?.segment_refs ?? []);
  const [cableRefs, setCableRefs] = useState<string[]>(initial?.cable_refs ?? []);
  const [pathLen, setPathLen]   = useState<number | undefined>(initial?.path_length_mm);

  // Sheath
  const initSheath = initial?.sheath ?? {};
  const [sheathType, setSheathType]   = useState(initSheath.type ?? "none");
  const [nominalId, setNominalId]     = useState<number | undefined>(initSheath.nominal_id_mm);
  const [maxFill, setMaxFill]         = useState<number | undefined>(initSheath.max_fill_pct);
  const [shielded, setShielded]       = useState(initSheath.shield?.shielded ?? false);
  const [drainNet, setDrainNet]       = useState(initSheath.shield?.drain_net_ref ?? "");

  // Tags
  const [tags, setTags] = useState<Record<string, string>>(initial?.tags ?? {});
  const [tagKey, setTagKey]   = useState("");
  const [tagVal, setTagVal]   = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const allSegs = (harness?.segments ?? []).map((s) => ({ id: s.id, label: s.label ?? s.id }));
  const allCables = (harness?.cables ?? []).map((c) => ({ id: c.id, label: c.designator ?? c.id }));
  const parentOpts = bundles
    .filter((b) => !isCreate || b.id !== (initial as Bundle | null)?.id)
    .map((b) => ({ value: b.id, label: b.name }));
  const netOpts = (harness?.nets ?? []).map((n) => ({ value: n.id, label: n.name }));

  const buildBody = () => {
    const sheath: BundleSheath = sheathType && sheathType !== "none" ? {
      type: sheathType,
      nominal_id_mm: nominalId,
      max_fill_pct: maxFill,
      shield: shielded ? { shielded: true, drain_net_ref: drainNet || undefined } : undefined,
    } : {};
    return {
      type: "bundle",
      name: name.trim(),
      parent_bundle_ref: parentRef || undefined,
      segment_refs: segRefs,
      cable_refs: cableRefs,
      path_length_mm: pathLen,
      sheath: Object.keys(sheath).length ? sheath : undefined,
      tags,
    };
  };

  const doSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true); setErr(null);
    try {
      const body = buildBody();
      if (isCreate) {
        await genericCreate("bundles", body);
      } else {
        await genericUpdate("bundles", (initial as Bundle).id, body);
      }
      onClose();
    } catch (e) {
      setErr(String(e));
      setSaving(false);
    }
  }, [name, parentRef, segRefs, cableRefs, pathLen, sheathType, nominalId, maxFill,
      shielded, drainNet, tags, isCreate, initial, genericCreate, genericUpdate, onClose]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#151c2b", border: "1px solid #2d3748", borderRadius: 8,
        minWidth: 420, maxWidth: 560, maxHeight: "90vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 12px 40px rgba(0,0,0,.7)", fontFamily: "inherit",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px",
                      borderBottom: "1px solid #1e2740", background: "#0f1623",
                      borderRadius: "8px 8px 0 0", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, flex: 1 }}>
            {isCreate ? "Create Bundle" : `Edit Bundle "${initial?.name}"`}
          </span>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflow: "auto", padding: "14px 16px", flex: 1 }}>
          {!isCreate && <FText label="ID" value={(initial as Bundle).id} readonly />}
          <FText label="Name" value={name} onChange={setName} placeholder="Main trunk, Branch A…" />
          <FSelect label="Parent bundle" value={parentRef} onChange={setParentRef}
                   options={parentOpts} allowEmpty />
          <FNum label="Path length (mm)" value={pathLen} onChange={setPathLen} />

          <div style={sectionSt}>SEGMENTS</div>
          <MultiPicker label="Segments" allItems={allSegs} selected={segRefs} onChange={setSegRefs} />

          <div style={sectionSt}>CABLES</div>
          <MultiPicker label="Cables" allItems={allCables} selected={cableRefs} onChange={setCableRefs} />

          <div style={sectionSt}>SHEATH</div>
          <FSelect label="Sheath type" value={sheathType} onChange={setSheathType}
                   options={SHEATH_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} />
          {sheathType !== "none" && <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
              <FNum label="Nominal ID (mm)" value={nominalId} onChange={setNominalId} />
              <FNum label="Max fill (%)" value={maxFill} onChange={setMaxFill} />
            </div>
            <FCheck label="Shielded" value={shielded} onChange={setShielded} />
            {shielded && (
              <FSelect label="Drain net ref" value={drainNet} onChange={setDrainNet}
                       options={netOpts} allowEmpty />
            )}
          </>}

          <div style={sectionSt}>TAGS</div>
          <div style={{ marginBottom: 8 }}>
            {Object.entries(tags).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#94a3b8", flex: 1 }}>{k}: {v}</span>
                <button onClick={() => setTags((t) => { const n = { ...t }; delete n[k]; return n; })}
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 12 }}>×</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <input value={tagKey} onChange={(e) => setTagKey(e.target.value)} placeholder="key"
                     style={{ ...inputSt, flex: 1 }} />
              <input value={tagVal} onChange={(e) => setTagVal(e.target.value)} placeholder="value"
                     style={{ ...inputSt, flex: 1 }} />
              <button onClick={() => {
                if (!tagKey.trim()) return;
                setTags((t) => ({ ...t, [tagKey.trim()]: tagVal }));
                setTagKey(""); setTagVal("");
              }} style={{ padding: "3px 8px", background: "#1e3a5f", border: "1px solid #3b82f6",
                          color: "#93c5fd", borderRadius: 3, cursor: "pointer", fontSize: 11 }}>+</button>
            </div>
          </div>

          {err && <div style={{ color: "#f87171", fontSize: 11, marginBottom: 8 }}>{err}</div>}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end",
                      padding: "10px 16px", borderTop: "1px solid #1e2740", flexShrink: 0 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={doSave} disabled={!name.trim() || saving}>
            {saving ? "Saving…" : isCreate ? "Create" : "Save"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── delete confirm ────────────────────────────────────────────────────────────

function DeleteBundleModal({ bundle, onClose }: { bundle: Bundle; onClose: () => void }) {
  const { genericDelete } = useProjectStore();
  const [saving, setSaving] = useState(false);

  const doDelete = useCallback(async () => {
    setSaving(true);
    try { await genericDelete("bundles", bundle.id); onClose(); }
    catch { setSaving(false); }
  }, [genericDelete, bundle.id, onClose]);

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
          Delete bundle "{bundle.name}"?
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
          Segments and cables inside will not be deleted — only the bundle record.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn danger onClick={doDelete} disabled={saving}>{saving ? "Deleting…" : "Delete"}</Btn>
        </div>
      </div>
    </div>
  );
}

// ── tree row ──────────────────────────────────────────────────────────────────

function BundleRow({
  bundle, depth, childrenOf, highlighted, onHighlight, onClear, onEdit, onDelete,
}: {
  bundle: Bundle;
  depth: number;
  childrenOf: Record<string, Bundle[]>;
  highlighted: Set<string>;
  onHighlight: (ids: string[]) => void;
  onClear: () => void;
  onEdit: (b: Bundle) => void;
  onDelete: (b: Bundle) => void;
}) {
  const [open, setOpen] = useState(true);
  const children = childrenOf[bundle.id] ?? [];
  const isHighlighted = highlighted.size === 0 || highlighted.has(bundle.id);

  const sheath = bundle.sheath;
  const fill = bundle.computed?.fill_pct;
  const fillColor = fill == null ? "#64748b" : fill > 80 ? "#f87171" : fill > 65 ? "#fbbf24" : "#22c55e";

  return (
    <div style={{ opacity: isHighlighted ? 1 : 0.35 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: `5px 8px 5px ${12 + depth * 20}px`,
        cursor: "pointer", borderBottom: "1px solid #1a2035",
        background: highlighted.has(bundle.id) ? "#1e3a5f22" : "transparent",
      }}
        onClick={() => highlighted.has(bundle.id) ? onClear() : onHighlight([bundle.id])}
      >
        {children.length > 0 ? (
          <span onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                style={{ color: "#64748b", width: 12, cursor: "pointer", userSelect: "none", flexShrink: 0 }}>
            {open ? "▼" : "▶"}
          </span>
        ) : <span style={{ width: 12, flexShrink: 0 }} />}

        <span style={{ fontSize: 13, flexShrink: 0 }}>
          {sheath?.type && sheath.type !== "none" ? "🧵" : "📦"}
        </span>
        <span style={{ color: "#e2e8f0", fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {bundle.name}
        </span>

        {fill != null && (
          <span style={{ fontSize: 11, color: fillColor, flexShrink: 0, minWidth: 52 }}>
            fill {fill.toFixed(0)}%
          </span>
        )}
        {bundle.computed?.bundle_od_mm != null && (
          <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0, minWidth: 60 }}>
            Ø {bundle.computed.bundle_od_mm.toFixed(1)} mm
          </span>
        )}
        <span style={{ fontSize: 11, color: "#64748b", flexShrink: 0, minWidth: 44 }}>
          {bundle.computed?.conductor_count ?? bundle.segment_refs.length} cond.
        </span>
        {sheath?.shield?.shielded && (
          <span style={{ fontSize: 11, color: sheath.shield.drain_net_ref ? "#22c55e" : "#f87171", flexShrink: 0 }}>
            🛡
          </span>
        )}

        {/* Action buttons — stop propagation so click doesn't toggle highlight */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}
             onClick={(e) => e.stopPropagation()}>
          <ActionBtn onClick={() => onEdit(bundle)}>Edit</ActionBtn>
          <ActionBtn danger onClick={() => onDelete(bundle)}>Del</ActionBtn>
        </div>
      </div>

      {open && bundle.segment_refs.length > 0 && (
        <SegmentList refs={bundle.segment_refs} depth={depth + 1} />
      )}
      {open && children.map((child) => (
        <BundleRow key={child.id} bundle={child} depth={depth + 1} childrenOf={childrenOf}
          highlighted={highlighted} onHighlight={onHighlight} onClear={onClear}
          onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}

function SegmentList({ refs, depth }: { refs: string[]; depth: number }) {
  const { harness } = useProjectStore();
  const segIndex = useMemo(() => {
    const m: Record<string, string> = {};
    (harness?.segments ?? []).forEach((s) => { m[s.id] = s.label ?? s.id; });
    return m;
  }, [harness]);

  return (
    <div style={{ padding: `2px 12px 2px ${12 + depth * 20}px`, borderBottom: "1px solid #1a2035" }}>
      {refs.map((ref) => (
        <span key={ref} style={{
          display: "inline-block", marginRight: 6, marginBottom: 2,
          fontSize: 11, color: "#60a5fa", background: "#1e2d4a",
          borderRadius: 3, padding: "1px 5px",
        }}>
          {segIndex[ref] ?? ref}
        </span>
      ))}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function BundleTree() {
  const { harness, highlightedEntities, highlightEntities, clearHighlight } = useProjectStore();
  const bundles = harness?.bundles ?? [];

  const [editorTarget, setEditorTarget] = useState<Bundle | null | "create">(null);
  const [deleteTarget, setDeleteTarget] = useState<Bundle | null>(null);

  const childrenOf = useMemo(() => {
    const m: Record<string, Bundle[]> = { "__root__": [] };
    bundles.forEach((b) => {
      const parent = b.parent_bundle_ref ?? "__root__";
      if (!m[parent]) m[parent] = [];
      m[parent].push(b);
    });
    return m;
  }, [bundles]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", borderBottom: "1px solid #2d3748",
        background: "#1a2035", flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: "#94a3b8", flex: 1 }}>
          {bundles.length} bundle{bundles.length !== 1 ? "s" : ""}
        </span>
        <Btn primary onClick={() => setEditorTarget("create")}>+ Create Bundle</Btn>
      </div>

      {bundles.length === 0 ? (
        <div style={{ padding: 24, color: "#475569", fontSize: 12 }}>
          No bundles yet — click "+ Create Bundle" to add one.
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
          {(childrenOf["__root__"] ?? []).map((b) => (
            <BundleRow
              key={b.id} bundle={b} depth={0} childrenOf={childrenOf}
              highlighted={highlightedEntities}
              onHighlight={highlightEntities} onClear={clearHighlight}
              onEdit={(bundle) => setEditorTarget(bundle)}
              onDelete={(bundle) => setDeleteTarget(bundle)}
            />
          ))}
        </div>
      )}

      {editorTarget !== null && (
        <BundleEditorModal
          initial={editorTarget === "create" ? null : editorTarget}
          bundles={bundles}
          onClose={() => setEditorTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteBundleModal bundle={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
