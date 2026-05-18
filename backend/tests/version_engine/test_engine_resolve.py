"""Tests for GitNativeTransactionEngine.resolve(ConflictResolutionIntent).

Covers:
  * happy path: accept a resolution tree → row marked resolved with the
    new commit_id.
  * reject path: row marked rejected, no commit, no scope-head advance.
  * unknown pending_conflict_id → ValueError.
  * already-non-pending row (idempotency) → ValueError.
  * resolution that itself returns ``pending`` does NOT lie to the
    ledger by marking the original row ``resolved`` (Bug 1 fix).

The tests run against the in-memory PuppyOneServerRepo fixture from
``test_server_repo`` to avoid Supabase. The supabase shim helpers
(_load_pending_conflict_row / _close_pending_conflict_row /
_mark_pending_conflict_row) are monkey-patched so we can drive the
flow without a real database.
"""

from __future__ import annotations

import threading

import pytest

from src.version_engine.application import transaction_engine as engine_mod
from src.version_engine.application.transaction_engine import (
    GitNativeTransactionEngine,
)
from src.version_engine.application.tree_objects import build_tree_from_files
from src.version_engine.domain.intents import ConflictResolutionIntent
from src.version_engine.domain.intents import TransactionResult


class _FakeConflictTable:
    """In-memory stand-in for the persistent conflict table.

    Exposed via monkeypatched ``_load_pending_conflict_row`` /
    ``_mark_pending_conflict_row`` / ``_close_pending_conflict_row``.
    Records every transition so tests can assert the final state.
    """

    def __init__(self):
        self._rows: dict[tuple[str, str], dict] = {}
        self._lock = threading.Lock()

    def seed(self, *, project_id: str, pending_conflict_id: str, **fields) -> None:
        row = {
            "pending_conflict_id": pending_conflict_id,
            "project_id": project_id,
            "status": "pending",
            "scope_path": fields.get("scope_path", ""),
            "current_commit_id": fields.get("current_commit_id", ""),
            "base_commit_id": fields.get("base_commit_id", ""),
            "client_commit_id": fields.get("client_commit_id", ""),
            "proposed_tree_id": fields.get("proposed_tree_id", ""),
            "resolver_actor": "",
            "resolution_commit_id": "",
            "resolution_detail": {},
        }
        with self._lock:
            self._rows[(project_id, pending_conflict_id)] = row

    def load(self, project_id: str, pending_conflict_id: str) -> dict | None:
        with self._lock:
            row = self._rows.get((project_id, pending_conflict_id))
            return dict(row) if row else None

    def mark(self, *, project_id, pending_conflict_id, status, resolver_actor):
        with self._lock:
            row = self._rows[(project_id, pending_conflict_id)]
            row["status"] = status
            row["resolver_actor"] = resolver_actor

    def close(self, *, project_id, pending_conflict_id, status, resolver_actor,
              resolution_commit_id, resolution_detail):
        with self._lock:
            row = self._rows[(project_id, pending_conflict_id)]
            row["status"] = status
            row["resolver_actor"] = resolver_actor
            row["resolution_commit_id"] = resolution_commit_id
            row["resolution_detail"] = resolution_detail


@pytest.fixture
def conflict_table(monkeypatch) -> _FakeConflictTable:
    table = _FakeConflictTable()
    monkeypatch.setattr(engine_mod, "_load_pending_conflict_row",
                        lambda pid, pcid: table.load(pid, pcid))
    monkeypatch.setattr(engine_mod, "_mark_pending_conflict_row", table.mark)
    monkeypatch.setattr(engine_mod, "_close_pending_conflict_row", table.close)
    return table


# ── happy paths ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_accept_marks_resolved_with_commit(
    repo_manager, server_repo, conflict_table,
):
    """Accept-path: resolve(...) re-enters publish, lands a commit, and
    closes the pending row with status=resolved + commit_id set."""
    # Seed an initial commit so subsequent resolve has a non-empty base.
    init_tree = build_tree_from_files(server_repo.store, {"a.txt": b"v0"})
    base_intent = await _publish_initial(server_repo, repo_manager, init_tree)
    current_head = base_intent.commit_id

    conflict_table.seed(
        project_id="test-proj",
        pending_conflict_id="abc",
        scope_path="",
        current_commit_id=current_head,
    )

    resolution_tree = build_tree_from_files(
        server_repo.store, {"a.txt": b"v1-resolved"},
    )

    engine = GitNativeTransactionEngine(repo_manager)
    result = await engine.resolve(ConflictResolutionIntent(
        project_id="test-proj",
        pending_conflict_id="abc",
        scope_path="",
        resolver_actor="user:reviewer",
        source_channel="papi",
        resolution_tree_id=resolution_tree,
        resolution_message="approved by reviewer",
    ))

    assert result.status == "ok"
    assert result.commit_id
    row = conflict_table.load("test-proj", "abc")
    assert row["status"] == "resolved"
    assert row["resolution_commit_id"] == result.commit_id
    assert row["resolver_actor"] == "user:reviewer"


