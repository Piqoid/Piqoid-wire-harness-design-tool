import { useState } from "react";
import { useProjectStore, resolveNetColor } from "../store/project";

export function InspectorPanel() {
  const { selectedEntity, harness, diagnostics, genericUpdate, genericDelete,
          deleteSegment, deleteNet, clearSelectedEntity } = useProjectStore();

  if (!selectedEntity || !harness) return null;

  const { type, id } = selectedEntity;

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, width: 280, height: "100%",
      background: "#111827", borderLeft: "1px solid #2d3748",
      overflow: "auto", zIndex: 5, fontFamily: "inherit",
    }}>
      <div style={{ display: "flex", alignItems: "center", padding: "8px 12px",
                    borderBottom: "1px solid #1a2035", background: "#151922" }}>
        <span style={{ fontSize: 11, color: "#64748b", flex: 1, textTransform: "uppercase",
                       letterSpacing: ".06em" }}>{type}</span>
        <button onClick={clearSelectedEntity}
                style={{ background: "none", border: "none", color: "#94a3b8",
                         cursor: "pointer", fontSize: 14, padding: "0 4px" }}>×</button>
      </div>

      {type === "segment" && <SegmentInspector id={id} />}
      {type === "net" && <NetInspector id={id} />}
      {type === "device" && <NodeInspector id={id} />}
      {type === "splice" && <SpliceInspector id={id} />}
    </div>
  );
}

// ── segment inspector ─────────────────────────────────────────────────────────

function SegmentInspector({ id }: { id: string }) {
  const { harness, diagnostics, deleteSegment } = useProjectStore();
  const seg = harness?.segments.find((s) => s.id === id);
  const net = seg?.net_ref ? harness?.nets.find((n) => n.id === seg.net_ref) : undefined;
  const diags = diagnostics.filter((d) => d.entities.includes(id));

  if (!seg) return <Empty msg="Segment not found" />;

  return (
    <div style={{ padding: 12 }}>
      <Field label="Label">{seg.label ?? <Gray>—</Gray>}</Field>
      <Field label="Net">
        {net ? (
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Dot color={resolveNetColor(net)} />
            {net.name}
          </span>
        ) : <Gray>{seg.net_ref ?? "—"}</Gray>}
      </Field>
      <Field label="From">{seg.from.kind}:{seg.from.ref}</Field>
      <Field label="To">{seg.to.kind}:{seg.to.ref}</Field>
      {seg.length_mm != null && <Field label="Length">{seg.length_mm} mm</Field>}
      <Field label="Length source"><Gray>{seg.length_source}</Gray></Field>
      {seg.conductor?.gauge?.awg != null && <Field label="Gauge">AWG {seg.conductor.gauge.awg}</Field>}
      {seg.conductor?.color && <Field label="Color">{seg.conductor.color}</Field>}
      {diags.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {diags.map((d, i) => (
            <div key={i} style={{ fontSize: 10, color: d.severity === "error" ? "#f87171" : "#fbbf24",
                                   padding: "2px 0" }}>
              ⚠ {d.rule_id}: {d.message}
            </div>
          ))}
        </div>
      )}
      <DangerBtn onClick={() => deleteSegment(id)}>Delete segment</DangerBtn>
    </div>
  );
}

// ── net inspector ─────────────────────────────────────────────────────────────

function NetInspector({ id }: { id: string }) {
  const { harness, diagnostics, updateNet, deleteNet } = useProjectStore();
  const net = harness?.nets.find((n) => n.id === id);
  const diags = diagnostics.filter((d) => d.entities.includes(id));
  const [editColor, setEditColor] = useState(false);
  const [colorVal, setColorVal] = useState(net?.display?.color ?? "");

  if (!net) return <Empty msg="Net not found" />;
  const color = resolveNetColor(net);

  return (
    <div style={{ padding: 12 }}>
      <Field label="Name"><span style={{ color: "#e2e8f0", fontWeight: 500 }}>{net.name}</span></Field>
      <Field label="Class"><span style={{ color: "#94a3b8" }}>{net.net_class}</span></Field>
      <Field label="Members"><span style={{ color: "#60a5fa" }}>{net.members.length} ports</span></Field>
      {net.bus_ref && <Field label="Bus"><span style={{ color: "#a78bfa" }}>{net.bus_ref}</span></Field>}

      {/* Colour editor */}
      <div style={{ marginTop: 8 }}>
        <span style={{ fontSize: 10, color: "#64748b" }}>COLOUR</span>
        {editColor ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <input type="color" value={colorVal || "#60a5fa"}
                   onChange={(e) => setColorVal(e.target.value)}
                   style={{ width: 36, height: 22, cursor: "pointer", background: "none", border: "none" }} />
            <input value={colorVal} onChange={(e) => setColorVal(e.target.value)}
                   style={{ flex: 1, background: "#1a2035", border: "1px solid #2d3748",
                            color: "#e2e8f0", fontSize: 11, padding: "2px 6px", borderRadius: 3 }} />
            <button onClick={async () => {
              await updateNet(id, { display: { ...net.display, color: colorVal || undefined } });
              setEditColor(false);
            }} style={{ ...miniBtn, color: "#22c55e" }}>✓</button>
            <button onClick={() => setEditColor(false)} style={{ ...miniBtn, color: "#f87171" }}>✕</button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <Dot color={color} size={14} />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{net.display?.color ?? "auto"}</span>
            <button onClick={() => { setColorVal(color); setEditColor(true); }}
                    style={{ ...miniBtn, marginLeft: "auto" }}>edit</button>
          </div>
        )}
      </div>

      {diags.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {diags.map((d, i) => (
            <div key={i} style={{ fontSize: 10, color: d.severity === "error" ? "#f87171" : "#fbbf24",
                                   padding: "2px 0" }}>
              ⚠ {d.rule_id}: {d.message}
            </div>
          ))}
        </div>
      )}
      <DangerBtn onClick={() => deleteNet(id)}>Delete net</DangerBtn>
    </div>
  );
}

