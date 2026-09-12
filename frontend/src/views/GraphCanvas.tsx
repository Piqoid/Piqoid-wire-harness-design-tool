import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeResizer,
  type NodeProps,
  type EdgeProps,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node as FlowNode,
  type Edge as FlowEdge,
  SelectionMode,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useProjectStore, resolveNetColor, getConstrainedCursorPos, type PortSide, type WiringState } from "../store/project";
import type { HarnessData, LayoutData, Net } from "../types";
import { PropertyEditorModal, type PropEditorTarget } from "./PropertyEditor";

// ── node-avoidance orthogonal path ────────────────────────────────────────────

interface BBox { x: number; y: number; w: number; h: number; id: string }

const AVOID_PAD = 14;

function segmentIntersectsBox(
  x1: number, y1: number, x2: number, y2: number,
  box: BBox,
): boolean {
  const lx = box.x - AVOID_PAD, rx = box.x + box.w + AVOID_PAD;
  const ty = box.y - AVOID_PAD, bot = box.y + box.h + AVOID_PAD;

  if (Math.abs(y1 - y2) < 0.5) {
    // Horizontal
    const mnX = Math.min(x1, x2) + 1, mxX = Math.max(x1, x2) - 1;
    return mnX < rx && mxX > lx && y1 > ty && y1 < bot;
  }
  if (Math.abs(x1 - x2) < 0.5) {
    // Vertical
    const mnY = Math.min(y1, y2) + 1, mxY = Math.max(y1, y2) - 1;
    return mnY < bot && mxY > ty && x1 > lx && x1 < rx;
  }
  return false;
}

/**
 * Given a segment A→B and a list of obstacle boxes, compute detour points
 * that route around the first intersecting box.
 */
function detourAround(
  ax: number, ay: number, bx: number, by: number,
  boxes: BBox[],
): { x: number; y: number }[] | null {
  for (const box of boxes) {
    if (!segmentIntersectsBox(ax, ay, bx, by, box)) continue;
    const lx = box.x - AVOID_PAD, rx = box.x + box.w + AVOID_PAD;
    const ty = box.y - AVOID_PAD, bot = box.y + box.h + AVOID_PAD;

    if (Math.abs(ay - by) < 0.5) {
      // Horizontal segment: route above or below
      const goAbove = ay < box.y + box.h / 2;
      const detY = goAbove ? ty : bot;
      const entX = bx > ax ? lx : rx;
      const exitX = bx > ax ? rx : lx;
      return [
        { x: entX, y: ay },
        { x: entX, y: detY },
        { x: exitX, y: detY },
        { x: exitX, y: ay },
      ];
    }
    if (Math.abs(ax - bx) < 0.5) {
      // Vertical segment: route left or right
      const goLeft = ax < box.x + box.w / 2;
      const detX = goLeft ? lx : rx;
      const entY = by > ay ? ty : bot;
      const exitY = by > ay ? bot : ty;
      return [
        { x: ax, y: entY },
        { x: detX, y: entY },
        { x: detX, y: exitY },
        { x: ax, y: exitY },
      ];
    }
  }
  return null;
}

/**
 * Expand a list of points into a node-avoiding list, then build SVG path.
 * Excludes boxes whose id is in `excludeIds` (source/target nodes).
 */
function orthogonalPathAvoid(
  sx: number, sy: number,
  tx: number, ty: number,
  waypoints: { x: number; y: number }[] = [],
  allBoxes: BBox[] = [],
  excludeIds: string[] = [],
): string {
  const boxes = allBoxes.filter((b) => !excludeIds.includes(b.id));

  // Build initial point list
  const raw = [{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }];

  // Expand raw segments into orthogonal chains + avoidance detours
  const expanded: { x: number; y: number }[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = expanded[expanded.length - 1];
    const curr = raw[i];
    const isLast = i === raw.length - 1;

    let chain: { x: number; y: number }[] = [];

    if (!isLast) {
      // Waypoint: go H then V (or just V if same x)
      if (Math.abs(curr.x - prev.x) > 0.5) {
        chain = [{ x: curr.x, y: prev.y }, { x: curr.x, y: curr.y }];
      } else {
        chain = [{ x: curr.x, y: curr.y }];
      }
    } else {
      // Final target: midpoint L-route
      if (Math.abs(curr.y - prev.y) > 0.5 && Math.abs(curr.x - prev.x) > 0.5) {
        const midX = prev.x + (curr.x - prev.x) * 0.5;
        chain = [
          { x: midX, y: prev.y },
          { x: midX, y: curr.y },
          { x: curr.x, y: curr.y },
        ];
      } else {
        chain = [{ x: curr.x, y: curr.y }];
      }
    }

    // Check each sub-segment in chain for node intersections (one pass)
    let from = prev;
    for (const to of chain) {
      const detour = detourAround(from.x, from.y, to.x, to.y, boxes);
      if (detour) {
        expanded.push(...detour);
      }
      expanded.push(to);
      from = to;
    }
  }

  // Convert to SVG path
  const segs = [`M ${expanded[0].x} ${expanded[0].y}`];
  for (let i = 1; i < expanded.length; i++) {
    segs.push(`L ${expanded[i].x} ${expanded[i].y}`);
  }
  return segs.join(" ");
}

// ── data shapes ───────────────────────────────────────────────────────────────

interface DeviceData extends Record<string, unknown> {
  label: string;
  designator?: string;
  nodeId: string;
  bgColor?: string;
  ports: { id: string; name: string; side: PortSide; netColor?: string }[];
}

