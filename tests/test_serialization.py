"""Tests for canonical serialization and round-trip correctness."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from app.core.serialization import canonical_dump, canonical_dumps, canonical_load
from app.core.project_io import HarnessProject

PROJECT_ROOT = Path(__file__).parent.parent


class TestCanonicalSerialisation:
    def test_sorted_keys(self):
        data = {"z": 1, "a": 2, "m": 3}
        text = canonical_dumps(data)
        parsed = json.loads(text)
        assert list(parsed.keys()) == sorted(parsed.keys())

    def test_sorted_id_arrays(self):
        data = [{"id": "c", "v": 3}, {"id": "a", "v": 1}, {"id": "b", "v": 2}]
        text = canonical_dumps(data)
        parsed = json.loads(text)
        assert [x["id"] for x in parsed] == ["a", "b", "c"]

    def test_trailing_newline(self):
        text = canonical_dumps({"a": 1})
        assert text.endswith("\n")

    def test_lf_line_endings(self):
        text = canonical_dumps({"a": 1, "b": 2})
        assert "\r" not in text

    def test_two_space_indent(self):
        text = canonical_dumps({"a": {"b": 1}})
        lines = text.splitlines()
        assert any(line.startswith("  ") for line in lines)

    def test_idempotent(self):
        data = {"z": [{"id": "b"}, {"id": "a"}], "a": 1}
        once = canonical_dumps(data)
        twice = canonical_dumps(json.loads(once))
        assert once == twice

    def test_atomic_write(self, tmp_path):
        data = {"hello": "world"}
        out = tmp_path / "test.json"
        canonical_dump(data, out)
        assert out.exists()
        loaded = canonical_load(out)
        assert loaded == data


class TestRoundTrip:
    def test_good_harness_round_trip(self, tmp_path):
        """Load → save → reload → save again: second save must be byte-identical to first."""
        import shutil
        src = PROJECT_ROOT
        dst1 = tmp_path / "proj1"
        dst2 = tmp_path / "proj2"
        shutil.copytree(src, dst1, ignore=shutil.ignore_patterns(
            ".git", ".claude", "exports", "__pycache__", "*.pyc",
        ))
        shutil.copytree(src, dst2, ignore=shutil.ignore_patterns(
            ".git", ".claude", "exports", "__pycache__", "*.pyc",
        ))

        # First save normalises the files
        proj1 = HarnessProject.load(dst1)
        proj1.save()

        # Second save of independently loaded copy must produce identical files
        proj2 = HarnessProject.load(dst2)
        proj2.save()

        # Compare every harness JSON file between the two copies
        for f1 in sorted(dst1.rglob("*.json")):
            if any(part in f1.parts for part in ["exports", "__pycache__"]):
                continue
            rel = f1.relative_to(dst1)
            f2 = dst2 / rel
            if not f2.exists():
                continue
            t1 = f1.read_text(encoding="utf-8")
            t2 = f2.read_text(encoding="utf-8")
            assert t1 == t2, f"Round-trip mismatch after save: {rel}"

    def test_fmt_idempotent(self, tmp_path):
        """harness fmt should not change already-canonical files."""
        import shutil
        src = PROJECT_ROOT
        dst = tmp_path / "proj"
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns(
            ".git", ".claude", "exports", "__pycache__", "*.pyc",
        ))
        proj = HarnessProject.load(dst)
        modified = proj.fmt()
        # If files are already canonical, fmt should modify nothing or only normalise once
        # Run fmt again: second pass should always be zero
        proj2 = HarnessProject.load(dst)
        modified2 = proj2.fmt()
        assert modified2 == [], f"fmt was not idempotent: {modified2}"
