"""Net graph builder: nets -> segments -> connectivity, rooting for current flow."""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Optional

from ..models.net import Net
from ..models.node import NodePort
from ..models.segment import Segment


@dataclass
class NetGraph:
    """Adjacency representation of one net's segments."""
    net_id: str
    # Nodes are endpoint refs (port id, splice id, etc.)
    # Edges are segment ids
    adjacency: dict[str, list[tuple[str, str]]] = field(default_factory=lambda: defaultdict(list))
    # seg_id -> (from_ref, to_ref)
    segments: dict[str, tuple[str, str]] = field(default_factory=dict)
    # port ref -> NodePort
    member_ports: dict[str, NodePort] = field(default_factory=dict)

    def add_segment(self, seg: Segment) -> None:
        from_ref = seg.from_.ref
        to_ref = seg.to.ref
        self.adjacency[from_ref].append((to_ref, seg.id))
        self.adjacency[to_ref].append((from_ref, seg.id))
        self.segments[seg.id] = (from_ref, to_ref)

    def endpoints(self) -> set[str]:
        return set(self.adjacency.keys())

    def is_connected(self) -> bool:
        """True if all member port refs are reachable in the segment graph."""
        member_refs = set(self.member_ports.keys())
        if not member_refs:
            return True
        # BFS from any member ref
        all_nodes = self.endpoints() | member_refs
        if not all_nodes:
            return True
        start = next(iter(all_nodes))
        visited = {start}
        queue = deque([start])
        while queue:
            node = queue.popleft()
            for neighbor, _ in self.adjacency.get(node, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        return member_refs.issubset(visited)

    def unreachable_members(self) -> set[str]:
        """Return member port refs not reachable from the rest of the graph."""
        member_refs = set(self.member_ports.keys())
        if not member_refs:
            return set()
        all_nodes = self.endpoints() | member_refs
        if not all_nodes:
            return set()
        # BFS from any node that appears in the adjacency graph
        anchor = next((n for n in all_nodes if n in self.adjacency), None)
        if anchor is None:
            # No segments at all: all members unreachable unless there's exactly 1
            return member_refs if len(member_refs) > 1 else set()
        visited = {anchor}
        queue = deque([anchor])
        while queue:
            node = queue.popleft()
            for neighbor, _ in self.adjacency.get(node, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        return member_refs - visited

    def current_load_per_segment(self, source_port_ref: str, port_draws: dict[str, float]) -> dict[str, float]:
        """
        Compute expected current for each segment by summing sink draws downstream.
        port_draws: {port_ref: i_draw_max_a} for all sink ports.
        Returns {seg_id: current_a}.
        """
        if source_port_ref not in self.adjacency and source_port_ref not in self.member_ports:
            return {}

        # BFS tree rooted at source, track parent segment for each node
        visited: dict[str, Optional[str]] = {source_port_ref: None}  # node -> parent_seg_id
        queue = deque([source_port_ref])
        children: dict[str, list[str]] = defaultdict(list)  # node -> [child_nodes]
        node_to_seg: dict[str, str] = {}  # child_node -> seg_id leading to it from parent

        while queue:
            node = queue.popleft()
            for neighbor, seg_id in self.adjacency.get(node, []):
                if neighbor not in visited:
                    visited[neighbor] = seg_id
                    children[node].append(neighbor)
                    node_to_seg[neighbor] = seg_id
                    queue.append(neighbor)

        # Compute subtree current sums bottom-up
        subtree_draw: dict[str, float] = {}
        # Process nodes in reverse BFS order
        order = list(visited.keys())
        for node in reversed(order):
            draw = port_draws.get(node, 0.0)
            for child in children.get(node, []):
                draw += subtree_draw.get(child, 0.0)
            subtree_draw[node] = draw

        # Map subtree draw to segments: a segment carries the draw of its downstream node
        seg_current: dict[str, float] = {}
        for node, seg_id in node_to_seg.items():
            seg_current[seg_id] = subtree_draw.get(node, 0.0)

        return seg_current

    def cumulative_path_value(
        self, source_port_ref: str, seg_value: dict[str, float],
    ) -> dict[str, float]:
        """BFS from source; for each reachable node, sum seg_value[seg_id] over every
        segment on that node's unique tree path from the source. Used by P-002 to
        accumulate per-segment (resistance x current) contributions along a path."""
        if source_port_ref not in self.adjacency and source_port_ref not in self.member_ports:
            return {}
        cumulative: dict[str, float] = {source_port_ref: 0.0}
        queue = deque([source_port_ref])
        while queue:
            node = queue.popleft()
            for neighbor, seg_id in self.adjacency.get(node, []):
                if neighbor not in cumulative:
                    cumulative[neighbor] = cumulative[node] + seg_value.get(seg_id, 0.0)
                    queue.append(neighbor)
        return cumulative


def build_net_graphs(
    nets: list[Net],
    segments: list[Segment],
    node_ports: list[NodePort],
) -> dict[str, NetGraph]:
    """Build one NetGraph per net."""
    port_index = {p.id: p for p in node_ports}
    # Group segments by net
    segs_by_net: dict[str, list[Segment]] = defaultdict(list)
    for seg in segments:
        if seg.net_ref:
            segs_by_net[seg.net_ref].append(seg)

    graphs: dict[str, NetGraph] = {}
    for net in nets:
        g = NetGraph(net_id=net.id)
        for port_ref in net.members:
            if port_ref in port_index:
                g.member_ports[port_ref] = port_index[port_ref]
        for seg in segs_by_net.get(net.id, []):
            g.add_segment(seg)
        graphs[net.id] = g

    return graphs
