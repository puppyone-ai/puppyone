"""GAP-10: shadow snapshots need a TTL reaper.

Without one, ``local_shadow_snapshots`` rows + their S3 ``manifest.json``
objects accumulate forever. These tests lock in that the reaper deletes
only snapshots older than the TTL (by ``updated_at``), removes both the
S3 manifest and the DB row, and leaves fresh snapshots untouched.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import src.version_engine.entrypoints.http.shadow_snapshot as ss


class FakeQuery:
    def __init__(self, store):
        self.store = store
        self.op = "select"
        self._lt = None
        self._in = None
        self._limit = None

    def select(self, _cols):
        self.op = "select"
        return self

    def delete(self):
        self.op = "delete"
        return self

    def lt(self, col, val):
        self._lt = (col, val)
        return self

    def in_(self, col, vals):
        self._in = (col, set(vals))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _match(self, row):
        if self._lt is not None:
            col, val = self._lt
            if not (str(row.get(col)) < str(val)):
                return False
        if self._in is not None:
            col, vals = self._in
            if row.get(col) not in vals:
                return False
        return True

    def execute(self):
        rows = self.store.rows
        matched = [r for r in rows if self._match(r)]
        if self.op == "delete":
            self.store.rows = [r for r in rows if not self._match(r)]
            return SimpleNamespace(data=matched)
        if self._limit is not None:
            matched = matched[: self._limit]
        return SimpleNamespace(data=matched)


class FakeTables:
    def __init__(self, rows):
        self.rows = rows

    def table(self, _name):
        return FakeQuery(self)


class FakeSupabase:
    def __init__(self, rows):
        self.client = FakeTables(rows)


class FakeS3:
    def __init__(self):
        self.deleted = []

    async def delete_file(self, key):
        self.deleted.append(key)


@pytest.fixture
def patched(monkeypatch):
    rows = [
        {"id": "old1", "project_id": "p1", "updated_at": "2020-01-01T00:00:00+00:00"},
        {"id": "old2", "project_id": "p2", "updated_at": "2020-06-01T00:00:00+00:00"},
        {"id": "fresh", "project_id": "p3", "updated_at": "2099-01-01T00:00:00+00:00"},
    ]
    supa = FakeSupabase(rows)
    s3 = FakeS3()
    monkeypatch.setattr(ss, "SupabaseClient", lambda: supa)
    monkeypatch.setattr(ss, "get_s3_service_instance", lambda: s3)
    return supa, s3, rows


@pytest.mark.asyncio
async def test_reaper_deletes_only_stale_snapshots(patched):
    supa, s3, _rows = patched

    result = await ss.reap_stale_shadow_snapshots(ttl_seconds=24 * 3600)

    assert result["deleted"] == 2
    # fresh snapshot survives in the DB
    remaining_ids = {r["id"] for r in supa.client.rows}
    assert remaining_ids == {"fresh"}
    # both stale manifests were removed from S3
    assert s3.deleted == [
        ss._manifest_s3_key("p1", "old1"),
        ss._manifest_s3_key("p2", "old2"),
    ]


@pytest.mark.asyncio
async def test_reaper_noop_when_nothing_stale(monkeypatch):
    rows = [{"id": "fresh", "project_id": "p", "updated_at": "2099-01-01T00:00:00+00:00"}]
    supa = FakeSupabase(rows)
    s3 = FakeS3()
    monkeypatch.setattr(ss, "SupabaseClient", lambda: supa)
    monkeypatch.setattr(ss, "get_s3_service_instance", lambda: s3)

    result = await ss.reap_stale_shadow_snapshots(ttl_seconds=3600)

    assert result == {"scanned": 0, "deleted": 0}
    assert s3.deleted == []
    assert len(supa.client.rows) == 1


@pytest.mark.asyncio
async def test_reaper_respects_max_per_run(patched):
    supa, s3, _rows = patched
    result = await ss.reap_stale_shadow_snapshots(ttl_seconds=24 * 3600, max_per_run=1)
    # only one stale row processed this run; the other remains for next run
    assert result["scanned"] == 1
    assert result["deleted"] == 1
    assert len(s3.deleted) == 1
