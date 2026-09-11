import { useMemo, useState } from "react";
import { useProjectStore } from "../store/project";
import type { Bundle } from "../types";

export function BundleTree() {
  const { harness, highlightedEntities, highlightEntities, clearHighlight } = useProjectStore();
  const bundles = harness?.bundles ?? [];

  // Build parent→children map
  const childrenOf = useMemo(() => {
    const m: Record<string, Bundle[]> = { "__root__": [] };
    bundles.forEach((b) => {
      const parent = b.parent_bundle_ref ?? "__root__";
      if (!m[parent]) m[parent] = [];
      m[parent].push(b);
    });
    return m;
  }, [bundles]);

  if (!bundles.length) return <div style={{ padding: 24, color: "#475569" }}>No bundles in this harness</div>;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "8px 0" }}>
      {(childrenOf["__root__"] ?? []).map((b) => (
        <BundleRow key={b.id} bundle={b} depth={0} childrenOf={childrenOf}
          highlighted={highlightedEntities} onHighlight={highlightEntities} onClear={clearHighlight} />
      ))}
    </div>
  );
}

function BundleRow({
  bundle, depth, childrenOf, highlighted, onHighlight, onClear,
}: {
  bundle: Bundle;
  depth: number;
  childrenOf: Record<string, Bundle[]>;
  highlighted: Set<string>;
  onHighlight: (ids: string[]) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(true);
  const children = childrenOf[bundle.id] ?? [];
  const isHighlighted = highlighted.size === 0 || highlighted.has(bundle.id);

  const sheath = bundle.sheath;
  const fill = bundle.computed?.fill_pct;
  const fillColor = fill == null ? "#64748b" : fill > 80 ? "#f87171" : fill > 65 ? "#fbbf24" : "#22c55e";

  return (
    <div style={{ opacity: isHighlighted ? 1 : 0.35 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: `5px 12px 5px ${12 + depth * 20}px`,
          cursor: "pointer", borderBottom: "1px solid #1a2035",
          background: highlighted.has(bundle.id) ? "#1e3a5f22" : "transparent",
        }}
        onClick={() => highlighted.has(bundle.id) ? onClear() : onHighlight([bundle.id])}
      >
        {children.length > 0 && (
          <span onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                style={{ color: "#64748b", width: 12, cursor: "pointer", userSelect: "none" }}>
            {open ? "▼" : "▶"}
          </span>
        )}
        {children.length === 0 && <span style={{ width: 12 }} />}

        {/* Sheath icon */}
        <span style={{ fontSize: 13 }}>{sheath?.type && sheath.type !== "none" ? "🧵" : "📦"}</span>

        <span style={{ color: "#e2e8f0", fontWeight: 500, flex: 1 }}>{bundle.name}</span>

        {/* Fill % */}
        {fill != null && (
          <span style={{ fontSize: 11, color: fillColor, minWidth: 50 }}>
            fill {fill.toFixed(0)}%
          </span>
        )}

        {/* OD */}
        {bundle.computed?.bundle_od_mm != null && (
          <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 60 }}>
            Ø {bundle.computed.bundle_od_mm.toFixed(1)} mm
          </span>
        )}

        {/* Conductor count */}
        <span style={{ fontSize: 11, color: "#64748b", minWidth: 40 }}>
          {bundle.computed?.conductor_count ?? bundle.segment_refs.length} cond.
        </span>

        {/* Sheath type */}
        {sheath?.type && sheath.type !== "none" && (
          <span style={{ fontSize: 11, color: "#a78bfa", minWidth: 80 }}>
            {sheath.type.replace("_", " ")}
          </span>
        )}

        {/* Shield indicator */}
        {sheath?.shield?.shielded && (
          <span title={`Shield drain: ${sheath.shield.drain_net_ref ?? "unset"}`}
                style={{ fontSize: 11, color: sheath.shield.drain_net_ref ? "#22c55e" : "#f87171" }}>
            🛡 {sheath.shield.drain_net_ref ? "shielded" : "shield/no drain ⚠"}
          </span>
        )}

        {/* Tags */}
        <span style={{ fontSize: 11, color: "#475569" }}>
          {Object.entries(bundle.tags ?? {}).map(([k, v]) => `${k}:${v}`).join(" ")}
        </span>
      </div>

      {/* Segment list (collapsed) */}
      {open && bundle.segment_refs.length > 0 && (
        <SegmentList refs={bundle.segment_refs} depth={depth + 1} />
      )}

      {/* Recursive children */}
      {open && children.map((child) => (
        <BundleRow key={child.id} bundle={child} depth={depth + 1} childrenOf={childrenOf}
          highlighted={highlighted} onHighlight={onHighlight} onClear={onClear} />
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
        <span key={ref} style={{ display: "inline-block", marginRight: 8, marginBottom: 2,
                                  fontSize: 11, color: "#60a5fa", background: "#1e2d4a",
                                  borderRadius: 3, padding: "1px 5px" }}>
          {segIndex[ref] ?? ref}
        </span>
      ))}
    </div>
  );
}
