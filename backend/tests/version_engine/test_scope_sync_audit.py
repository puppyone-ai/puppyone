"""Affected-scope sync leaves an auditable trail (option A).

When an accepted project-root commit is projected into a NON-source scope's
head, the scope head advances via a derived projection. These tests lock in
that the projection also writes a version_transactions + audit_logs row on the
synced scope — attributed to a NEUTRAL system identity, never another scope's
auth — and that the post-commit hook wires this in best-effort.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.version_engine.derived.hooks import (
    SCOPE_VIEW_ACTOR,
    _record_scope_sync_best_effort,
)
from src.version_engine.infrastructure.supabase.history_repository import (
    SupabaseHistoryManager,
)

_A = "a" * 40
_B = "b" * 40
_C = "c" * 40


# ── Fake Supabase client ────────────────────────────────────────────


class FakeInsert:
    def __init__(self, table, store, fail_tables):
        self.table = table
        self.store = store
        self.fail_tables = fail_tables
        self._payload = None

    def insert(self, payload):
        self._payload = payload
        return self

    def execute(self):
        if self.table in self.fail_tables:
            raise RuntimeError(f"insert into {self.table} failed")
        self.store.setdefault(self.table, []).append(self._payload)
        if self.table == "version_transactions":
            return SimpleNamespace(data=[{"id": 4242}])
        return SimpleNamespace(data=[dict(self._payload)])


class FakeClient:
    def __init__(self, fail_tables=()):
        self.tables: dict = {}
        self.fail_tables = set(fail_tables)

    def table(self, name):
        return FakeInsert(name, self.tables, self.fail_tables)


class FakeSupabase:
    def __init__(self, fail_tables=()):
        self.client = FakeClient(fail_tables)


def _history(fail_tables=()):
    return SupabaseHistoryManager(FakeSupabase(fail_tables), "proj-1")


# ── record_scope_sync writes both rows ──────────────────────────────


def test_record_scope_sync_writes_transaction_and_audit():
    h = _history()
    h.record_scope_sync(
        scope_path="docs",
        committed_commit_id=_C,
        current_head_at_start=_B,
        source_commit_id=_A,
        actor=SCOPE_VIEW_ACTOR,
    )
    tables = h._client.tables
    assert len(tables["version_transactions"]) == 1
    assert len(tables["audit_logs"]) == 1

    txn = tables["version_transactions"][0]
    assert txn["scope_path"] == "docs"
    assert txn["actor"] == "puppyone-scope-view"   # neutral system identity
    assert txn["intent_type"] == "operation"        # CHECK-allowed value
    assert txn["status"] == "committed"
    assert txn["source_channel"] == "scope-sync"
    assert txn["committed_commit_id"] == _C
    assert txn["current_head_at_start"] == _B

    audit = tables["audit_logs"][0]
    assert audit["action"] == "scope_sync"
    assert audit["operator_type"] == "system"
    assert audit["operator_id"] == "puppyone-scope-view"
    assert audit["scope_path"] == "docs"
    assert audit["canonical_commit_id"] == _C
    assert audit["status"] == "committed"
    assert audit["transaction_id"] == 4242           # linked to the txn row
    assert audit["metadata"] == {"kind": "scope_sync", "source_commit_id": _A}


def test_record_scope_sync_never_uses_a_real_user_actor():
    h = _history()
    h.record_scope_sync(
        scope_path="docs", committed_commit_id=_C, current_head_at_start="",
        source_commit_id=_A, actor=SCOPE_VIEW_ACTOR,
    )
    txn = h._client.tables["version_transactions"][0]
    audit = h._client.tables["audit_logs"][0]
    # Attribution is the neutral system identity on BOTH rows — not a
    # parent/child scope's auth principal.
    assert txn["actor"] == SCOPE_VIEW_ACTOR
    assert audit["operator_id"] == SCOPE_VIEW_ACTOR
    assert audit["operator_type"] == "system"


def test_audit_still_written_when_transaction_insert_fails():
    # version_transactions insert blows up; the audit row must still land
    # (best-effort, no transaction_id linkage), and no exception escapes.
    h = _history(fail_tables=("version_transactions",))
    h.record_scope_sync(
        scope_path="docs", committed_commit_id=_C, current_head_at_start=_B,
        source_commit_id=_A, actor=SCOPE_VIEW_ACTOR,
    )
    assert "version_transactions" not in h._client.tables
    audit = h._client.tables["audit_logs"][0]
    assert audit["action"] == "scope_sync"
    assert "transaction_id" not in audit             # no linkage when txn failed


def test_record_scope_sync_swallows_audit_failure():
    h = _history(fail_tables=("version_transactions", "audit_logs"))
    # must not raise even if both inserts fail
    h.record_scope_sync(
        scope_path="docs", committed_commit_id=_C, current_head_at_start=_B,
        source_commit_id=_A, actor=SCOPE_VIEW_ACTOR,
    )


# ── hook helper wiring ──────────────────────────────────────────────


def test_hook_helper_calls_record_with_system_actor():
    calls = []
    repo = SimpleNamespace(record_scope_sync=lambda **kw: calls.append(kw))
    _record_scope_sync_best_effort(
        repo, scope_path="docs", committed_commit_id=_C,
        current_head_at_start=_B, source_commit_id=_A,
    )
    assert len(calls) == 1
    assert calls[0]["actor"] == SCOPE_VIEW_ACTOR
    assert calls[0]["scope_path"] == "docs"
    assert calls[0]["committed_commit_id"] == _C


def test_hook_helper_noop_when_backend_lacks_method():
    repo = SimpleNamespace()  # no record_scope_sync attribute
    # must not raise
    _record_scope_sync_best_effort(
        repo, scope_path="docs", committed_commit_id=_C,
        current_head_at_start=_B, source_commit_id=_A,
    )


def test_hook_helper_swallows_backend_exception():
    def boom(**_kw):
        raise RuntimeError("db down")

    repo = SimpleNamespace(record_scope_sync=boom)
    # must not raise — the scope head already advanced; audit is best-effort
    _record_scope_sync_best_effort(
        repo, scope_path="docs", committed_commit_id=_C,
        current_head_at_start=_B, source_commit_id=_A,
    )
