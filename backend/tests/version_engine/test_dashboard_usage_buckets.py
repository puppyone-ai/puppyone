"""GAP-8: dashboard usage buckets must aggregate every AP family's run log.

Sync/filesystem connectors record runs in ``connector_runs`` (which the
SyncRunRepository write path was previously mis-targeting at the renamed-
away ``sync_runs`` table); scheduled agents record in
``agent_execution_logs``. The dashboard now unions both, keyed by AP id.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from src.platform.project.dashboard_router import _fetch_usage_buckets


class FakeTable:
    def __init__(self, rows):
        self._rows = rows
        self._col = None
        self._ids = set()
        self._since = ""

    def select(self, _cols):
        return self

    def in_(self, col, ids):
        self._col = col
        self._ids = set(ids)
        return self

    def gte(self, _col, val):
        self._since = val
        return self

    def execute(self):
        out = [
            r for r in self._rows
            if r.get(self._col) in self._ids
            and str(r.get("started_at", "")) >= self._since
        ]
        return SimpleNamespace(data=out)


class FakeSB:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return FakeTable(self.tables.get(name, []))


def _today_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def test_usage_buckets_union_connector_and_agent_runs():
    today = _today_iso()
    sb = FakeSB({
        "connector_runs": [
            {"connector_id": "conn1", "started_at": today},
            {"connector_id": "conn1", "started_at": today},
        ],
        "agent_execution_logs": [
            {"agent_id": "agent1", "started_at": today},
            {"agent_id": "agent1", "started_at": today},
            {"agent_id": "agent1", "started_at": today},
        ],
    })

    buckets = _fetch_usage_buckets(sb, ["conn1", "agent1", "mcp1"])

    # last bucket = today
    assert buckets["conn1"][-1] == 2
    assert buckets["agent1"][-1] == 3
    # mcp has no run-log source → stays zero
    assert sum(buckets["mcp1"]) == 0


def test_usage_buckets_one_failing_source_does_not_zero_other():
    today = _today_iso()

    class BoomTable(FakeTable):
        def execute(self):
            raise RuntimeError("relation does not exist")

    class PartialSB(FakeSB):
        def table(self, name):
            if name == "agent_execution_logs":
                return BoomTable([])
            return super().table(name)

    sb = PartialSB({
        "connector_runs": [{"connector_id": "conn1", "started_at": today}],
    })

    buckets = _fetch_usage_buckets(sb, ["conn1"])
    # connector_runs still counted despite agent_execution_logs erroring
    assert buckets["conn1"][-1] == 1


def test_usage_buckets_empty_ap_ids():
    assert _fetch_usage_buckets(FakeSB({}), []) == {}