interface SpliceData extends Record<string, unknown> {
  label: string;
  netColor: string;
  segIds: string[];
  width: number;
  height: number;
}

interface CursorData extends Record<string, unknown> { _cursor: true }

interface SegEdgeData extends Record<string, unknown> {
  color: string;
  width: number;
  label?: string;
  netId?: string;
  waypoints: { x: number; y: number }[];
  dimmed: boolean;
  isGhost?: boolean;
  nodeBBoxes?: BBox[];
  excludeNodeIds?: string[];
}

// ── modal primitives ──────────────────────────────────────────────────────────

function Modal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#1e2433", border: "1px solid #2d3748", borderRadius: 8,
        padding: 20, minWidth: 320, fontFamily: "inherit",
        boxShadow: "0 8px 32px rgba(0,0,0,.6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, flex: 1 }}>{title}</span>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase",
                    letterSpacing: ".06em", marginBottom: 3 }}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
             style={{ width: "100%", boxSizing: "border-box", background: "#111827",
                      border: "1px solid #2d3748", color: "#e2e8f0", fontSize: 12,
                      padding: "5px 8px", borderRadius: 4, fontFamily: "inherit", outline: "none" }} />
    </div>
  );
}

function MSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase",
                    letterSpacing: ".06em", marginBottom: 3 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)}
              style={{ width: "100%", background: "#111827", border: "1px solid #2d3748",
                       color: "#e2e8f0", fontSize: 12, padding: "5px 8px",
                       borderRadius: 4, fontFamily: "inherit" }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function MBtn({ children, onClick, danger, disabled }: {
  children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "6px 14px", borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "inherit", fontSize: 12,
      background: danger ? "#7f1d1d" : "#1e3a5f",
      border: `1px solid ${danger ? "#dc2626" : "#3b82f6"}`,
      color: danger ? "#fca5a5" : "#93c5fd",
      opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  );
}

// ── context menu ──────────────────────────────────────────────────────────────

type CtxMenu =
  | { kind: "pane";  x: number; y: number; flowX: number; flowY: number }
  | { kind: "node";  x: number; y: number; nodeId: string; nodeType?: string }
  | { kind: "edge";  x: number; y: number; edgeId: string }
  | { kind: "port";  x: number; y: number; portId: string; nodeId: string }
  | null;

function ContextMenu({ menu, onClose, items }: {
  menu: NonNullable<CtxMenu>;
  onClose: () => void;
  items: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  return (
    <div style={{
      position: "absolute", left: menu.x, top: menu.y, zIndex: 150,
      background: "#1e2433", border: "1px solid #3b82f6", borderRadius: 6,
      boxShadow: "0 4px 16px rgba(0,0,0,.5)", minWidth: 190, fontFamily: "inherit",
    }} onMouseLeave={onClose}>
      {items.map((item) => (
        <button key={item.label}
          onClick={() => { item.onClick(); onClose(); }}
          style={{ display: "block", width: "100%", padding: "7px 12px",
                   background: "none", border: "none",
                   color: item.danger ? "#f87171" : "#e2e8f0",
                   textAlign: "left", cursor: "pointer", fontSize: 12 }}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── custom node: device ───────────────────────────────────────────────────────

function DeviceNode({ data, selected, id }: NodeProps<FlowNode<DeviceData>>) {
  const { wiring, startWiring, completeWiring, setWiringHover, clearWiringHover,
          updateNodeStyle } = useProjectStore();
  const { getInternalNode } = useReactFlow();

  const leftPorts   = data.ports.filter((p) => p.side === "left");
  const rightPorts  = data.ports.filter((p) => p.side === "right");
  const topPorts    = data.ports.filter((p) => p.side === "top");
  const bottomPorts = data.ports.filter((p) => p.side === "bottom");
  const rowCount    = Math.max(leftPorts.length, rightPorts.length, 1);
  const contentH    = rowCount * 22 + 8;

  const getHandlePos = useCallback(
    (portId: string): { x: number; y: number } | null => {
      const node = getInternalNode(id);
      if (!node?.internals) return null;
      const handleId = `${portId}-s`;
      const all = [
        ...(node.internals.handleBounds?.source ?? []),
        ...(node.internals.handleBounds?.target ?? []),
      ];
      const h = all.find((hh) => hh.id === handleId);
      const posAbs = node.internals.positionAbsolute;
      if (!h || !posAbs) return null;
      return { x: posAbs.x + h.x + h.width / 2, y: posAbs.y + h.y + h.height / 2 };
    },
    [id, getInternalNode],
  );

  const handlePortClick = useCallback(
    (portId: string, portSide: PortSide, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!wiring.active) {
        startWiring(portId, data.nodeId, portSide, getHandlePos(portId));
      } else if (wiring.sourcePortId !== portId) {
        if (wiring.hover?.severity === "error") return;
        completeWiring(portId, data.nodeId, portSide, getHandlePos(portId));
      } else {
        useProjectStore.getState().cancelWiring();
      }
    },
    [wiring, data.nodeId, startWiring, completeWiring, getHandlePos],
  );

  const isWiringSource = wiring.sourceNodeId === data.nodeId;
  const bg = data.bgColor ?? "#1e2d4a";

  const portRow = (p: typeof data.ports[0], side: PortSide) => {
    const hoverInfo = wiring.active && wiring.hover?.portId === p.id ? wiring.hover : null;
    const hoverColor = hoverInfo?.severity === "error" ? "#f87171"
      : hoverInfo?.severity === "warn" ? "#fbbf24"
      : wiring.active ? "#22c55e" : undefined;
    const pos = side === "left" ? Position.Left : side === "right" ? Position.Right
      : side === "top" ? Position.Top : Position.Bottom;
    const isH = side === "left" || side === "right";

    return (
      <div key={p.id}
        style={{
          display: "flex", alignItems: "center",
          height: isH ? 22 : 18,
          paddingLeft: side === "left" ? 10 : side === "right" ? 0 : 4,
          paddingRight: side === "right" ? 10 : 0,
          justifyContent: side === "right" ? "flex-end" : "flex-start",
          position: "relative",
          cursor: wiring.active ? "crosshair" : "default",
        }}
        title={hoverInfo?.message ?? p.name}
        onClick={(e) => handlePortClick(p.id, side, e)}
        onMouseEnter={() => wiring.active && wiring.sourcePortId && setWiringHover(p.id, wiring.sourcePortId)}
        onMouseLeave={() => clearWiringHover()}
      >
        <Handle id={`${p.id}-t`} type="target" position={pos} isConnectable={false}
          style={{ ...(side === "left" ? { left: 0 } : side === "right" ? { right: 0 } : {}),
                   top: "50%", transform: "translateY(-50%)",
                   width: 8, height: 8,
                   background: hoverColor ?? p.netColor ?? "#3b82f6",
                   border: "1px solid #1e3a6a" }} />
        <Handle id={`${p.id}-s`} type="source" position={pos} isConnectable={false}
          style={{ ...(side === "left" ? { left: 0 } : side === "right" ? { right: 0 } : {}),
                   top: "50%", transform: "translateY(-50%)",
                   width: 8, height: 8, opacity: 0 }} />
        <span style={{ fontSize: 9, color: "#94a3b8",
                       paddingLeft: side === "left" ? 4 : 0,
                       paddingRight: side === "right" ? 4 : 0 }}>
          {p.name}
        </span>
      </div>
    );
  };

  return (
    <div style={{
      background: selected ? "#1e3a6a" : bg,
      border: `1px solid ${selected ? "#60a5fa" : isWiringSource ? "#f59e0b" : "#3b82f6"}`,
      borderRadius: 6, minWidth: 140, fontFamily: "inherit", width: "100%",
      boxShadow: selected ? "0 0 0 2px #3b82f688" : undefined,
    }}>
      <NodeResizer minWidth={120} minHeight={60} isVisible={selected && !wiring.active}
                   onResizeEnd={(_, params) => updateNodeStyle(id, { width: params.width })} />

      {/* Top ports */}
      {topPorts.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-evenly",
                      padding: "2px 8px", borderBottom: "1px solid #2d3748" }}>
          {topPorts.map((p) => portRow(p, "top"))}
        </div>
      )}

      {/* Title */}
      <div style={{ padding: "4px 8px", borderBottom: "1px solid #2d3748",
                    background: "#162032", borderRadius: topPorts.length === 0 ? "5px 5px 0 0" : undefined }}>
        <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{data.label}</div>
        {data.designator && <div style={{ fontSize: 10, color: "#60a5fa" }}>{data.designator}</div>}
      </div>

      {/* Left / Right ports */}
      <div style={{ display: "flex", justifyContent: "space-between",
                    minHeight: contentH, padding: "4px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {leftPorts.map((p) => portRow(p, "left"))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {rightPorts.map((p) => portRow(p, "right"))}
        </div>
      </div>

      {/* Bottom ports */}
      {bottomPorts.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-evenly",
                      padding: "2px 8px", borderTop: "1px solid #2d3748" }}>
          {bottomPorts.map((p) => portRow(p, "bottom"))}
        </div>
      )}
    </div>
  );
}

// ── custom node: splice ───────────────────────────────────────────────────────

const SPLICE_SIDES: PortSide[] = ["left", "right", "top", "bottom"];

function SpliceNode({ data, selected, id }: NodeProps<FlowNode<SpliceData>>) {
  const { wiring, startWiringFromSplice, completeWiringToSplice, updateSpliceDims } = useProjectStore();
  const { getInternalNode } = useReactFlow();

  const w = data.width;
  const h = data.height;

  const getHandlePos = useCallback((side: PortSide): { x: number; y: number } | null => {
    const node = getInternalNode(id);
    if (!node?.internals?.positionAbsolute) return null;
    const { x, y } = node.internals.positionAbsolute;
    switch (side) {
      case "left":   return { x,         y: y + h / 2 };
      case "right":  return { x: x + w,  y: y + h / 2 };
      case "top":    return { x: x + w / 2, y };
      case "bottom": return { x: x + w / 2, y: y + h };
    }
  }, [id, getInternalNode, w, h]);

  const handleSideClick = useCallback((side: PortSide, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!wiring.active) {
      startWiringFromSplice(id, side, getHandlePos(side));
    } else if (!(wiring.sourceNodeId === id && wiring.portSide === side)) {
      completeWiringToSplice(id, side, getHandlePos(side));
    } else {
      useProjectStore.getState().cancelWiring();
    }
  }, [wiring, id, getHandlePos, startWiringFromSplice, completeWiringToSplice]);

  const isWiringSource = wiring.active && wiring.sourceNodeId === id;
  const isWiringTarget = wiring.active && wiring.sourceNodeId !== id;

  const sideHPos = (side: PortSide): Position =>
    side === "left" ? Position.Left : side === "right" ? Position.Right
    : side === "top" ? Position.Top : Position.Bottom;

  const sideHandleStyle = (side: PortSide): React.CSSProperties => ({
    position: "absolute",
    ...(side === "left"   ? { left: -6,  top: "50%",  transform: "translateY(-50%)" }
      : side === "right"  ? { right: -6, top: "50%",  transform: "translateY(-50%)" }
      : side === "top"    ? { top: -6,   left: "50%", transform: "translateX(-50%)" }
      :                     { bottom: -6, left: "50%", transform: "translateX(-50%)" }),
    width: 12, height: 12,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: wiring.active ? "crosshair" : "pointer",
    zIndex: 5,
  });

  const dotColor = isWiringTarget ? "#22c55e" : isWiringSource ? "#f59e0b" : "#60a5fa";

  const borderColor = selected ? "#60a5fa"
    : isWiringSource ? "#f59e0b"
    : isWiringTarget ? "#22c55e"
    : "#64748b";

  return (
    <div
      style={{
        width: w, height: h, position: "relative",
        background: data.netColor + "33",
        border: `2px solid ${borderColor}`,
        borderRadius: 3,
        boxShadow: selected ? "0 0 0 2px #3b82f688" : isWiringTarget ? "0 0 0 3px #22c55e44" : undefined,
      }}
      title={data.label}
    >
      <NodeResizer
        minWidth={16} minHeight={16}
        isVisible={selected && !wiring.active}
        onResizeEnd={(_, params) => updateSpliceDims(id, params.width, params.height)}
      />

      {/* Label */}
      {data.label && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 9, color: "#e2e8f0",
          overflow: "hidden", padding: 2, pointerEvents: "none", userSelect: "none",
        }}>
          {data.label}
        </div>
      )}

      {/* 4 side handles — visible dots + real handles */}
      {SPLICE_SIDES.map((side) => (
        <div key={side} style={sideHandleStyle(side)} onClick={(e) => handleSideClick(side, e)}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: dotColor, border: "1px solid #1e2740" }} />
          <Handle id={`${id}-${side}-s`} type="source" position={sideHPos(side)} isConnectable={false}
                  style={{ width: 0, height: 0, border: "none", background: "transparent",
                           position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }} />
          <Handle id={`${id}-${side}-t`} type="target" position={sideHPos(side)} isConnectable={false}
                  style={{ width: 0, height: 0, border: "none", background: "transparent",
                           position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }} />
        </div>
      ))}
    </div>
  );
}