// ── node inspector ────────────────────────────────────────────────────────────

function NodeInspector({ id }: { id: string }) {
  const { harness, layout, diagnostics, updateNodeStyle } = useProjectStore();
  const node  = harness?.nodes.find((n) => n.id === id);
  const ports = harness?.node_ports.filter((p) => p.node_ref === id) ?? [];
  const diags = diagnostics.filter((d) => d.entities.includes(id));
  const layoutEntry = layout?.nodes[id];
  const [bgColor, setBgColor] = useState(layoutEntry?.bgColor ?? "#1e2d4a");

  if (!node) return <Empty msg="Node not found" />;

  return (
    <div style={{ padding: 12 }}>
      <Field label="Name"><span style={{ color: "#e2e8f0", fontWeight: 500 }}>{node.name}</span></Field>
      {node.designator && <Field label="Designator"><span style={{ color: "#60a5fa" }}>{node.designator}</span></Field>}
      {node.part_ref && <Field label="Part ref"><Gray>{node.part_ref}</Gray></Field>}

      {/* Background colour */}
      <div style={{ marginTop: 8 }}>
        <span style={{ fontSize: 10, color: "#64748b" }}>NODE COLOUR</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <input type="color" value={bgColor}
                 onChange={(e) => setBgColor(e.target.value)}
                 style={{ width: 36, height: 22, cursor: "pointer", background: "none", border: "none" }} />
          <span style={{ fontSize: 11, color: "#94a3b8", flex: 1 }}>{bgColor}</span>
          <button
            onClick={() => updateNodeStyle(id, { bgColor })}
            style={{ ...miniBtn, color: "#22c55e" }}>apply</button>
          <button
            onClick={() => { setBgColor("#1e2d4a"); updateNodeStyle(id, { bgColor: undefined }); }}
            style={{ ...miniBtn, color: "#94a3b8" }}>reset</button>
        </div>
      </div>

      {layoutEntry?.width && (
        <Field label="Width"><Gray>{Math.round(layoutEntry.width)} px — drag corner to resize</Gray></Field>
      )}

      <div style={{ marginTop: 8 }}>
        <span style={{ fontSize: 10, color: "#64748b" }}>PORTS ({ports.length})</span>
        <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
          {ports.map((p) => (
            <span key={p.id} style={{ fontSize: 10, background: "#1a2d4a", color: "#94a3b8",
                                       borderRadius: 3, padding: "2px 6px" }}>{p.pin_name}</span>
          ))}
        </div>
      </div>
      {diags.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {diags.map((d, i) => (
            <div key={i} style={{ fontSize: 10, color: "#fbbf24", padding: "2px 0" }}>
              ⚠ {d.rule_id}: {d.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── splice inspector ──────────────────────────────────────────────────────────

function SpliceInspector({ id }: { id: string }) {
  const { harness, deleteSplice } = useProjectStore();
  const sp = harness?.splices.find((s) => s.id === id);
  const segs = harness?.segments.filter(
    (s) => (s.from.kind === "splice" && s.from.ref === id) || (s.to.kind === "splice" && s.to.ref === id)
  ) ?? [];

  if (!sp) return <Empty msg="Splice not found" />;

  return (
    <div style={{ padding: 12 }}>
      <Field label="Name">{sp.name ?? <Gray>—</Gray>}</Field>
      {sp.net_ref && <Field label="Net"><span style={{ color: "#60a5fa" }}>{sp.net_ref}</span></Field>}
      <Field label="Connections"><span style={{ color: "#94a3b8" }}>{segs.length} segments</span></Field>
      <DangerBtn onClick={() => deleteSplice(id)}>Delete splice</DangerBtn>
    </div>
  );
}

// ── shared micro-components ───────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 9, color: "#475569", letterSpacing: ".06em",
                    textTransform: "uppercase", marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#e2e8f0" }}>{children}</div>
    </div>
  );
}

function Gray({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "#475569" }}>{children}</span>;
}

function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span style={{ display: "inline-block", width: size, height: size,
                   borderRadius: "50%", background: color, flexShrink: 0 }} />
  );
}

function DangerBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      marginTop: 12, width: "100%", padding: "5px 0",
      background: "#2d1515", border: "1px solid #7f1d1d",
      color: "#f87171", borderRadius: 4, cursor: "pointer",
      fontSize: 11, fontFamily: "inherit",
    }}>{children}</button>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 12, color: "#475569", fontSize: 12 }}>{msg}</div>;
}

const miniBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 12, padding: "0 4px", fontFamily: "inherit",
};
