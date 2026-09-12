/**
 * Full property editor popup for all entity types.
 * Opens on right-click → "Edit Properties…"
 */
import { useState, useCallback, useRef } from "react";
import { useProjectStore, type PortSide } from "../store/project";
import type { HarnessData, Net, Segment, Node, NodePort, Splice } from "../types";

// ── shared primitives ─────────────────────────────────────────────────────────

function Modal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#151c2b", border: "1px solid #2d3748", borderRadius: 8,
        padding: "0", minWidth: 380, maxWidth: 540, maxHeight: "90vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 12px 40px rgba(0,0,0,.7)", fontFamily: "inherit",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px",
                      borderBottom: "1px solid #1e2740", background: "#0f1623",
                      borderRadius: "8px 8px 0 0", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, flex: 1 }}>{title}</span>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: "#64748b",
                     cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
        <div style={{ overflow: "auto", padding: "14px 16px", flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

const fieldRow: React.CSSProperties = { marginBottom: 8 };
const labelStyle: React.CSSProperties = {
  fontSize: 9, color: "#475569", textTransform: "uppercase",
  letterSpacing: ".06em", marginBottom: 2, display: "block",
};
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "#111827", border: "1px solid #2d3748",
  color: "#e2e8f0", fontSize: 11, padding: "4px 7px",
  borderRadius: 3, fontFamily: "inherit", outline: "none",
};
const selectStyle: React.CSSProperties = { ...inputStyle };
const sectionHead: React.CSSProperties = {
  fontSize: 9, color: "#4b5563", textTransform: "uppercase",
  letterSpacing: ".06em", marginTop: 12, marginBottom: 4,
  borderTop: "1px solid #1e2740", paddingTop: 8,
};
const readonlyStyle: React.CSSProperties = {
  ...inputStyle, color: "#475569", background: "#0f1623", cursor: "not-allowed",
};

function FRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={fieldRow}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

function FText({ label, value, onChange, placeholder, readonly }: {
  label: string; value: string; onChange?: (v: string) => void;
  placeholder?: string; readonly?: boolean;
}) {
  return (
    <FRow label={label}>
      <input
        value={value ?? ""}
        readOnly={readonly}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        style={readonly ? readonlyStyle : inputStyle}
      />
    </FRow>
  );
}

function FNum({ label, value, onChange, placeholder }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <FRow label={label}>
      <input
        type="number"
        value={value ?? ""}
        placeholder={placeholder ?? "—"}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        style={inputStyle}
      />
    </FRow>
  );
}

function FSelect({ label, value, onChange, options, allowEmpty }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; allowEmpty?: boolean;
}) {
  return (
    <FRow label={label}>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {allowEmpty && <option value="">— none —</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FRow>
  );
}

function FColor({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <FRow label={label}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="color" value={value || "#60a5fa"} onChange={(e) => onChange(e.target.value)}
               style={{ width: 36, height: 24, cursor: "pointer", background: "none", border: "none" }} />
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)}
               style={{ ...inputStyle, flex: 1 }} />
      </div>
    </FRow>
  );
}

function FCheckbox({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ ...fieldRow, display: "flex", alignItems: "center", gap: 8 }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)}
             style={{ cursor: "pointer" }} />
      <span style={{ fontSize: 11, color: "#94a3b8" }}>{label}</span>
    </div>
  );
}

