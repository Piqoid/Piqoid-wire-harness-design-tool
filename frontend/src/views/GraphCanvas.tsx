import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
  type EdgeProps,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node as FlowNode,
  type Edge as FlowEdge,
  SelectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useProjectStore, resolveNetColor } from "../store/project";
import type { HarnessData, LayoutData, Net, NodePort } from "../types";

// ── orthogonal path ───────────────────────────────────────────────────────────

function orthogonalPath(
  sx: number, sy: number,
  tx: number, ty: number,
  waypoints: { x: number; y: number }[] = [],
): string {
  const pts = [{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }];

  // Build segments that are strictly horizontal then vertical (L-shaped between each pair)
  const segs: string[] = [`M ${sx} ${sy}`];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const isLast = i === pts.length - 1;

    if (!isLast && Math.abs(curr.x - prev.x) > 1) {
      // Intermediate waypoints: route horizontally to waypoint, then continue
      segs.push(`L ${curr.x} ${prev.y}`);
      segs.push(`L ${curr.x} ${curr.y}`);
    } else if (isLast) {
      // Final point: go horizontal to target X, then vertical to target Y
      if (Math.abs(curr.y - prev.y) > 1 && Math.abs(curr.x - prev.x) > 1) {
        const midX = prev.x + (curr.x - prev.x) * 0.5;
        segs.push(`L ${midX} ${prev.y}`);
        segs.push(`L ${midX} ${curr.y}`);
        segs.push(`L ${curr.x} ${curr.y}`);
      } else {
        segs.push(`L ${curr.x} ${curr.y}`);
      }
    } else {
      segs.push(`L ${curr.x} ${curr.y}`);
    }
  }
  return segs.join(" ");
}

// ── data shapes ───────────────────────────────────────────────────────────────

interface DeviceData extends Record<string, unknown> {
  label: string;
  designator?: string;
  nodeId: string;
  ports: { id: string; name: string; side: "left" | "right"; netColor?: string }[];
}

interface SpliceData extends Record<string, unknown> {
  label: string;
  netColor: string;
  segIds: string[];
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
}

// ── custom node: device ───────────────────────────────────────────────────────

