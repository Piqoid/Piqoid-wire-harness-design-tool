"""Load and save a harness project from/to a directory structure."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..models.bus import Bus
from ..models.bundle import Bundle
from ..models.cable import Cable
from ..models.link import Link
from ..models.net import Net
from ..models.node import Node, NodePort
from ..models.pair import DifferentialPair
from ..models.project import ProjectMeta
from ..models.segment import Segment
from ..models.splice import Splice
from .serialization import canonical_dump, canonical_dumps, canonical_load


class HarnessProject:
    """In-memory representation of a loaded project."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.meta: ProjectMeta | None = None
        self.harnesses: dict[str, "HarnessData"] = {}

    @classmethod
    def load(cls, root: Path) -> "HarnessProject":
        root = Path(root)
        proj = cls(root)
        project_json = root / "project.json"
        if not project_json.exists():
            raise FileNotFoundError(f"project.json not found in {root}")
        raw = canonical_load(project_json)
        proj.meta = ProjectMeta.model_validate(raw)

        harness_dir = root / "harness"
        if harness_dir.exists():
            for hdir in sorted(harness_dir.iterdir()):
                if hdir.is_dir():
                    proj.harnesses[hdir.name] = HarnessData.load(hdir)
        return proj

    def save(self) -> None:
        """Save all project data back to disk."""
        canonical_dump(
            json.loads(self.meta.model_dump_json(by_alias=True, exclude_none=True)),
            self.root / "project.json",
        )
        for name, harness in self.harnesses.items():
            harness.save(self.root / "harness" / name)

    def fmt(self) -> list[Path]:
        """Re-write all files in canonical form. Returns list of modified paths."""
        modified = []
        # project.json
        p = self.root / "project.json"
        original = p.read_text(encoding="utf-8")
        raw = canonical_load(p)
        new_text = canonical_dumps(raw)
        if original != new_text:
            p.write_text(new_text, encoding="utf-8")
            modified.append(p)
        # harness files
        harness_dir = self.root / "harness"
        if harness_dir.exists():
            for f in sorted(harness_dir.rglob("*.json")):
                if f.name == "layout.json":
                    continue
                original = f.read_text(encoding="utf-8")
                raw = canonical_load(f)
                new_text = canonical_dumps(raw)
                if original != new_text:
                    f.write_text(new_text, encoding="utf-8")
                    modified.append(f)
        return modified


class HarnessData:
    """All entity data for one harness folder."""

    ENTITY_FILES = [
        "nodes", "node_ports", "nets", "segments",
        "cables", "bundles", "buses", "pairs", "links", "splices",
    ]

    def __init__(self):
        self.nodes: list[Node] = []
        self.node_ports: list[NodePort] = []
        self.nets: list[Net] = []
        self.segments: list[Segment] = []
        self.cables: list[Cable] = []
        self.bundles: list[Bundle] = []
        self.buses: list[Bus] = []
        self.pairs: list[DifferentialPair] = []
        self.links: list[Link] = []
        self.splices: list[Splice] = []

    @classmethod
    def load(cls, hdir: Path) -> "HarnessData":
        data = cls()
        loaders = {
            "nodes": (Node, "nodes"),
            "node_ports": (NodePort, "node_ports"),
            "nets": (Net, "nets"),
            "segments": (Segment, "segments"),
            "cables": (Cable, "cables"),
            "bundles": (Bundle, "bundles"),
            "buses": (Bus, "buses"),
            "pairs": (DifferentialPair, "pairs"),
            "links": (Link, "links"),
            "splices": (Splice, "splices"),
        }
        for fname, (model_cls, attr) in loaders.items():
            fpath = hdir / f"{fname}.json"
            if fpath.exists():
                raw = canonical_load(fpath)
                items = raw if isinstance(raw, list) else raw.get(fname, [])
                parsed = [model_cls.model_validate(item) for item in items]
                setattr(data, attr, parsed)
        return data

    def save(self, hdir: Path) -> None:
        hdir.mkdir(parents=True, exist_ok=True)
        writers = {
            "nodes": self.nodes,
            "node_ports": self.node_ports,
            "nets": self.nets,
            "segments": self.segments,
            "cables": self.cables,
            "bundles": self.bundles,
            "buses": self.buses,
            "pairs": self.pairs,
            "links": self.links,
            "splices": self.splices,
        }
        for fname, entities in writers.items():
            if entities:
                items = [json.loads(e.model_dump_json(by_alias=True, exclude_none=True)) for e in entities]
                canonical_dump(items, hdir / f"{fname}.json")

    def all_entities_by_id(self) -> dict[str, Any]:
        """Build {id: entity} index across all collections."""
        index: dict[str, Any] = {}
        for collection in [
            self.nodes, self.node_ports, self.nets, self.segments,
            self.cables, self.bundles, self.buses, self.pairs,
            self.links, self.splices,
        ]:
            for e in collection:
                index[e.id] = e
        return index