function TagsEditor({ tags, onChange }: {
  tags: Record<string, string>; onChange: (t: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const entries = Object.entries(tags);
  return (
    <div>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <input value={k} readOnly style={{ ...readonlyStyle, flex: "0 0 38%" }} />
          <input value={v} onChange={(e) => onChange({ ...tags, [k]: e.target.value })}
                 style={{ ...inputStyle, flex: 1 }} />
          <button onClick={() => { const t = { ...tags }; delete t[k]; onChange(t); }}
            style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="key"
               style={{ ...inputStyle, flex: "0 0 38%" }} />
        <input value={newVal} onChange={(e) => setNewVal(e.target.value)} placeholder="value"
               style={{ ...inputStyle, flex: 1 }} />
        <button
          onClick={() => {
            if (!newKey.trim()) return;
            onChange({ ...tags, [newKey.trim()]: newVal });
            setNewKey(""); setNewVal("");
          }}
          style={{ background: "none", border: "1px solid #3b82f6", color: "#60a5fa",
                   cursor: "pointer", borderRadius: 3, padding: "0 8px", fontSize: 12 }}
        >+</button>
      </div>
    </div>
  );
}

function SaveBar({ onSave, onClose }: { onSave: () => void; onClose: () => void }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14,
                  borderTop: "1px solid #1e2740", paddingTop: 12 }}>
      <button onClick={onClose} style={{
        padding: "5px 14px", background: "#1a2035", border: "1px solid #2d3748",
        color: "#94a3b8", borderRadius: 4, cursor: "pointer", fontSize: 12, fontFamily: "inherit",
      }}>Cancel</button>
      <button onClick={onSave} style={{
        padding: "5px 14px", background: "#1e3a5f", border: "1px solid #3b82f6",
        color: "#93c5fd", borderRadius: 4, cursor: "pointer", fontSize: 12, fontFamily: "inherit",
      }}>Save</button>
    </div>
  );
}

// ── segment editor ────────────────────────────────────────────────────────────

