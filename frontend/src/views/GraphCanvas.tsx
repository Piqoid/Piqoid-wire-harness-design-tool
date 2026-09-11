import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
  type EdgeProps,
  getBezierPath,
  useNodesState,
  useEdgesState,
  type Node as FlowNode,
  type Edge as FlowEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useProjectStore, resolveNetColor } from "../store/project";
import type { HarnessData, LayoutData, Net } from "../types";

// ── node data shapes ──────────────────────────────────────────────────────────

interface DeviceData extends Record<string, unknown> {
  label: string;
  designator?: string;
  ports: { id: string; name: string; side: "left" | "right" }[];
}

interface SpliceData extends Record<string, unknown> {
  label: string;
  handles: { id: string; side: "left" | "right" }[];
}

// ── custom node: device (rectangle card) ─────────────────────────────────────

function DeviceNode({ data }: NodeProps<FlowNode<DeviceData>>) {
  const leftPorts  = data.ports.filter((p) => p.side === "left");
  const rightPorts = data.ports.filter((p) => p.side === "right");
  const rowCount   = Math.max(leftPorts.length, rightPorts.length, 1);
  const height     = Math.max(50, rowCount * 20 + 20);

  return (
    <div style={{
      background: "#1e2d4a", border: "1px solid #3b82f6", borderRadius: 6,
      minWidth: 130, minHeight: height, position: "relative",
      fontFamily: "inherit",
    }}>
      {/* Title bar */}
      <div style={{ padding: "4px 8px", borderBottom: "1px solid #2d3748", background: "#162032",
                    borderRadius: "5px 5px 0 0" }}>
        <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{data.label}</div>
        {data.designator && (
          <div style={{ fontSize: 10, color: "#60a5fa" }}>{data.designator}</div>
        )}
      </div>

      {/* Port list */}
      <div style={{ padding: "4px 0", display: "flex", justifyContent: "space-between" }}>
        {/* Left ports */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
          {leftPorts.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", position: "relative",
                                      paddingLeft: 10, height: 18 }}>
              <Handle id={`${p.id}-t`} type="target" position={Position.Left}
                      style={{ left: -5, top: "50%", transform: "translateY(-50%)",
                               width: 7, height: 7, background: "#3b82f6", border: "none" }} />
              <Handle id={`${p.id}-s`} type="source" position={Position.Left}
                      style={{ left: -5, top: "50%", transform: "translateY(-50%)",
                               width: 7, height: 7, background: "#3b82f6", border: "none", opacity: 0 }} />
              <span style={{ fontSize: 9, color: "#64748b" }}>{p.name}</span>
            </div>
          ))}
        </div>

        {/* Right ports */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          {rightPorts.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", position: "relative",
                                      paddingRight: 10, height: 18 }}>
              <span style={{ fontSize: 9, color: "#64748b" }}>{p.name}</span>
              <Handle id={`${p.id}-s`} type="source" position={Position.Right}
                      style={{ right: -5, top: "50%", transform: "translateY(-50%)",
                               width: 7, height: 7, background: "#3b82f6", border: "none" }} />
              <Handle id={`${p.id}-t`} type="target" position={Position.Right}
                      style={{ right: -5, top: "50%", transform: "translateY(-50%)",
                               width: 7, height: 7, background: "#3b82f6", border: "none", opacity: 0 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── custom node: splice (junction dot) ───────────────────────────────────────

function SpliceNode({ data }: NodeProps<FlowNode<SpliceData>>) {
  return (
    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#94a3b8",
                  border: "2px solid #64748b", position: "relative" }}
         title={data.label}>
      {/* All splice handles share a center point */}
      {data.handles.map((h) => (
        <>
          <Handle key={`${h.id}-s`} id={`${h.id}-s`} type="source"
                  position={h.side === "left" ? Position.Left : Position.Right}
                  style={{ top: "50%", transform: "translateY(-50%)",
                           width: 0, height: 0, border: "none", background: "transparent" }} />
          <Handle key={`${h.id}-t`} id={`${h.id}-t`} type="target"
                  position={h.side === "left" ? Position.Left : Position.Right}
                  style={{ top: "50%", transform: "translateY(-50%)",
                           width: 0, height: 0, border: "none", background: "transparent" }} />
        </>
      ))}
    </div>
  );
}

// ── custom edge: segment colored by net ──────────────────────────────────────

interface SegmentEdgeData extends Record<string, unknown> {
  color: string;
  label?: string;
  netId?: string;
  dimmed: boolean;
}

function SegmentEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data,
}: EdgeProps<FlowEdge<SegmentEdgeData>>) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const color  = data?.color ?? "#60a5fa";
  const dimmed = data?.dimmed ?? false;

  return (
    <g style={{ opacity: dimmed ? 0.15 : 1, transition: "opacity .15s" }}>
      <path id={id} d={edgePath} stroke={color} strokeWidth={2}
            fill="none" strokeLinecap="round" />
      {data?.label && (
        <text style={{ fontSize: 9, fill: "#94a3b8", fontFamily: "inherit" }}>
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">{data.label}</textPath>
        </text>
      )}
    </g>
  );
}

// ── node types registry ───────────────────────────────────────────────────────

const nodeTypes = { device: DeviceNode, splice: SpliceNode };
const edgeTypes = { segment: SegmentEdge };

// ── builder: harness data → react-flow nodes + edges ─────────────────────────