function DeviceNode({ data, selected }: NodeProps<FlowNode<DeviceData>>) {
  const { wiring, startWiring, completeWiring, setWiringHover, clearWiringHover } = useProjectStore();

  const leftPorts  = data.ports.filter((p) => p.side === "left");
  const rightPorts = data.ports.filter((p) => p.side === "right");
  const rowCount   = Math.max(leftPorts.length, rightPorts.length, 1);
  const contentH   = rowCount * 22 + 8;

  const handlePortClick = useCallback((portId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!wiring.active) {
      startWiring(portId, data.nodeId);
    } else if (wiring.sourcePortId !== portId) {
      if (wiring.hover?.severity === "error") return; // hard violation
      completeWiring(portId, data.nodeId);
    } else {
      // clicked own source port — cancel
      useProjectStore.getState().cancelWiring();
    }
  }, [wiring, data.nodeId, startWiring, completeWiring]);

  const isWiringSource = wiring.sourceNodeId === data.nodeId;

  return (
    <div style={{
      background: selected ? "#1e3a6a" : "#1e2d4a",
      border: `1px solid ${selected ? "#60a5fa" : isWiringSource ? "#f59e0b" : "#3b82f6"}`,
      borderRadius: 6, minWidth: 140, fontFamily: "inherit",
      boxShadow: selected ? "0 0 0 2px #3b82f688" : undefined,
    }}>
      {/* Title */}
      <div style={{ padding: "4px 8px", borderBottom: "1px solid #2d3748",
                    background: "#162032", borderRadius: "5px 5px 0 0" }}>
        <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{data.label}</div>
        {data.designator && <div style={{ fontSize: 10, color: "#60a5fa" }}>{data.designator}</div>}
      </div>

      {/* Port rows */}
      <div style={{ display: "flex", justifyContent: "space-between",
                    minHeight: contentH, padding: "4px 0" }}>
        {/* Left ports */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {leftPorts.map((p) => {
            const hoverInfo = wiring.active && wiring.hover?.portId === p.id ? wiring.hover : null;
            const hoverColor = hoverInfo?.severity === "error" ? "#f87171"
              : hoverInfo?.severity === "warn" ? "#fbbf24" : wiring.active ? "#22c55e" : undefined;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center",
                                        paddingLeft: 10, height: 22, position: "relative",
                                        cursor: wiring.active ? "crosshair" : "default" }}
                   title={hoverInfo?.message ?? p.name}
                   onClick={(e) => handlePortClick(p.id, e)}
                   onMouseEnter={() => wiring.active && wiring.sourcePortId && setWiringHover(p.id, wiring.sourcePortId)}
                   onMouseLeave={() => clearWiringHover()}>
                <Handle id={`${p.id}-t`} type="target" position={Position.Left}
                        isConnectable={false}
                        style={{ left: 0, top: "50%", transform: "translateY(-50%)",
                                 width: 8, height: 8,
                                 background: hoverColor ?? p.netColor ?? "#3b82f6",
                                 border: "1px solid #1e3a6a" }} />
                <Handle id={`${p.id}-s`} type="source" position={Position.Left}
                        isConnectable={false}
                        style={{ left: 0, top: "50%", transform: "translateY(-50%)",
                                 width: 8, height: 8, opacity: 0 }} />
                <span style={{ fontSize: 9, color: "#94a3b8", paddingLeft: 4 }}>{p.name}</span>
              </div>
            );
          })}
        </div>

        {/* Right ports */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {rightPorts.map((p) => {
            const hoverInfo = wiring.active && wiring.hover?.portId === p.id ? wiring.hover : null;
            const hoverColor = hoverInfo?.severity === "error" ? "#f87171"
              : hoverInfo?.severity === "warn" ? "#fbbf24" : wiring.active ? "#22c55e" : undefined;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center",
                                        paddingRight: 10, height: 22, position: "relative",
                                        cursor: wiring.active ? "crosshair" : "default",
                                        justifyContent: "flex-end" }}
                   title={hoverInfo?.message ?? p.name}
                   onClick={(e) => handlePortClick(p.id, e)}
                   onMouseEnter={() => wiring.active && wiring.sourcePortId && setWiringHover(p.id, wiring.sourcePortId)}
                   onMouseLeave={() => clearWiringHover()}>
                <span style={{ fontSize: 9, color: "#94a3b8", paddingRight: 4 }}>{p.name}</span>
                <Handle id={`${p.id}-s`} type="source" position={Position.Right}
                        isConnectable={false}
                        style={{ right: 0, top: "50%", transform: "translateY(-50%)",
                                 width: 8, height: 8,
                                 background: hoverColor ?? p.netColor ?? "#3b82f6",
                                 border: "1px solid #1e3a6a" }} />
                <Handle id={`${p.id}-t`} type="target" position={Position.Right}
                        isConnectable={false}
                        style={{ right: 0, top: "50%", transform: "translateY(-50%)",
                                 width: 8, height: 8, opacity: 0 }} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── custom node: splice (junction dot) ───────────────────────────────────────

function SpliceNode({ data, selected }: NodeProps<FlowNode<SpliceData>>) {
  const { wiring, startWiring, completeWiring } = useProjectStore();
  // Splice nodes act as wire endpoints too
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const splicePortId = `${data.label}__splice`;
    if (!wiring.active) {
      // Can start wiring from splice? For now, just select it.
    }
  }, [wiring, data]);

  return (
    <div style={{ width: 16, height: 16, borderRadius: "50%", position: "relative",
                  background: data.netColor, border: `2px solid ${selected ? "#60a5fa" : "#94a3b8"}`,
                  cursor: "pointer", boxShadow: selected ? "0 0 0 2px #3b82f688" : undefined }}
         title={data.label}
         onClick={handleClick}>
      {data.segIds.map((sid, i) => (
        <span key={sid}>
          <Handle id={`${sid}-s`} type="source"
                  position={i % 2 === 0 ? Position.Right : Position.Left}
                  isConnectable={false}
                  style={{ width: 0, height: 0, border: "none", background: "transparent",
                           top: "50%", transform: "translateY(-50%)" }} />
          <Handle id={`${sid}-t`} type="target"
                  position={i % 2 === 0 ? Position.Left : Position.Right}
                  isConnectable={false}
                  style={{ width: 0, height: 0, border: "none", background: "transparent",
                           top: "50%", transform: "translateY(-50%)" }} />
        </span>
      ))}
    </div>
  );
}

// ── custom node: invisible cursor anchor ──────────────────────────────────────

function CursorNode(_: NodeProps<FlowNode<CursorData>>) {
  return (
    <div style={{ width: 1, height: 1, background: "transparent" }}>
      <Handle id="t" type="target" position={Position.Left}
              isConnectable={false}
              style={{ width: 0, height: 0, border: "none", background: "transparent" }} />
    </div>
  );
}