function SegmentEditor({ id, harness, onClose }: { id: string; harness: HarnessData; onClose: () => void }) {
  const { genericUpdate } = useProjectStore();
  const orig = harness.segments.find((s) => s.id === id);
  if (!orig) return <div style={{ color: "#f87171" }}>Segment not found</div>;

  const netOpts = [{ value: "", label: "— none —" },
    ...harness.nets.map((n) => ({ value: n.id, label: n.name }))];
  const lengthSrcOpts = ["manual", "measured", "routed", "estimated"].map((v) => ({ value: v, label: v }));
  const allBundles = harness.bundles ?? [];

  // Bundle membership is authoritative on bundle.segment_refs
  const initBundleIds = allBundles.filter((b) => b.segment_refs.includes(id)).map((b) => b.id);

  const [netRef, setNetRef] = useState(orig.net_ref ?? "");
  const [label, setLabel] = useState(orig.label ?? "");
  const [lengthMm, setLengthMm] = useState<number | undefined>(orig.length_mm);
  const [lengthSrc, setLengthSrc] = useState(orig.length_source ?? "manual");
  const [cableRef, setCableRef] = useState(orig.cable_ref ?? "");
  const [cableCore, setCableCore] = useState<number | undefined>(orig.cable_core);
  const [bundleIds, setBundleIds] = useState<string[]>(initBundleIds);

  // Conductor
  const [awg, setAwg]       = useState<number | undefined>(orig.conductor?.gauge?.awg);
  const [mm2, setMm2]       = useState<number | undefined>(orig.conductor?.gauge?.mm2);
  const [cMat, setCMat]     = useState(orig.conductor?.material ?? "");
  const [cConst, setCConst] = useState(orig.conductor?.construction ?? "");
  const [cColor, setCColor] = useState(orig.conductor?.color ?? "");
  const [cStripe, setCStripe] = useState(orig.conductor?.stripe ?? "");
  const [iMat, setIMat]     = useState(orig.conductor?.insulation?.material ?? "");
  const [iRatV, setIRatV]   = useState<number | undefined>(orig.conductor?.insulation?.rating_v);
  const [iTempC, setITempC] = useState<number | undefined>(orig.conductor?.insulation?.temp_rating_c);

  const [tags, setTags] = useState(orig.tags ?? {});

  const toggleBundle = (bid: string) =>
    setBundleIds((prev) => prev.includes(bid) ? prev.filter((x) => x !== bid) : [...prev, bid]);

  const doSave = useCallback(async () => {
    const body: Record<string, unknown> = {
      net_ref: netRef || undefined,
      label: label || undefined,
      length_mm: lengthMm,
      length_source: lengthSrc,
      cable_ref: cableRef || undefined,
      cable_core: cableCore,
      bundle_refs: bundleIds.length ? bundleIds : undefined,
      conductor: {
        gauge: awg != null || mm2 != null ? { awg, mm2 } : undefined,
        material: cMat || undefined,
        construction: cConst || undefined,
        color: cColor || undefined,
        stripe: cStripe || undefined,
        insulation: (iMat || iRatV != null || iTempC != null)
          ? { material: iMat || undefined, rating_v: iRatV, temp_rating_c: iTempC }
          : undefined,
      },
      tags,
    };
    // Sync bundle.segment_refs for bundles added or removed
    const toAdd    = bundleIds.filter((bid) => !initBundleIds.includes(bid));
    const toRemove = initBundleIds.filter((bid) => !bundleIds.includes(bid));
    await Promise.all([
      genericUpdate("segments", id, body),
      ...toAdd.map((bid) => {
        const b = allBundles.find((bx) => bx.id === bid);
        if (!b) return Promise.resolve();
        return genericUpdate("bundles", bid, { segment_refs: [...b.segment_refs, id] });
      }),
      ...toRemove.map((bid) => {
        const b = allBundles.find((bx) => bx.id === bid);
        if (!b) return Promise.resolve();
        return genericUpdate("bundles", bid, { segment_refs: b.segment_refs.filter((r) => r !== id) });
      }),
    ]);
    onClose();
  }, [netRef, label, lengthMm, lengthSrc, cableRef, cableCore, bundleIds, awg, mm2,
      cMat, cConst, cColor, cStripe, iMat, iRatV, iTempC, tags, genericUpdate, id,
      initBundleIds, allBundles, onClose]);

  return (
    <>
      <FText label="ID" value={orig.id} readonly />
      <FRow label="From → To">
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          {orig.from.kind}:{orig.from.ref} → {orig.to.kind}:{orig.to.ref}
        </span>
      </FRow>
      <FSelect label="Net" value={netRef} onChange={setNetRef} options={netOpts} allowEmpty />
      <FText label="Label" value={label} onChange={setLabel} placeholder="optional label" />
      <FNum label="Length (mm)" value={lengthMm} onChange={setLengthMm} />
      <FSelect label="Length source" value={lengthSrc} onChange={(v) => setLengthSrc(v as typeof lengthSrc)} options={lengthSrcOpts} />
      <FText label="Cable ref" value={cableRef} onChange={setCableRef} />
      <FNum label="Cable core" value={cableCore} onChange={setCableCore} />

      <div style={sectionHead}>BUNDLES ({bundleIds.length} assigned)</div>
      {allBundles.length === 0 ? (
        <div style={{ fontSize: 11, color: "#475569", marginBottom: 6 }}>No bundles in this harness</div>
      ) : (
        <div style={{
          maxHeight: 100, overflowY: "auto", border: "1px solid #2d3748",
          borderRadius: 3, background: "#0f1623", marginBottom: 8,
        }}>
          {allBundles.map((b) => (
            <label key={b.id} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "3px 8px",
              cursor: "pointer", background: bundleIds.includes(b.id) ? "#1e3a5f22" : "transparent",
            }}>
              <input type="checkbox" checked={bundleIds.includes(b.id)} onChange={() => toggleBundle(b.id)}
                     style={{ cursor: "pointer", accentColor: "#3b82f6" }} />
              <span style={{ fontSize: 11, color: bundleIds.includes(b.id) ? "#60a5fa" : "#94a3b8" }}>
                {b.name}
              </span>
            </label>
          ))}
        </div>
      )}

      <div style={sectionHead}>CONDUCTOR</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
        <FNum label="Gauge AWG" value={awg} onChange={setAwg} />
        <FNum label="Gauge mm²" value={mm2} onChange={setMm2} />
      </div>
      <FText label="Material" value={cMat} onChange={setCMat} placeholder="copper" />
      <FText label="Construction" value={cConst} onChange={setCConst} placeholder="solid / stranded" />
      <FColor label="Insulation colour" value={cColor} onChange={setCColor} />
      <FText label="Stripe colour" value={cStripe} onChange={setCStripe} />

      <div style={sectionHead}>INSULATION</div>
      <FText label="Material" value={iMat} onChange={setIMat} placeholder="pvc / xlpe / ptfe" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
        <FNum label="Voltage rating (V)" value={iRatV} onChange={setIRatV} />
        <FNum label="Temp rating (°C)" value={iTempC} onChange={setITempC} />
      </div>

      <div style={sectionHead}>TAGS</div>
      <TagsEditor tags={tags} onChange={setTags} />
      <SaveBar onSave={doSave} onClose={onClose} />
    </>
  );
}