// ── custom node: invisible cursor anchor ──────────────────────────────────────

function CursorNode(_: NodeProps<FlowNode<CursorData>>) {
  return (
    <div style={{ width: 1, height: 1, background: "transparent", pointerEvents: "none" }}>
      <Handle id="t" type="target" position={Position.Left} isConnectable={false}
              style={{ width: 0, height: 0, border: "none", background: "transparent" }} />
    </div>
  );
}

// ── custom edge: orthogonal segment ──────────────────────────────────────────

function SegmentEdge({
  id, sourceX, sourceY, targetX, targetY, data, selected,
}: EdgeProps<FlowEdge<SegEdgeData>>) {
  const color   = data?.color ?? "#60a5fa";
  const width   = data?.width ?? 2;
  const dimmed  = data?.dimmed ?? false;
  const isGhost = data?.isGhost ?? false;
  const waypts  = data?.waypoints ?? [];
  const boxes   = data?.nodeBBoxes ?? [];
  const excl    = data?.excludeNodeIds ?? [];

  const d = orthogonalPathAvoid(sourceX, sourceY, targetX, targetY, waypts, boxes, excl);

  return (
    <g style={{ opacity: dimmed ? 0.12 : 1, transition: "opacity .12s",
                pointerEvents: isGhost ? "none" : "all" }}>
      <path d={d} stroke="transparent" strokeWidth={12} fill="none"
            style={{ cursor: isGhost ? "default" : "pointer" }} />
      <path id={id} d={d}
            stroke={color} strokeWidth={selected ? width + 1.5 : width}
            fill="none" strokeLinecap="square"
            strokeDasharray={isGhost ? "6 4" : undefined}
            opacity={isGhost ? 0.65 : 1} />
      {selected && (
        <path d={d} stroke={color} strokeWidth={width + 6} fill="none"
              strokeLinecap="square" opacity={0.15} />
      )}
      {data?.label && !isGhost && (
        <text style={{ fontSize: 9, fill: "#94a3b8", fontFamily: "inherit", userSelect: "none" }}>
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">{data.label}</textPath>
        </text>
      )}
    </g>
  );
}

