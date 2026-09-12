/**
 * Full property editor popup for all entity types.
 * Opens on right-click → "Edit Properties…"
 */
import { useState, useCallback } from "react";
import { useProjectStore } from "../store/project";
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

// ── node editor ───────────────────────────────────────────────────────────────

function PortNetRow({ port, netOpts, genericUpdate }: {
  port: NodePort;
  netOpts: { value: string; label: string }[];
  genericUpdate: (et: string, id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [netRef, setNetRef] = useState(port.net_ref ?? "");
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (val: string) => {
    setSaving(true);
    try {
      await genericUpdate("node_ports", port.id, { net_ref: val || undefined });
      setNetRef(val);
    } finally {
      setSaving(false);
    }
  }, [port.id, genericUpdate]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: "#e2e8f0", minWidth: 60, flexShrink: 0 }}>{port.pin_name}</span>
      <span style={{ fontSize: 9, color: "#475569", flexShrink: 0 }}>({port.id.slice(-6)})</span>
      <select
        value={netRef}
        onChange={(e) => save(e.target.value)}
        disabled={saving}
        style={{
          flex: 1, background: "#111827", border: "1px solid #2d3748",
          color: netRef ? "#60a5fa" : "#475569", fontSize: 11,
          padding: "2px 5px", borderRadius: 3, fontFamily: "inherit",
          opacity: saving ? 0.6 : 1,
        }}
      >
        <option value="">— unassigned —</option>
        {netOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function NodeEditor({ id, harness, onClose }: { id: string; harness: HarnessData; onClose: () => void }) {
  const { genericUpdate } = useProjectStore();
  const orig = harness.nodes.find((n) => n.id === id);
  if (!orig) return <div style={{ color: "#f87171" }}>Node not found</div>;

  const [name, setName]       = useState(orig.name);
  const [des, setDes]         = useState(orig.designator ?? "");
  const [partRef, setPartRef] = useState(orig.part_ref ?? "");
  const [tags, setTags]       = useState(orig.tags ?? {});

  const doSave = useCallback(async () => {
    await genericUpdate("nodes", id, {
      name, designator: des || undefined, part_ref: partRef || undefined, tags,
    });
    onClose();
  }, [name, des, partRef, tags, genericUpdate, id, onClose]);

  const ports = harness.node_ports.filter((p) => p.node_ref === id);
  const netOpts = harness.nets.map((n) => ({ value: n.id, label: n.name }));

  return (
    <>
      <FText label="ID" value={orig.id} readonly />
      <FText label="Name" value={name} onChange={setName} />
      <FText label="Designator" value={des} onChange={setDes} placeholder="U1, J2, R5…" />
      <FText label="Part ref" value={partRef} onChange={setPartRef} placeholder="library part ID" />
      <div style={sectionHead}>INTERFACES</div>
      {orig.interfaces.map((iface) => (
        <div key={iface.id} style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>
          {iface.name} <span style={{ color: "#475569" }}>({iface.id})</span>
        </div>
      ))}
      {ports.length > 0 && (
        <>
          <div style={sectionHead}>PORTS — NET ASSIGNMENT ({ports.length})</div>
          <div style={{ fontSize: 9, color: "#475569", marginBottom: 6 }}>
            Changes save immediately. Wire validation checks net match.
          </div>
          {ports.map((p) => (
            <PortNetRow key={p.id} port={p} netOpts={netOpts} genericUpdate={genericUpdate} />
          ))}
        </>
      )}
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
