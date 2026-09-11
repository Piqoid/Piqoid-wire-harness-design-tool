"""Tests for the migration framework."""
from __future__ import annotations

import pytest

from app.core.migration import CURRENT_SCHEMA_VERSION, migrate


class TestMigration:
    def test_no_op_at_current_version(self):
        """Data at current version is returned unchanged."""
        data = {"schema_version": CURRENT_SCHEMA_VERSION, "foo": "bar"}
        result = migrate(data, "project", target_version=CURRENT_SCHEMA_VERSION)
        assert result["schema_version"] == CURRENT_SCHEMA_VERSION

    def test_migration_v1_to_v2(self):
        """v1 project data is migrated to v2 via registered migration."""
        data = {"schema_version": 1, "id": "proj_test"}
        result = migrate(data, "project", target_version=2)
        assert result["schema_version"] == 2

    def test_refuses_future_version(self):
        """Files newer than the tool knows should raise ValueError."""
        data = {"schema_version": 9999}
        with pytest.raises(ValueError, match="newer than tool supports"):
            migrate(data, "project", target_version=CURRENT_SCHEMA_VERSION)

    def test_migration_for_harness_files(self):
        """All harness file types have a v1->v2 migration registered."""
        ftypes = ["nodes", "nets", "segments", "cables", "bundles",
                  "buses", "pairs", "links", "splices", "node_ports"]
        for ftype in ftypes:
            data = {"schema_version": 1}
            result = migrate(data, ftype, target_version=2)
            assert result["schema_version"] == 2, f"Migration failed for {ftype}"