// ── port drag row ─────────────────────────────────────────────────────────────

const SIDE_COLORS: Record<string, string> = {
  right: "#3b82f6", bottom: "#f59e0b", left: "#22c55e", top: "#a855f7",
};
const PORT_SIDE_ORDER: PortSide[] = ["right", "bottom", "left", "top"];

function PortDragRow({
  port, side, netOpts, genericUpdate,
  isDragOver, isConfirmDelete,
  onDragStart, onDragOver, onDrop, onDragEnd, onDeleteClick,
}: {
  port: NodePort; side: PortSide;
  netOpts: { value: string; label: string }[];
  genericUpdate: (et: string, id: string, body: Record<string, unknown>) => Promise<void>;
  isDragOver: boolean; isConfirmDelete: boolean;
  onDragStart: () => void; onDragOver: () => void;
  onDrop: () => void; onDragEnd: () => void;
  onDeleteClick: () => void;
}) {
  const [netRef, setNetRef] = useState(port.net_ref ?? "");

  const saveNet = async (val: string) => {
    await genericUpdate("node_ports", port.id, { net_ref: val || undefined });
    setNetRef(val);
  };

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(); }}
      onDragEnd={() => onDragEnd()}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "3px 4px",
        borderTop: isDragOver ? "2px solid #3b82f6" : "2px solid transparent",
        background: isDragOver ? "#1e3a5f33" : "transparent",
        cursor: "default",
      }}
    >
      <span style={{ cursor: "grab", color: "#374151", fontSize: 14,
                     userSelect: "none", lineHeight: 1, flexShrink: 0 }}>⠿</span>
      <span style={{
        background: SIDE_COLORS[side], borderRadius: 2, padding: "0 3px",
        fontSize: 8, color: "#fff", fontWeight: 700, textTransform: "uppercase",
        flexShrink: 0, minWidth: 12, textAlign: "center",
      }}>{side[0]}</span>
      <span style={{ fontSize: 10, color: "#e2e8f0", minWidth: 46, flexShrink: 0 }}>
        {port.pin_name}
      </span>
      <select
        value={netRef}
        onChange={(e) => saveNet(e.target.value)}
        style={{
          flex: 1, minWidth: 0,
          background: "#111827", border: "1px solid #2d3748",
          color: netRef ? "#60a5fa" : "#475569",
          fontSize: 10, padding: "1px 4px", borderRadius: 3, fontFamily: "inherit",
        }}
      >
        <option value="">— net —</option>
        {netOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button
        onClick={(e) => { e.stopPropagation(); onDeleteClick(); }}
        title={isConfirmDelete ? "Click again to confirm delete (and cascade-delete wires)" : "Delete port"}
        style={{
          background: "none", border: isConfirmDelete ? "1px solid #ef4444" : "none",
          borderRadius: 3, flexShrink: 0, padding: "0 4px",
          cursor: "pointer", fontSize: isConfirmDelete ? 9 : 13,
          color: isConfirmDelete ? "#ef4444" : "#475569",
          fontWeight: isConfirmDelete ? 700 : 400,
        }}
      >{isConfirmDelete ? "del?" : "×"}</button>
    </div>
  );
}