function buildGraph(
  harness: HarnessData,
  layout: LayoutData,
  hoveredNet: string | null,
) {
  const portToNode: Record<string, string> = {};
  harness.nodes.forEach((n) => {
    harness.node_ports
      .filter((p) => p.node_ref === n.id)
      .forEach((p) => { portToNode[p.id] = n.id; });
  });

  // Map net id → net for color lookup
  const netMap: Record<string, Net> = {};
  harness.nets.forEach((n) => { netMap[n.id] = n; });

  // Determine which nets are connected to each segment endpoint (for left/right side)
  // Heuristic: put ports on left if their node is to the left of center, else right
  const allX = Object.values(layout.nodes ?? {}).map((p) => p.x);
  const midX  = allX.length ? (Math.min(...allX) + Math.max(...allX)) / 2 : 600;

  // ── nodes: devices ──
  const flowNodes: FlowNode[] = harness.nodes.map((n) => {
    const pos  = layout.nodes?.[n.id] ?? { x: 200, y: 200 };
    const nx   = pos.x;
    const side = nx < midX ? "right" : "left";

    const ports = harness.node_ports
      .filter((p) => p.node_ref === n.id)
      .map((p) => ({ id: p.id, name: p.pin_name, side }));

    return {
      id: n.id,
      type: "device",
      position: { x: nx, y: pos.y },
      data: { label: n.name, designator: n.designator, ports } as DeviceData,
      draggable: false,
    };
  });

  // ── nodes: splices ──
  // For each splice, collect connected segment ids to create handles
  const spliceHandles: Record<string, { id: string; side: "left" | "right" }[]> = {};
  harness.splices.forEach((sp) => { spliceHandles[sp.id] = []; });

  harness.segments.forEach((seg) => {
    const addHandle = (kind: string, ref: string, isFrom: boolean) => {
      if (kind !== "splice") return;
      if (!spliceHandles[ref]) spliceHandles[ref] = [];
      const spliceX  = layout.splices?.[ref]?.x ?? 500;
      // From-side segment → source handle on splice; use splice position relative to its target
      spliceHandles[ref].push({
        id: seg.id + (isFrom ? "-from" : "-to"),
        side: spliceX < midX ? "right" : "left",
      });
    };
    addHandle(seg.from.kind, seg.from.ref, true);
    addHandle(seg.to.kind, seg.to.ref, false);
  });

  harness.splices.forEach((sp) => {
    const pos = layout.splices?.[sp.id] ?? { x: 400, y: 300 };
    flowNodes.push({
      id: sp.id,
      type: "splice",
      position: { x: pos.x, y: pos.y },
      data: { label: sp.name ?? sp.id, handles: spliceHandles[sp.id] ?? [] } as SpliceData,
      draggable: false,
    });
  });

  // ── edges: segments ──
  const flowEdges: FlowEdge[] = harness.segments.map((seg) => {
    const net    = seg.net_ref ? netMap[seg.net_ref] : undefined;
    const color  = net ? resolveNetColor(net) : "#475569";
    const dimmed = hoveredNet != null && seg.net_ref !== hoveredNet;

    const getNodeId = (kind: string, ref: string) =>
      kind === "splice" ? ref : (portToNode[ref] ?? ref);

    const getHandleId = (kind: string, ref: string, isFrom: boolean, isSrc: boolean) => {
      if (kind === "splice") {
        const hid = seg.id + (isFrom ? "-from" : "-to");
        return isSrc ? `${hid}-s` : `${hid}-t`;
      }
      return isSrc ? `${ref}-s` : `${ref}-t`;
    };

    return {
      id: seg.id,
      type: "segment",
      source: getNodeId(seg.from.kind, seg.from.ref),
      sourceHandle: getHandleId(seg.from.kind, seg.from.ref, true, true),
      target: getNodeId(seg.to.kind, seg.to.ref),
      targetHandle: getHandleId(seg.to.kind, seg.to.ref, false, false),
      data: { color, label: seg.label, netId: seg.net_ref, dimmed } as SegmentEdgeData,
      animated: false,
    };
  });

  return { flowNodes, flowEdges };
}

// ── main component ────────────────────────────────────────────────────────────

export function GraphCanvas() {
  const { harness, layout, hoveredNet, setHoveredNet } = useProjectStore();

  const { flowNodes, flowEdges } = useMemo(() => {
    if (!harness || !layout) return { flowNodes: [], flowEdges: [] };
    return buildGraph(harness, layout, hoveredNet);
  }, [harness, layout, hoveredNet]);

  const [nodes, , onNodesChange] = useNodesState(flowNodes);
  const [edges, , onEdgesChange] = useEdgesState(flowEdges);

  // Keep nodes/edges in sync when data changes
  const syncedNodes = flowNodes;
  const syncedEdges = flowEdges;

  const onEdgeMouseEnter = useCallback(
    (_: React.MouseEvent, edge: FlowEdge) => {
      const netId = (edge.data as SegmentEdgeData | undefined)?.netId;
      if (netId) setHoveredNet(netId);
    },
    [setHoveredNet],
  );

  const onEdgeMouseLeave = useCallback(() => setHoveredNet(null), [setHoveredNet]);

  if (!harness) {
    return <div style={{ padding: 24, color: "#475569" }}>No harness loaded</div>;
  }

  if (!layout) {
    return <div style={{ padding: 24, color: "#475569" }}>No layout data for this harness</div>;
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={syncedNodes}
        edges={syncedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        colorMode="dark"
        style={{ background: "#0f1623" }}
      >
        <Background color="#1e2a3a" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor="#1e3a5f"
          maskColor="#0f1623cc"
          style={{ background: "#151922" }}
        />
      </ReactFlow>
    </div>
  );
}