@pytest.mark.asyncio
async def test_resolve_reject_marks_rejected_without_publish(
    repo_manager, server_repo, conflict_table,
):
    """Reject-path: leave scope head alone, mark the row rejected."""
    init_tree = build_tree_from_files(server_repo.store, {"a.txt": b"v0"})
    base = await _publish_initial(server_repo, repo_manager, init_tree)
    head_before = server_repo.get_scope_head_commit_id("")
    assert head_before == base.commit_id

    conflict_table.seed(
        project_id="test-proj",
        pending_conflict_id="abc",
        scope_path="",
        current_commit_id=head_before,
    )

    engine = GitNativeTransactionEngine(repo_manager)
    result = await engine.resolve(ConflictResolutionIntent(
        project_id="test-proj",
        pending_conflict_id="abc",
        scope_path="",
        resolver_actor="user:reviewer",
        source_channel="papi",
        decision="reject",
        resolution_message="superseded by mainline",
    ))

    assert result.status == "rejected"
    assert result.commit_id == ""
    row = conflict_table.load("test-proj", "abc")
    assert row["status"] == "rejected"
    # Scope head is untouched.
    assert server_repo.get_scope_head_commit_id("") == head_before


# ── invariant paths ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_unknown_pending_id_raises(
    repo_manager, conflict_table,
):
    engine = GitNativeTransactionEngine(repo_manager)
    with pytest.raises(ValueError, match="not found"):
        await engine.resolve(ConflictResolutionIntent(
            project_id="test-proj",
            pending_conflict_id="does-not-exist",
            scope_path="",
            resolver_actor="user:a",
            source_channel="papi",
            resolution_tree_id="x",
        ))


@pytest.mark.asyncio
async def test_resolve_already_resolved_row_raises(
    repo_manager, conflict_table,
):
    conflict_table.seed(
        project_id="test-proj", pending_conflict_id="abc", scope_path="",
    )
    # Force the row into a non-pending state first.
    conflict_table.close(
        project_id="test-proj", pending_conflict_id="abc",
        status="resolved", resolver_actor="user:x",
        resolution_commit_id="prev", resolution_detail={},
    )

    engine = GitNativeTransactionEngine(repo_manager)
    with pytest.raises(ValueError, match="not pending"):
        await engine.resolve(ConflictResolutionIntent(
            project_id="test-proj",
            pending_conflict_id="abc",
            scope_path="",
            resolver_actor="user:reviewer",
            source_channel="papi",
            resolution_tree_id="x",
        ))


@pytest.mark.asyncio
async def test_resolve_accept_requires_tree_or_files(
    repo_manager, conflict_table,
):
    conflict_table.seed(
        project_id="test-proj", pending_conflict_id="abc", scope_path="",
    )
    engine = GitNativeTransactionEngine(repo_manager)
    with pytest.raises(ValueError, match="resolution_tree_id or resolution_files"):
        await engine.resolve(ConflictResolutionIntent(
            project_id="test-proj",
            pending_conflict_id="abc",
            scope_path="",
            resolver_actor="user:reviewer",
            source_channel="papi",
        ))


# ── Bug 1 regression: pending-on-resolution must not mark resolved ───


@pytest.mark.asyncio
async def test_resolve_landing_pending_keeps_row_resolving(
    repo_manager, server_repo, conflict_table, monkeypatch,
):
    """If the resolution itself lands as ``pending`` (rare race: a fresh
    concurrent write between conflict-record-time and resolve-time), the
    original pending row must NOT be marked ``resolved`` with empty
    commit_id. It stays in ``resolving`` so a follow-up resolution can
    re-close it."""
    init_tree = build_tree_from_files(server_repo.store, {"a.txt": b"v0"})
    base = await _publish_initial(server_repo, repo_manager, init_tree)

    conflict_table.seed(
        project_id="test-proj",
        pending_conflict_id="abc",
        scope_path="",
        current_commit_id=base.commit_id,
    )

    # Force the resolution submission to return a ``pending`` outcome.
    async def fake_submit(self, intent, started_ms=None):
        return TransactionResult(
            status="pending",
            merged=False,
            conflicts=2,
            pending_conflict_id="new-pending-xyz",
            reason="manual_review_required",
        )
    monkeypatch.setattr(
        GitNativeTransactionEngine,
        "_submit_version_optimistic",
        fake_submit,
    )

    engine = GitNativeTransactionEngine(repo_manager)
    result = await engine.resolve(ConflictResolutionIntent(
        project_id="test-proj",
        pending_conflict_id="abc",
        scope_path="",
        resolver_actor="user:reviewer",
        source_channel="papi",
        resolution_tree_id="dummy",
        resolution_message="attempted resolve",
    ))

    assert result.status == "pending"
    row = conflict_table.load("test-proj", "abc")
    # Critical: original row stays in resolving, NOT marked resolved.
    assert row["status"] == "resolving"
    assert row["resolution_commit_id"] == ""
    # The follow-up pending id is recorded so the resolver UI can chain.
    detail = row["resolution_detail"]
    assert detail.get("follow_up_pending_conflict_id") == "new-pending-xyz"


# ── helpers ──────────────────────────────────────────────────


async def _publish_initial(server_repo, repo_manager, tree_id):
    """Publish an initial commit so subsequent resolves have a real head."""
    from src.version_engine.adapters.git.submission import submit_git_tree

    commit_id = _make_client_commit(server_repo, tree_id, message="init")
    return await submit_git_tree(
        repo_manager,
        project_id="test-proj",
        scope_path="",
        actor="git:init",
        base_commit_id="",
        proposed_tree_id=tree_id,
        client_commit_id=commit_id,
        message="init",
    )


def _make_client_commit(server_repo, tree_id, message="msg", parent_id=""):
    from src.version_engine.application.git_commit import build_git_commit
    return build_git_commit(
        server_repo,
        tree_sha=tree_id,
        parent_sha=parent_id or "",
        who="git:test",
        message=message,
        created_at_iso="2026-05-16T00:00:00Z",
    )
