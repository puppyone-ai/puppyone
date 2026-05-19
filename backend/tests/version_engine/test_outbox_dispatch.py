"""Tests for the V1 outbox-worker event dispatch (B13b).

The outbox now carries two event types:

  * ``version_committed`` — handled by ``run_post_push_hook`` exactly
    as before; covered by the engine's existing tests.
  * ``pending_conflict_created`` — handed off to a registered hook for
    hosted-agent dispatch. The default is a no-op log.

These tests stub out the supabase claim/complete/fail RPCs so we can
drive the dispatch logic deterministically.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from src.version_engine.infrastructure.supabase.db_names import (
    CLAIM_OUTBOX_RPC,
    COMPLETE_OUTBOX_RPC,
    FAIL_OUTBOX_RPC,
)
from src.version_engine.derived import outbox as version_outbox


@pytest.fixture(autouse=True)
def _reset_pending_hook():
    """Make sure each test starts with the default no-op hook."""
    version_outbox.register_pending_conflict_hook(None)
    yield
    version_outbox.register_pending_conflict_hook(None)


def _fake_client(rows: list[dict[str, Any]]) -> MagicMock:
    """Build a supabase-py-shaped fake that the worker can drive."""

    client = MagicMock()
    # The outbox claim RPC returns the rows once, then nothing.
    seen = {"called": False}

    def _rpc(fn_name: str, _args=None):
        if fn_name == CLAIM_OUTBOX_RPC:
            execute = MagicMock()
            execute.execute.return_value = MagicMock(
                data=rows if not seen["called"] else [],
            )
            seen["called"] = True
            return execute
        # complete / fail return empty data; we don't inspect the body.
        execute = MagicMock()
        execute.execute.return_value = MagicMock(data=[])
        return execute

    client.rpc.side_effect = _rpc
    return client


@pytest.fixture(autouse=True)
def _enable_outbox(monkeypatch):
    """The worker is feature-flagged; force it on for these tests."""
    import src.version_engine.derived.outbox as mod
    monkeypatch.setattr(mod.settings, "VERSION_OUTBOX_ENABLED", True)


# ── pending_conflict_created dispatch ─────────────────────────


def test_pending_event_triggers_registered_hook(monkeypatch):
    """A pending_conflict_created row routes the full row to the hook."""

    seen_rows: list[dict] = []

    def hook(row):
        seen_rows.append(row)

    version_outbox.register_pending_conflict_hook(hook)

    rows = [{
        "id": 7,
        "project_id": "proj_a",
        "commit_id": "",
        "event_type": "pending_conflict_created",
        "payload": {
            "pending_conflict_id": "pc_abc",
            "scope_path": "docs",
            "policy": "manual_review",
        },
        "attempts": 0,
    }]
    processed = version_outbox.process_version_outbox_batch(
        repo_manager=MagicMock(),
        client=_fake_client(rows),
    )
    assert processed == 1
    assert len(seen_rows) == 1
    assert seen_rows[0]["payload"]["pending_conflict_id"] == "pc_abc"


def test_pending_event_no_hook_is_a_no_op(monkeypatch):
    """Without a registered hook, the worker logs and marks complete."""
    # version_committed handler would be called for the other branch;
    # make sure we DON'T accidentally invoke it.
    monkeypatch.setattr(
        version_outbox, "run_post_push_hook",
        MagicMock(side_effect=AssertionError("must not be called")),
    )
    rows = [{
        "id": 11,
        "project_id": "proj_a",
        "commit_id": "",
        "event_type": "pending_conflict_created",
        "payload": {"pending_conflict_id": "pc_xyz", "scope_path": ""},
        "attempts": 0,
    }]
    processed = version_outbox.process_version_outbox_batch(
        repo_manager=MagicMock(),
        client=_fake_client(rows),
    )
    assert processed == 1


def test_hook_failure_marks_row_failed(monkeypatch):
    """A hook raising propagates as a row-level failure (incrementing
    attempts) without poisoning the rest of the batch."""

    def hook(_row):
        raise RuntimeError("agent worker unreachable")

    version_outbox.register_pending_conflict_hook(hook)

    rows = [{
        "id": 23,
        "project_id": "proj_a",
        "commit_id": "",
        "event_type": "pending_conflict_created",
        "payload": {"pending_conflict_id": "pc_fail", "scope_path": ""},
        "attempts": 0,
    }]
    processed = version_outbox.process_version_outbox_batch(
        repo_manager=MagicMock(),
        client=_fake_client(rows),
    )
    assert processed == 0  # hook raised → row marked failed, not processed


# ── version_committed still works as before ────────────────────


def test_version_committed_still_runs_post_push_hook(monkeypatch):
    """The original happy path keeps working after the dispatch refactor."""

    called: dict[str, Any] = {}

    def fake_hook(project_id, repos, result, raise_errors=False):
        called["project_id"] = project_id
        called["commit_id"] = result["commit_id"]
        called["root"] = result["root"]

    monkeypatch.setattr(version_outbox, "run_post_push_hook", fake_hook)

    rows = [{
        "id": 41,
        "project_id": "proj_a",
        "commit_id": "abc123",
        "event_type": "version_committed",
        "payload": {"scope_hash": "treehash", "merged": False, "conflicts": 0},
        "attempts": 0,
    }]
    processed = version_outbox.process_version_outbox_batch(
        repo_manager=MagicMock(),
        client=_fake_client(rows),
    )
    assert processed == 1
    assert called == {
        "project_id": "proj_a",
        "commit_id": "abc123",
        "root": "treehash",
    }


# ── unknown event type ────────────────────────────────────────


def test_unknown_event_type_is_completed_not_failed(monkeypatch):
    """A row with a bogus event_type should not jam the queue. The worker
    logs a warning and marks it complete so attempts doesn't accumulate
    forever on something we don't know how to handle."""

    # If the worker accidentally treated unknown-event as failed, it'd
    # call the fail RPC; we count which RPC happened.
    rpc_calls: list[str] = []

    def _rpc(fn_name: str, _args=None):
        rpc_calls.append(fn_name)
        execute = MagicMock()
        if fn_name == CLAIM_OUTBOX_RPC:
            execute.execute.return_value = MagicMock(data=([
                {
                    "id": 99,
                    "project_id": "proj_a",
                    "commit_id": "",
                    "event_type": "something_new",
                    "payload": {},
                    "attempts": 0,
                },
            ] if not rpc_calls.count(CLAIM_OUTBOX_RPC) > 1 else []))
        else:
            execute.execute.return_value = MagicMock(data=[])
        return execute

    client = MagicMock()
    client.rpc.side_effect = _rpc
    processed = version_outbox.process_version_outbox_batch(
        repo_manager=MagicMock(),
        client=client,
    )
    assert processed == 1
    assert COMPLETE_OUTBOX_RPC in rpc_calls
    assert FAIL_OUTBOX_RPC not in rpc_calls