// ── custom edge: orthogonal segment ──────────────────────────────────────────

function SegmentEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
}: EdgeProps<FlowEdge<SegEdgeData>>) {
  const color    = data?.color ?? "#60a5fa";
  const width    = data?.width ?? 2;
  const dimmed   = data?.dimmed ?? false;
  const isGhost  = data?.isGhost ?? false;
  const waypts   = data?.waypoints ?? [];

  const d = orthogonalPath(sourceX, sourceY, targetX, targetY, waypts);

  return (
    <g style={{ opacity: dimmed ? 0.12 : 1, transition: "opacity .12s",
                pointerEvents: isGhost ? "none" : "all" }}>
      {/* Invisible wider hit area */}
      <path d={d} stroke="transparent" strokeWidth={12} fill="none" style={{ cursor: "pointer" }} />
      {/* Visible wire */}
      <path
        id={id} d={d}
        stroke={color} strokeWidth={selected ? width + 1.5 : width}
        fill="none" strokeLinecap="square"
        strokeDasharray={isGhost ? "6 4" : undefined}
        opacity={isGhost ? 0.65 : 1}
      />
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

// ── node + edge type registries ───────────────────────────────────────────────

const nodeTypes = { device: DeviceNode, splice: SpliceNode, cursor: CursorNode };
const edgeTypes = { segment: SegmentEdge };

// ── build graph from harness data ─────────────────────────────────────────────

function buildGraph(
  harness: HarnessData,
  layout: LayoutData,
  hoveredNet: string | null,
  highlightedEntities: Set<string>,
): { flowNodes: FlowNode[]; flowEdges: FlowEdge[] } {
  const portToNode: Record<string, string> = {};
  harness.nodes.forEach((n) => {
    harness.node_ports.filter((p) => p.node_ref === n.id).forEach((p) => { portToNode[p.id] = n.id; });
  });

  const netMap: Record<string, Net> = {};
  harness.nets.forEach((n) => { netMap[n.id] = n; });

  const portMap: Record<string, NodePort> = {};
  harness.node_ports.forEach((p) => { portMap[p.id] = p; });

  // Determine node X midpoint for left/right port side assignment
  const allX = Object.values(layout.nodes ?? {}).map((p) => p.x);
  const midX  = allX.length ? (Math.min(...allX) + Math.max(...allX)) / 2 : 600;

  // Which nets are "active" for dimming
  const anyHighlight = highlightedEntities.size > 0 || hoveredNet != null;

  // ── device nodes ──
  const flowNodes: FlowNode[] = harness.nodes.map((n) => {
    const pos  = layout.nodes?.[n.id] ?? { x: 200, y: 200 };
    const side = pos.x < midX ? "right" : "left";
    const ports = harness.node_ports
      .filter((p) => p.node_ref === n.id)
      .map((p) => {
        const net = p.net_ref ? netMap[p.net_ref] : undefined;
        return { id: p.id, name: p.pin_name, side, netColor: net ? resolveNetColor(net) : undefined };
      });
    return {
      id: n.id, type: "device",
      position: { x: pos.x, y: pos.y },
      data: { label: n.name, designator: n.designator, nodeId: n.id, ports } as DeviceData,
    };
  });

  // Collect splice → segment IDs
  const spliceSegs: Record<string, string[]> = {};
  harness.splices.forEach((sp) => { spliceSegs[sp.id] = []; });
  harness.segments.forEach((seg) => {
    if (seg.from.kind === "splice") spliceSegs[seg.from.ref]?.push(seg.id);
    if (seg.to.kind === "splice")   spliceSegs[seg.to.ref]?.push(seg.id);
  });

  // ── splice nodes ──
  harness.splices.forEach((sp) => {
    const pos    = layout.splices?.[sp.id] ?? { x: 400, y: 300 };
    const net    = sp.net_ref ? netMap[sp.net_ref] : undefined;
    const color  = net ? resolveNetColor(net) : "#94a3b8";
    flowNodes.push({
      id: sp.id, type: "splice",
      position: { x: pos.x, y: pos.y },
      data: { label: sp.name ?? sp.id, netColor: color, segIds: spliceSegs[sp.id] ?? [] } as SpliceData,
    });
  });

  // ── edges (segments) ──
  const flowEdges: FlowEdge[] = harness.segments.map((seg) => {
    const net    = seg.net_ref ? netMap[seg.net_ref] : undefined;
    const color  = net ? resolveNetColor(net) : "#475569";
    const width  = net?.display?.width_px ?? 2;
    const waypts = layout.edges?.[seg.id]?.waypoints ?? [];

    const dimmed = anyHighlight && (
      (highlightedEntities.size > 0 && !highlightedEntities.has(seg.id) && !highlightedEntities.has(seg.net_ref ?? ""))
      || (hoveredNet != null && seg.net_ref !== hoveredNet)
    );

    const getNodeId = (kind: string, ref: string) =>
      kind === "splice" ? ref : (portToNode[ref] ?? ref);

    const getHandleId = (kind: string, ref: string, isSrc: boolean) => {
      if (kind === "splice") return isSrc ? `${seg.id}-s` : `${seg.id}-t`;
      return isSrc ? `${ref}-s` : `${ref}-t`;
    };

    return {
      id: seg.id, type: "segment",
      source: getNodeId(seg.from.kind, seg.from.ref),
      sourceHandle: getHandleId(seg.from.kind, seg.from.ref, true),
      target: getNodeId(seg.to.kind, seg.to.ref),
      targetHandle: getHandleId(seg.to.kind, seg.to.ref, false),
      data: { color, width, label: seg.label, netId: seg.net_ref, waypoints: waypts, dimmed } as SegEdgeData,
      selectable: true,
    };
  });

  return { flowNodes, flowEdges };
}

// ── inner canvas (needs useReactFlow) ────────────────────────────────────────

function GraphCanvasInner() {
  const {
    harness, layout, hoveredNet, setHoveredNet,
    highlightedEntities, highlightEntities, clearHighlight,
    wiring, addWaypoint, updateCursorPos, cancelWiring,
    moveNode, moveSplice, gridSnap, toggleGridSnap,
    setSelectedEntity, clearSelectedEntity,
    deleteSegment, undoStack, redoStack, undo, redo,
  } = useProjectStore();

  const { screenToFlowPosition } = useReactFlow();

  const { flowNodes, flowEdges } = useMemo(() => {
    if (!harness || !layout) return { flowNodes: [], flowEdges: [] };
    return buildGraph(harness, layout, hoveredNet, highlightedEntities);
  }, [harness, layout, hoveredNet, highlightedEntities]);

  // Ghost wire + cursor node when wiring
  const ghostEdgeId = "__ghost__";
  const cursorNodeId = "__cursor__";

  const allNodes: FlowNode[] = useMemo(() => {
    if (!wiring.active || !wiring.cursorPos) return flowNodes;
    const cursorNode: FlowNode = {
      id: cursorNodeId, type: "cursor",
      position: wiring.cursorPos,
      draggable: false, selectable: false,
      data: { _cursor: true } as CursorData,
    };
    return [...flowNodes, cursorNode];
  }, [flowNodes, wiring.active, wiring.cursorPos]);

  const allEdges: FlowEdge[] = useMemo(() => {
    if (!wiring.active || !wiring.sourcePortId || !wiring.cursorPos) return flowEdges;
    const srcNodeId = wiring.sourceNodeId ?? "";
    const srcPortId = wiring.sourcePortId;
    const ghostEdge: FlowEdge = {
      id: ghostEdgeId, type: "segment",
      source: srcNodeId,
      sourceHandle: `${srcPortId}-s`,
      target: cursorNodeId,
      targetHandle: "t",
      selectable: false,
      data: {
        color: "#60a5fa", width: 2,
        waypoints: wiring.waypoints,
        dimmed: false, isGhost: true,
      } as SegEdgeData,
    };
    return [...flowEdges, ghostEdge];
  }, [flowEdges, wiring]);

  const [nodes, setNodes, onNodesChange] = useNodesState(allNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(allEdges);

  // Sync nodes/edges when underlying data changes
  useEffect(() => { setNodes(allNodes); }, [allNodes]);
  useEffect(() => { setEdges(allEdges); }, [allEdges]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelWiring();
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelWiring, undo, redo]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const onPaneClick = useCallback((e: React.MouseEvent) => {
    if (wiring.active) {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addWaypoint(pos.x, pos.y);
    } else {
      clearHighlight();
      clearSelectedEntity();
    }
  }, [wiring.active, screenToFlowPosition, addWaypoint, clearHighlight, clearSelectedEntity]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!wiring.active) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    updateCursorPos(pos.x, pos.y);
  }, [wiring.active, screenToFlowPosition, updateCursorPos]);

  const onNodeDragStop = useCallback((_: unknown, node: FlowNode) => {
    if (node.type === "device") {
      moveNode(node.id, node.position.x, node.position.y);
    } else if (node.type === "splice") {
      moveSplice(node.id, node.position.x, node.position.y);
    }
  }, [moveNode, moveSplice]);

  const onEdgeClick = useCallback((_: unknown, edge: FlowEdge) => {
    if (edge.id === ghostEdgeId) return;
    const netId = (edge.data as SegEdgeData | undefined)?.netId;
    if (netId) {
      highlightEntities([netId, edge.id]);
      setSelectedEntity("segment", edge.id);
    }
  }, [highlightEntities, setSelectedEntity]);

  const onNodeClick = useCallback((_: unknown, node: FlowNode) => {
    if (node.type === "device" || node.type === "splice") {
      setSelectedEntity(node.type, node.id);
    }
  }, [setSelectedEntity]);

  const onEdgeMouseEnter = useCallback((_: unknown, edge: FlowEdge) => {
    const netId = (edge.data as SegEdgeData | undefined)?.netId;
    if (netId) setHoveredNet(netId);
  }, [setHoveredNet]);

  const onEdgeMouseLeave = useCallback(() => setHoveredNet(null), [setHoveredNet]);

  if (!harness) return <div style={{ padding: 24, color: "#475569" }}>No harness loaded</div>;
  if (!layout)  return <div style={{ padding: 24, color: "#475569" }}>No layout data</div>;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}
         onMouseMove={onMouseMove}>
      {/* Wiring mode banner */}
      {wiring.active && (
        <div style={{
          position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
          background: "#1e3a5f", border: "1px solid #3b82f6", borderRadius: 6,
          padding: "5px 14px", fontSize: 12, color: "#93c5fd", zIndex: 10,
          pointerEvents: "none",
        }}>
          Wiring mode — click target port to connect · click canvas to add corner · Esc to cancel
        </div>
      )}

      {/* Toast for violations */}
      {toast && (
        <div style={{
          position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)",
          background: "#7f1d1d", border: "1px solid #f87171", borderRadius: 6,
          padding: "6px 16px", fontSize: 12, color: "#fca5a5", zIndex: 20,
          pointerEvents: "none",
        }}>
          {toast}
        </div>
      )}

      {/* Toolbar */}
      <div style={{
        position: "absolute", bottom: 8, left: 8, display: "flex", gap: 6, zIndex: 10,
      }}>
        <ToolBtn
          active={gridSnap}
          onClick={toggleGridSnap}
          title={gridSnap ? "Grid snap on" : "Grid snap off"}
        >⊞</ToolBtn>
        <ToolBtn
          active={undoStack.length > 0}
          onClick={undo}
          title="Undo (Ctrl+Z)"
          disabled={!undoStack.length}
        >↩</ToolBtn>
        <ToolBtn
          active={redoStack.length > 0}
          onClick={redo}
          title="Redo (Ctrl+Y)"
          disabled={!redoStack.length}
        >↪</ToolBtn>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={onEdgeClick}
        onNodeClick={onNodeClick}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={!wiring.active}
        nodesConnectable={false}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={false}
        snapToGrid={gridSnap}
        snapGrid={[10, 10]}
        zoomOnDoubleClick={false}
        colorMode="dark"
        style={{ background: "#4b5563", cursor: wiring.active ? "crosshair" : "default" }}
        deleteKeyCode={["Backspace", "Delete"]}
        onKeyDown={(e) => {
          // Delete selected segment
          const target = e.target as HTMLElement;
          if ((e.key === "Backspace" || e.key === "Delete") && target.tagName !== "INPUT") {
            const sel = edges.find((ed) => (ed as FlowEdge & { selected?: boolean }).selected);
            if (sel && sel.id !== ghostEdgeId) {
              deleteSegment(sel.id);
            }
          }
        }}
      >
        <Background color="#1e2a3a" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor="#1e3a5f" maskColor="#0f1623cc" style={{ background: "#151922" }} />
      </ReactFlow>
    </div>
  );
}

// ── tiny toolbar button ───────────────────────────────────────────────────────

function ToolBtn({
  children, active, onClick, title, disabled,
}: { children: React.ReactNode; active?: boolean; onClick: () => void; title?: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: active ? "#1e3a5f" : "#1a2035",
        border: `1px solid ${active ? "#3b82f6" : "#2d3748"}`,
        color: disabled ? "#374151" : active ? "#60a5fa" : "#94a3b8",
        borderRadius: 4, padding: "3px 8px", fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
      }}
    >{children}</button>
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