// ── node editor ───────────────────────────────────────────────────────────────

function NodeEditor({ id, harness, onClose }: { id: string; harness: HarnessData; onClose: () => void }) {
  const { genericUpdate, layout, setPortSide, setPortOrder, deletePort } = useProjectStore();
  const orig = harness.nodes.find((n) => n.id === id);
  if (!orig) return <div style={{ color: "#f87171" }}>Node not found</div>;

  const [name, setName]       = useState(orig.name);
  const [des, setDes]         = useState(orig.designator ?? "");
  const [partRef, setPartRef] = useState(orig.part_ref ?? "");
  const [tags, setTags]       = useState(orig.tags ?? {});
  const [confirmDeletePortId, setConfirmDeletePortId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const dragPortIdRef = useRef<string | null>(null);

  const doSave = useCallback(async () => {
    await genericUpdate("nodes", id, {
      name, designator: des || undefined, part_ref: partRef || undefined, tags,
    });
    onClose();
  }, [name, des, partRef, tags, genericUpdate, id, onClose]);

  const ports = harness.node_ports.filter((p) => p.node_ref === id);
  const netOpts = harness.nets.map((n) => ({ value: n.id, label: n.name }));

  const portSides = layout?.portSides ?? {};
  const portOrderForNode = layout?.portOrder?.[id] ?? [];

  // Sort ports by persisted order
  const sortedPorts = [...ports].sort((a, b) => {
    const ai = portOrderForNode.indexOf(a.id);
    const bi = portOrderForNode.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const portsByGroup: Record<PortSide, NodePort[]> = {
    right: [], bottom: [], left: [], top: [],
  };
  sortedPorts.forEach((p) => {
    const side = (portSides[p.id] as PortSide) ?? "right";
    portsByGroup[side].push(p);
  });

  // Flat ordered list across all sides (clockwise: right→bottom→left→top)
  const flatOrdered = PORT_SIDE_ORDER.flatMap((s) => portsByGroup[s]);

  const handleDrop = (targetPortId: string | null, targetSide: PortSide) => {
    const dragId = dragPortIdRef.current;
    if (!dragId || dragId === targetPortId) {
      dragPortIdRef.current = null;
      setDragOverTarget(null);
      return;
    }

    const currentFlat = flatOrdered.map((p) => p.id);
    const withoutDrag = currentFlat.filter((pid) => pid !== dragId);

    let newFlat: string[];
    if (targetPortId !== null) {
      // Insert before the target port
      const idx = withoutDrag.indexOf(targetPortId);
      const at = idx === -1 ? withoutDrag.length : idx;
      newFlat = [...withoutDrag.slice(0, at), dragId, ...withoutDrag.slice(at)];
    } else {
      // Insert at end of target side's group
      const sideIds = portsByGroup[targetSide].map((p) => p.id).filter((pid) => pid !== dragId);
      if (sideIds.length > 0) {
        const last = sideIds[sideIds.length - 1];
        const idx = withoutDrag.indexOf(last);
        newFlat = [...withoutDrag.slice(0, idx + 1), dragId, ...withoutDrag.slice(idx + 1)];
      } else {
        // Empty side — find where it belongs in the cross-side order
        const sideIdx = PORT_SIDE_ORDER.indexOf(targetSide);
        let insertAt = withoutDrag.length;
        for (const s of PORT_SIDE_ORDER.slice(sideIdx + 1)) {
          const firstOfNext = portsByGroup[s].find((p) => p.id !== dragId);
          if (firstOfNext) {
            const idx = withoutDrag.indexOf(firstOfNext.id);
            if (idx !== -1) { insertAt = idx; break; }
          }
        }
        newFlat = [...withoutDrag.slice(0, insertAt), dragId, ...withoutDrag.slice(insertAt)];
      }
    }

    setPortOrder(id, newFlat);
    const currentSide = (portSides[dragId] as PortSide) ?? "right";
    if (currentSide !== targetSide) setPortSide(dragId, targetSide);

    dragPortIdRef.current = null;
    setDragOverTarget(null);
  };

  const handleDeleteClick = useCallback(async (portId: string) => {
    if (confirmDeletePortId !== portId) {
      setConfirmDeletePortId(portId);
      return;
    }
    setConfirmDeletePortId(null);
    await deletePort(portId);
  }, [confirmDeletePortId, deletePort]);

  return (
    <>
      <FText label="ID" value={orig.id} readonly />
      <FText label="Name" value={name} onChange={setName} />
      <FText label="Designator" value={des} onChange={setDes} placeholder="U1, J2, R5…" />
      <FText label="Part ref" value={partRef} onChange={setPartRef} placeholder="library part ID" />

      {ports.length > 0 && (
        <>
          <div style={sectionHead}>
            PORTS ({ports.length}) — drag to reorder or change side
          </div>
          {PORT_SIDE_ORDER.map((side) => (
            <div key={side}>
              {/* Section header is also a drop target */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOverTarget(`side-${side}`); }}
                onDragLeave={() => setDragOverTarget((t) => t === `side-${side}` ? null : t)}
                onDrop={(e) => { e.preventDefault(); handleDrop(null, side); }}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  fontSize: 9, color: "#4b5563", textTransform: "uppercase",
                  letterSpacing: ".06em", marginTop: 6, paddingTop: 4,
                  borderTop: "1px solid #1e2740", paddingBottom: 2, paddingLeft: 2,
                  background: dragOverTarget === `side-${side}` ? "#1e3a5f55" : "transparent",
                  borderRadius: 3, cursor: "default",
                  transition: "background .1s",
                }}
              >
                <span style={{
                  display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                  background: SIDE_COLORS[side], flexShrink: 0,
                }} />
                {side.toUpperCase()} ({portsByGroup[side].length})
                {dragOverTarget === `side-${side}` && (
                  <span style={{ color: "#60a5fa", marginLeft: 4 }}>drop here →</span>
                )}
              </div>

              {portsByGroup[side].map((p) => (
                <PortDragRow
                  key={p.id}
                  port={p} side={side}
                  netOpts={netOpts}
                  genericUpdate={genericUpdate}
                  isDragOver={dragOverTarget === `port-${p.id}`}
                  isConfirmDelete={confirmDeletePortId === p.id}
                  onDragStart={() => { dragPortIdRef.current = p.id; }}
                  onDragOver={() => setDragOverTarget(`port-${p.id}`)}
                  onDrop={() => handleDrop(p.id, side)}
                  onDragEnd={() => { dragPortIdRef.current = null; setDragOverTarget(null); }}
                  onDeleteClick={() => handleDeleteClick(p.id)}
                />
              ))}

              {portsByGroup[side].length === 0 && (
                <div style={{ fontSize: 10, color: "#374151", padding: "2px 4px" }}>
                  (empty — drop here)
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <div style={sectionHead}>INTERFACES</div>
      {orig.interfaces.map((iface) => (
        <div key={iface.id} style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>
          {iface.name} <span style={{ color: "#475569" }}>({iface.id})</span>
        </div>
      ))}

      <div style={sectionHead}>TAGS</div>
      <TagsEditor tags={tags} onChange={setTags} />
      <SaveBar onSave={doSave} onClose={onClose} />
    </>
  );
}

// ── port editor ───────────────────────────────────────────────────────────────

function PortEditor({ id, harness, onClose }: { id: string; harness: HarnessData; onClose: () => void }) {
  const { genericUpdate, profiles } = useProjectStore();
  const orig = harness.node_ports.find((p) => p.id === id);
  if (!orig) return <div style={{ color: "#f87171" }}>Port not found</div>;

  const profileOpts = Object.values(profiles).map((p) => ({ value: p.id, label: p.id }));
  const netOpts = [{ value: "", label: "— none —" },
    ...harness.nets.map((n) => ({ value: n.id, label: n.name }))];

  const [pinName, setPinName]   = useState(orig.pin_name);
  const [profRef, setProfRef]   = useState(orig.profile_ref ?? "");
  const [netRef, setNetRef]     = useState(orig.net_ref ?? "");
  const [tags, setTags]         = useState(orig.tags ?? {});

  const doSave = useCallback(async () => {
    await genericUpdate("node_ports", id, {
      pin_name: pinName,
      profile_ref: profRef,
      net_ref: netRef || undefined,
      tags,
    });
    onClose();
  }, [pinName, profRef, netRef, tags, genericUpdate, id, onClose]);

  return (
    <>
      <FText label="ID" value={orig.id} readonly />
      <FText label="Node ref" value={orig.node_ref} readonly />
      <FText label="Interface ref" value={orig.interface_ref} readonly />
      <FText label="Pin name" value={pinName} onChange={setPinName} />
      {profileOpts.length > 0
        ? <FSelect label="Signal profile" value={profRef} onChange={setProfRef} options={profileOpts} allowEmpty />
        : <FText label="Profile ref" value={profRef} onChange={setProfRef} />}
      <FSelect label="Net" value={netRef} onChange={setNetRef} options={netOpts} allowEmpty />
      <div style={sectionHead}>TAGS</div>
      <TagsEditor tags={tags} onChange={setTags} />
      <SaveBar onSave={doSave} onClose={onClose} />
    </>
  );
}

// ── net editor ────────────────────────────────────────────────────────────────

function NetEditor({ id, harness, onClose }: { id: string; harness: HarnessData; onClose: () => void }) {
  const { updateNet } = useProjectStore();
  const orig = harness.nets.find((n) => n.id === id);
  if (!orig) return <div style={{ color: "#f87171" }}>Net not found</div>;

  const netClassOpts = ["power","signal","ground","shield","no_connect"].map((v) => ({ value: v, label: v }));

  const [name, setName]         = useState(orig.name);
  const [netClass, setNetClass] = useState(orig.net_class);
  const [busRef, setBusRef]     = useState(orig.bus_ref ?? "");
  const [busDom, setBusDom]     = useState(orig.bus_domain ?? "");
  const [pairRef, setPairRef]   = useState(orig.pair_ref ?? "");
  const [dispColor, setDispColor] = useState(orig.display?.color ?? "");
  const [dispW, setDispW]       = useState<number | undefined>(orig.display?.width_px);
  const [labelVis, setLabelVis] = useState(orig.display?.label_visible ?? false);
  const [maxVDrop, setMaxVDrop] = useState<number | undefined>(orig.constraints?.max_voltage_drop_v);
  const [expCurr, setExpCurr]   = useState<number | undefined>(orig.constraints?.expected_current_a);
  const [maxStub, setMaxStub]   = useState<number | undefined>(orig.constraints?.max_stub_length_mm);
  const [tags, setTags]         = useState(orig.tags ?? {});

  const doSave = useCallback(async () => {
    await updateNet(id, {
      name, net_class: netClass,
      bus_ref: busRef || undefined,
      bus_domain: busDom || undefined,
      pair_ref: pairRef || undefined,
      display: {
        color: dispColor || undefined,
        width_px: dispW,
        label_visible: labelVis || undefined,
      },
      constraints: (maxVDrop != null || expCurr != null || maxStub != null) ? {
        max_voltage_drop_v: maxVDrop,
        expected_current_a: expCurr,
        max_stub_length_mm: maxStub,
      } : undefined,
      tags,
    });
    onClose();
  }, [name, netClass, busRef, busDom, pairRef, dispColor, dispW, labelVis,
      maxVDrop, expCurr, maxStub, tags, updateNet, id, onClose]);

  return (
    <>
      <FText label="ID" value={orig.id} readonly />
      <FText label="Name" value={name} onChange={setName} />
      <FSelect label="Net class" value={netClass} onChange={setNetClass as (v: string) => void} options={netClassOpts} />
      <FText label="Bus ref" value={busRef} onChange={setBusRef} />
      <FText label="Bus domain" value={busDom} onChange={setBusDom} />
      <FText label="Pair ref" value={pairRef} onChange={setPairRef} />
      <div style={sectionHead}>DISPLAY</div>
      <FColor label="Colour" value={dispColor} onChange={setDispColor} />
      <FNum label="Width (px)" value={dispW} onChange={setDispW} />
      <FCheckbox label="Show label on wire" value={labelVis} onChange={setLabelVis} />
      <div style={sectionHead}>CONSTRAINTS</div>
      <FNum label="Max voltage drop (V)" value={maxVDrop} onChange={setMaxVDrop} />
      <FNum label="Expected current (A)" value={expCurr} onChange={setExpCurr} />
      <FNum label="Max stub length (mm)" value={maxStub} onChange={setMaxStub} />
      <div style={sectionHead}>TAGS</div>
      <TagsEditor tags={tags} onChange={setTags} />
      <SaveBar onSave={doSave} onClose={onClose} />
    </>
  );
}

// ── splice editor ─────────────────────────────────────────────────────────────

function SpliceEditor({ id, harness, onClose }: { id: string; harness: HarnessData; onClose: () => void }) {
  const { genericUpdate } = useProjectStore();
  const orig = harness.splices.find((s) => s.id === id);
  if (!orig) return <div style={{ color: "#f87171" }}>Splice not found</div>;

  const netOpts = [{ value: "", label: "— none —" },
    ...harness.nets.map((n) => ({ value: n.id, label: n.name }))];

  const [name, setName]   = useState(orig.name ?? "");
  const [netRef, setNetRef] = useState(orig.net_ref ?? "");
  const [tags, setTags]   = useState(orig.tags ?? {});

  const doSave = useCallback(async () => {
    await genericUpdate("splices", id, {
      name: name || undefined,
      net_ref: netRef || undefined,
      tags,
    });
    onClose();
  }, [name, netRef, tags, genericUpdate, id, onClose]);

  return (
    <>
      <FText label="ID" value={orig.id} readonly />
      <FText label="Name" value={name} onChange={setName} placeholder="SP1" />
      <FSelect label="Net" value={netRef} onChange={setNetRef} options={netOpts} allowEmpty />
      <div style={sectionHead}>TAGS</div>
      <TagsEditor tags={tags} onChange={setTags} />
      <SaveBar onSave={doSave} onClose={onClose} />
    </>
  );
}

// ── exported root component ───────────────────────────────────────────────────

export type PropEditorTarget = {
  entityType: "segments" | "nodes" | "node_ports" | "nets" | "splices";
  entityId: string;
};

const TITLES: Record<string, string> = {
  segments: "Edit Wire (Segment)",
  nodes: "Edit Node",
  node_ports: "Edit Port",
  nets: "Edit Net",
  splices: "Edit Splice",
};

export function PropertyEditorModal({
  target, onClose,
}: { target: PropEditorTarget; onClose: () => void }) {
  const { harness } = useProjectStore();
  if (!harness) return null;

  const title = TITLES[target.entityType] ?? "Edit";

  return (
    <Modal title={title} onClose={onClose}>
      {target.entityType === "segments" && (
        <SegmentEditor id={target.entityId} harness={harness} onClose={onClose} />
      )}
      {target.entityType === "nodes" && (
        <NodeEditor id={target.entityId} harness={harness} onClose={onClose} />
      )}
      {target.entityType === "node_ports" && (
        <PortEditor id={target.entityId} harness={harness} onClose={onClose} />
      )}
      {target.entityType === "nets" && (
        <NetEditor id={target.entityId} harness={harness} onClose={onClose} />
      )}
      {target.entityType === "splices" && (
        <SpliceEditor id={target.entityId} harness={harness} onClose={onClose} />
      )}
    </Modal>
  );
}