// ── registries ────────────────────────────────────────────────────────────────

const nodeTypes = { device: DeviceNode, splice: SpliceNode, cursor: CursorNode };
const edgeTypes = { segment: SegmentEdge };

// ── build graph ───────────────────────────────────────────────────────────────

function buildNodeBBoxes(harness: HarnessData, layout: LayoutData): BBox[] {
  const nodeBBoxes = harness.nodes.map((n) => {
    const pos  = layout.nodes?.[n.id] ?? { x: 200, y: 200 };
    const w    = pos.width ?? 160;
    const ports = harness.node_ports.filter((p) => p.node_ref === n.id);
    const rows = Math.max(Math.ceil(ports.length / 2), 1);
    const h    = 36 + 8 + rows * 22;
    return { id: n.id, x: pos.x, y: pos.y, w, h };
  });
  const spliceBBoxes = harness.splices.map((sp) => {
    const pos = layout.splices?.[sp.id] ?? { x: 400, y: 300 };
    return { id: sp.id, x: pos.x, y: pos.y, w: pos.width ?? 30, h: pos.height ?? 30 };
  });
  return [...nodeBBoxes, ...spliceBBoxes];
}

function buildGraph(
  harness: HarnessData,
  layout: LayoutData,
  highlightedEntities: Set<string>,
): { flowNodes: FlowNode[]; flowEdges: FlowEdge[]; nodeBBoxes: BBox[] } {
  const portToNode: Record<string, string> = {};
  harness.nodes.forEach((n) =>
    harness.node_ports.filter((p) => p.node_ref === n.id).forEach((p) => { portToNode[p.id] = n.id; }),
  );
  const netMap: Record<string, Net> = {};
  harness.nets.forEach((n) => { netMap[n.id] = n; });

  const anyHighlight = highlightedEntities.size > 0;
  const portSides = layout.portSides ?? {};
  const allX = Object.values(layout.nodes ?? {}).map((p) => p.x);
  const midX = allX.length ? (Math.min(...allX) + Math.max(...allX)) / 2 : 600;

  const nodeBBoxes = buildNodeBBoxes(harness, layout);

  // ── device nodes ──
  const flowNodes: FlowNode[] = harness.nodes.map((n) => {
    const pos   = layout.nodes?.[n.id] ?? { x: 200, y: 200 };
    const width = pos.width;
    const bgColor = pos.bgColor;
    const nodeSide = pos.x < midX ? "right" : "left";
    const ports = harness.node_ports
      .filter((p) => p.node_ref === n.id)
      .map((p) => {
        const net = p.net_ref ? netMap[p.net_ref] : undefined;
        const side = (portSides[p.id] as PortSide | undefined) ?? nodeSide;
        return { id: p.id, name: p.pin_name, side, netColor: net ? resolveNetColor(net) : undefined };
      });
    return {
      id: n.id, type: "device",
      position: { x: pos.x, y: pos.y },
      style: width ? { width } : undefined,
      data: { label: n.name, designator: n.designator, nodeId: n.id, bgColor, ports } as DeviceData,
    };
  });

  // ── splice nodes ──
  harness.splices.forEach((sp) => {
    const pos   = layout.splices?.[sp.id] ?? { x: 400, y: 300 };
    const net   = sp.net_ref ? netMap[sp.net_ref] : undefined;
    const color = net ? resolveNetColor(net) : "#94a3b8";
    flowNodes.push({
      id: sp.id, type: "splice",
      position: { x: pos.x, y: pos.y },
      data: {
        label: sp.name ?? "",
        netColor: color,
        segIds: [],
        width: pos.width ?? 30,
        height: pos.height ?? 30,
      } as SpliceData,
    });
  });

  // ── segment edges ──
  const spliceEdgeSides = layout.spliceEdgeSides ?? {};
  const FALLBACK_SIDES = ["right", "left", "top", "bottom"] as const;

  const getSpliceHandleId = (
    spliceId: string, segId: string, isSrc: boolean, fallbackIndex: number,
  ): string => {
    const sides = spliceEdgeSides[segId];
    const side = isSrc ? sides?.srcSide : sides?.tgtSide;
    if (side) return `${spliceId}-${side}-${isSrc ? "s" : "t"}`;
    return `${spliceId}-${FALLBACK_SIDES[fallbackIndex % FALLBACK_SIDES.length]}-${isSrc ? "s" : "t"}`;
  };

  const flowEdges: FlowEdge[] = harness.segments.map((seg, segIdx) => {
    const net    = seg.net_ref ? netMap[seg.net_ref] : undefined;
    const color  = net ? resolveNetColor(net) : "#475569";
    const width  = net?.display?.width_px ?? 2;
    const waypts = layout.edges?.[seg.id]?.waypoints ?? [];
    const dimmed = anyHighlight && (
      !highlightedEntities.has(seg.id) && !highlightedEntities.has(seg.net_ref ?? "")
    );
    const fromNodeId = seg.from.kind === "splice" ? seg.from.ref : (portToNode[seg.from.ref] ?? "");
    const toNodeId   = seg.to.kind   === "splice" ? seg.to.ref   : (portToNode[seg.to.ref]   ?? "");
    const getNodeId  = (kind: string, ref: string) => kind === "splice" ? ref : (portToNode[ref] ?? ref);
    const getHId     = (kind: string, ref: string, isSrc: boolean) =>
      kind === "splice"
        ? getSpliceHandleId(ref, seg.id, isSrc, segIdx * 2 + (isSrc ? 0 : 1))
        : `${ref}-${isSrc ? "s" : "t"}`;
    return {
      id: seg.id, type: "segment",
      source: getNodeId(seg.from.kind, seg.from.ref),
      sourceHandle: getHId(seg.from.kind, seg.from.ref, true),
      target: getNodeId(seg.to.kind, seg.to.ref),
      targetHandle: getHId(seg.to.kind, seg.to.ref, false),
      data: {
        color, width, label: seg.label, netId: seg.net_ref, waypoints: waypts, dimmed,
        nodeBBoxes, excludeNodeIds: [fromNodeId, toNodeId],
      } as SegEdgeData,
      selectable: true,
    };
  });

  return { flowNodes, flowEdges, nodeBBoxes };
}

// ── inner canvas ──────────────────────────────────────────────────────────────

function GraphCanvasInner() {
  const {
    harness, layout, highlightedEntities, highlightEntities, clearHighlight,
    wiring, addWaypoint, updateCursorPos, cancelWiring,
    moveNode, moveSplice, gridSnap, toggleGridSnap,
    setSelectedEntity, clearSelectedEntity,
    deleteSegment, deleteNode, deleteSplice,
    undoStack, redoStack, undo, redo,
    genericCreate, setPortSide,
    profiles, currentHarness,
    updateNodeStyle, startWiringFromSplice, completeWiringToSplice, updateSpliceDims,
  } = useProjectStore();

  const { screenToFlowPosition } = useReactFlow();

  const { flowNodes, flowEdges, nodeBBoxes } = useMemo(() => {
    if (!harness || !layout) return { flowNodes: [], flowEdges: [], nodeBBoxes: [] };
    return buildGraph(harness, layout, highlightedEntities);
  }, [harness, layout, highlightedEntities]);

  // ── ghost wire ──
  const ghostEdgeId  = "__ghost__";
  const cursorNodeId = "__cursor__";
  const wireEnd = useMemo(() => getConstrainedCursorPos(wiring), [wiring]);

  const allNodes: FlowNode[] = useMemo(() => {
    if (!wiring.active || !wireEnd) return flowNodes;
    const cursorNode: FlowNode = {
      id: cursorNodeId, type: "cursor",
      position: wireEnd, draggable: false, selectable: false,
      data: { _cursor: true } as CursorData,
      style: { pointerEvents: "none" },
    };
    return [...flowNodes, cursorNode];
  }, [flowNodes, wiring.active, wireEnd]);

  const allEdges: FlowEdge[] = useMemo(() => {
    if (!wiring.active || !wiring.sourcePortId || !wireEnd) return flowEdges;
    const ghostEdge: FlowEdge = {
      id: ghostEdgeId, type: "segment",
      source: wiring.sourceNodeId ?? "",
      sourceHandle: wiring.sourceKind === "splice"
        ? `${wiring.sourceNodeId}-${wiring.portSide ?? "right"}-s`
        : `${wiring.sourcePortId}-s`,
      target: cursorNodeId, targetHandle: "t",
      selectable: false,
      data: {
        color: "#60a5fa", width: 2,
        waypoints: wiring.waypoints, dimmed: false, isGhost: true,
      } as SegEdgeData,
    };
    return [...flowEdges, ghostEdge];
  }, [flowEdges, wiring, wireEnd]);

  const [nodes, setNodes, onNodesChange_] = useNodesState(allNodes);
  const [edges, setEdges, onEdgesChange]  = useEdgesState(allEdges);
  useEffect(() => { setNodes(allNodes); }, [allNodes]);
  useEffect(() => { setEdges(allEdges); }, [allEdges]);

  // ── UI state ──
  const [ctxMenu, setCtxMenu]       = useState<CtxMenu>(null);
  const [pendingDelete, setPDel]    = useState<{ type: string; id: string; label?: string } | null>(null);
  const [createNodePos, setCNPos]   = useState<{ flowX: number; flowY: number } | null>(null);
  const [createPortFor, setCPFor]   = useState<{ nodeId: string; nodeName: string } | null>(null);
  const [createSplicePos, setCSPos] = useState<{ flowX: number; flowY: number } | null>(null);
  const [propEditor, setPropEditor] = useState<PropEditorTarget | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { cancelWiring(); setCtxMenu(null); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      const t = e.target as HTMLElement;
      if ((e.key === "Backspace" || e.key === "Delete") && t.tagName !== "INPUT") {
        const selNode = nodes.find((n) => (n as FlowNode & { selected?: boolean }).selected && n.type !== "cursor");
        const selEdge = edges.find((ed) => (ed as FlowEdge & { selected?: boolean }).selected && ed.id !== ghostEdgeId);
        if (selNode) {
          const lbl = (selNode.data as DeviceData | SpliceData).label ?? selNode.id;
          setPDel({ type: selNode.type === "splice" ? "splice" : "node", id: selNode.id, label: String(lbl) });
        } else if (selEdge) {
          setPDel({ type: "segment", id: selEdge.id });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelWiring, undo, redo, nodes, edges]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange_(changes);
    changes.forEach((ch) => {
      if (ch.type === "dimensions" && ch.resizing) updateNodeStyle(ch.id, { width: ch.dimensions?.width });
    });
  }, [onNodesChange_, updateNodeStyle]);

  // ── canvas handlers ──
  const onPaneClick = useCallback(() => {
    if (wiring.active) { addWaypoint(); return; }
    clearHighlight(); clearSelectedEntity(); setCtxMenu(null);
  }, [wiring.active, addWaypoint, clearHighlight, clearSelectedEntity]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!wiring.active) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    updateCursorPos(pos.x, pos.y);
  }, [wiring.active, screenToFlowPosition, updateCursorPos]);

  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    if (wiring.active) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setCtxMenu({ kind: "pane", x: e.clientX, y: e.clientY, flowX: pos.x, flowY: pos.y });
  }, [wiring.active, screenToFlowPosition]);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: FlowNode) => {
    e.preventDefault();
    if (wiring.active || node.type === "cursor") return;
    setCtxMenu({ kind: "node", x: e.clientX, y: e.clientY, nodeId: node.id, nodeType: node.type });
  }, [wiring.active]);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: FlowEdge) => {
    e.preventDefault();
    if (edge.id === ghostEdgeId) return;
    setCtxMenu({ kind: "edge", x: e.clientX, y: e.clientY, edgeId: edge.id });
  }, []);

  const onNodeDragStop = useCallback((_: unknown, node: FlowNode) => {
    if (node.type === "device") moveNode(node.id, node.position.x, node.position.y);
    else if (node.type === "splice") moveSplice(node.id, node.position.x, node.position.y);
  }, [moveNode, moveSplice]);

  const onEdgeClick = useCallback((_: unknown, edge: FlowEdge) => {
    if (edge.id === ghostEdgeId) return;
    const netId = (edge.data as SegEdgeData | undefined)?.netId;
    if (netId) highlightEntities([netId, edge.id]);
    setSelectedEntity("segment", edge.id);
  }, [highlightEntities, setSelectedEntity]);

  const onNodeClick = useCallback((_: unknown, node: FlowNode) => {
    if (node.type === "device") setSelectedEntity("device", node.id);
    else if (node.type === "splice") setSelectedEntity("splice", node.id);
    clearHighlight();
  }, [setSelectedEntity, clearHighlight]);

  // ── create node ──
  const [newNodeName, setNNN] = useState("");
  const [newNodeDes,  setNND] = useState("");
  const doCreateNode = useCallback(async () => {
    if (!newNodeName.trim() || !createNodePos) return;
    const ifaceId = `iface_${Math.random().toString(36).slice(2, 10)}`;
    try {
      const created = await genericCreate("nodes", {
        type: "node", name: newNodeName.trim(),
        designator: newNodeDes.trim() || undefined,
        interfaces: [{ id: ifaceId, name: "main", port_refs: [] }],
      }) as { id: string };
      useProjectStore.getState().moveNode(created.id, createNodePos.flowX, createNodePos.flowY);
    } catch (err) { showToast(`${err}`); }
    setCNPos(null); setNNN(""); setNND("");
  }, [newNodeName, newNodeDes, createNodePos, genericCreate]);

  // ── create port ──
  const [newPortName, setNPN]   = useState("");
  const [newPortSide, setNPS]   = useState<PortSide>("right");
  const profileList = Object.values(profiles);
  const doCreatePort = useCallback(async () => {
    if (!newPortName.trim() || !createPortFor) return;
    const node = harness?.nodes.find((n) => n.id === createPortFor.nodeId);
    if (!node) return;
    const iface = node.interfaces[0];
    if (!iface) { showToast("Node has no interface"); return; }
    try {
      const created = await genericCreate("node_ports", {
        type: "node_port", node_ref: createPortFor.nodeId,
        interface_ref: iface.id, pin_name: newPortName.trim(),
        profile_ref: profileList[0]?.id ?? "",
      }) as { id: string };
      setPortSide(created.id, newPortSide);
    } catch (err) { showToast(`${err}`); }
    setCPFor(null); setNPN(""); setNPS("right");
  }, [newPortName, newPortSide, createPortFor, harness, genericCreate, profileList, setPortSide]);

  // ── create splice ──
  const [spliceName, setSN] = useState("");
  const doCreateSplice = useCallback(async () => {
    if (!createSplicePos) return;
    try {
      const created = await genericCreate("splices", {
        type: "splice", name: spliceName.trim() || undefined,
      }) as { id: string };
      // Place in layout
      useProjectStore.getState().moveSplice(created.id, createSplicePos.flowX, createSplicePos.flowY);
    } catch (err) { showToast(`${err}`); }
    setCSPos(null); setSN("");
  }, [spliceName, createSplicePos, genericCreate]);

  // ── delete confirm ──
  const doDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const { type, id } = pendingDelete;
    try {
      if (type === "segment")     await deleteSegment(id);
      else if (type === "node")   await deleteNode(id);
      else if (type === "splice") await deleteSplice(id);
    } catch (err) { showToast(`${err}`); }
    setPDel(null);
  }, [pendingDelete, deleteSegment, deleteNode, deleteSplice]);

  if (!harness) return <div style={{ padding: 24, color: "#475569" }}>No harness loaded</div>;
  if (!layout)  return <div style={{ padding: 24, color: "#475569" }}>No layout data</div>;

  // ── build context menu items ──
  const ctxItems = (() => {
    if (!ctxMenu) return [];
    if (ctxMenu.kind === "pane") return [
      { label: "Create Node…",   onClick: () => setCNPos({ flowX: ctxMenu.flowX, flowY: ctxMenu.flowY }) },
      { label: "Create Splice…", onClick: () => setCSPos({ flowX: ctxMenu.flowX, flowY: ctxMenu.flowY }) },
    ];
    if (ctxMenu.kind === "node" && ctxMenu.nodeType === "device") {
      const node = harness.nodes.find((n) => n.id === ctxMenu.nodeId);
      return [
        { label: "Edit Properties…", onClick: () => setPropEditor({ entityType: "nodes", entityId: ctxMenu.nodeId }) },
        { label: "Add Port…", onClick: () => node && setCPFor({ nodeId: node.id, nodeName: node.name }) },
        { label: "Delete Node", danger: true, onClick: () => setPDel({ type: "node", id: ctxMenu.nodeId, label: harness.nodes.find(n => n.id === ctxMenu.nodeId)?.name }) },
      ];
    }
    if (ctxMenu.kind === "node" && ctxMenu.nodeType === "splice") return [
      { label: "Edit Properties…", onClick: () => setPropEditor({ entityType: "splices", entityId: ctxMenu.nodeId }) },
      { label: "Delete Splice", danger: true, onClick: () => setPDel({ type: "splice", id: ctxMenu.nodeId }) },
    ];
    if (ctxMenu.kind === "edge") return [
      { label: "Edit Wire Properties…", onClick: () => setPropEditor({ entityType: "segments", entityId: ctxMenu.edgeId }) },
      { label: "Delete Wire", danger: true, onClick: () => setPDel({ type: "segment", id: ctxMenu.edgeId }) },
    ];
    if (ctxMenu.kind === "port") {
      const portId = ctxMenu.portId;
      const port = harness.node_ports.find((p) => p.id === portId);
      const portLabel = port?.pin_name ?? portId;
      return [
        { label: `Edit Port "${portLabel}"…`, onClick: () => setPropEditor({ entityType: "node_ports", entityId: portId }) },
        { label: "Delete Port", danger: true, onClick: () => setPDel({ type: "node_port", id: portId, label: portLabel }) },
      ];
    }
    return [];
  })();

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }} onMouseMove={onMouseMove}>

      {/* Wiring banner */}
      {wiring.active && (
        <div style={{
          position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
          background: "#1e3a5f", border: "1px solid #3b82f6", borderRadius: 6,
          padding: "5px 14px", fontSize: 12, color: "#93c5fd", zIndex: 10, pointerEvents: "none",
        }}>
          Wiring — click target port · click canvas to add corner · Esc to cancel
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)",
          background: "#7f1d1d", border: "1px solid #f87171", borderRadius: 6,
          padding: "6px 16px", fontSize: 12, color: "#fca5a5", zIndex: 20, pointerEvents: "none",
        }}>{toast}</div>
      )}

      {/* Toolbar */}
      <div style={{ position: "absolute", bottom: 8, left: 8, display: "flex", gap: 6, zIndex: 10 }}>
        <ToolBtn active={gridSnap} onClick={toggleGridSnap} title={gridSnap ? "Grid snap on" : "Grid snap off"}>⊞</ToolBtn>
        <ToolBtn active={undoStack.length > 0} disabled={!undoStack.length} onClick={undo} title="Undo">↩</ToolBtn>
        <ToolBtn active={redoStack.length > 0} disabled={!redoStack.length} onClick={redo} title="Redo">↪</ToolBtn>
      </div>

      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={onEdgeClick}
        onNodeClick={onNodeClick}
        fitView fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={!wiring.active}
        nodesConnectable={false}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={false}
        snapToGrid={gridSnap} snapGrid={[10, 10]}
        zoomOnDoubleClick={false}
        colorMode="dark"
        style={{ background: "#6e6e6e", cursor: wiring.active ? "crosshair" : "default" }}
        deleteKeyCode={null}
      >
        <Background color="#5a5a5a" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor="#1e3a5f" maskColor="#5a5a5acc" style={{ background: "#7a7a7a" }} />
      </ReactFlow>

      {/* Context menu */}
      {ctxMenu && ctxItems.length > 0 && (
        <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} items={ctxItems} />
      )}

      {/* Property editor */}
      {propEditor && (
        <PropertyEditorModal target={propEditor} onClose={() => setPropEditor(null)} />
      )}

      {/* Delete confirm */}
      {pendingDelete && (
        <Modal title="Confirm Delete" onClose={() => setPDel(null)}>
          <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 16 }}>
            Delete {pendingDelete.type}{pendingDelete.label ? ` "${pendingDelete.label}"` : ""}?
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <MBtn onClick={() => setPDel(null)}>Cancel</MBtn>
            <MBtn danger onClick={doDelete}>Delete</MBtn>
          </div>
        </Modal>
      )}

      {/* Create node */}
      {createNodePos && (
        <Modal title="Create Node" onClose={() => setCNPos(null)}>
          <MInput label="Name" value={newNodeName} onChange={setNNN} placeholder="MCU, Connector…" />
          <MInput label="Designator (optional)" value={newNodeDes} onChange={setNND} placeholder="U1" />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <MBtn onClick={() => setCNPos(null)}>Cancel</MBtn>
            <MBtn onClick={doCreateNode} disabled={!newNodeName.trim()}>Create</MBtn>
          </div>
        </Modal>
      )}

      {/* Create port */}
      {createPortFor && (
        <Modal title={`Add Port to "${createPortFor.nodeName}"`} onClose={() => setCPFor(null)}>
          <MInput label="Pin name" value={newPortName} onChange={setNPN} placeholder="TX, GND, VCC…" />
          <MSelect label="Side" value={newPortSide} onChange={(v) => setNPS(v as PortSide)}
            options={[
              { value: "right",  label: "Right" },
              { value: "left",   label: "Left" },
              { value: "top",    label: "Top" },
              { value: "bottom", label: "Bottom" },
            ]} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <MBtn onClick={() => setCPFor(null)}>Cancel</MBtn>
            <MBtn onClick={doCreatePort} disabled={!newPortName.trim()}>Add Port</MBtn>
          </div>
        </Modal>
      )}

      {/* Create splice */}
      {createSplicePos && (
        <Modal title="Create Splice" onClose={() => setCSPos(null)}>
          <MInput label="Name (optional)" value={spliceName} onChange={setSN} placeholder="SP1" />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <MBtn onClick={() => setCSPos(null)}>Cancel</MBtn>
            <MBtn onClick={doCreateSplice}>Create</MBtn>
          </div>
        </Modal>
      )}

    </div>
  );
}

// ── toolbar button ────────────────────────────────────────────────────────────

function ToolBtn({
  children, active, onClick, title, disabled,
}: { children: React.ReactNode; active?: boolean; onClick: () => void; title?: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      background: active ? "#1e3a5f" : "#1a2035",
      border: `1px solid ${active ? "#3b82f6" : "#2d3748"}`,
      color: disabled ? "#374151" : active ? "#60a5fa" : "#94a3b8",
      borderRadius: 4, padding: "3px 8px", fontSize: 13,
      cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
    }}>{children}</button>
  );
}

// ── exported wrapper ──────────────────────────────────────────────────────────

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}
