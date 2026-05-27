"""Tests for write-engine domain intent shapes.

Focus is on shape only — no Supabase, no S3. Root-first publish behaviour is
covered by the write-engine integration tests.
"""

from __future__ import annotations

from src.version_engine.domain.intents import (
    ConflictResolutionIntent,
    OperationWriteIntent,
    RollbackIntent,
    VersionSubmissionIntent,
)


# ── intent shape ──────────────────────────────────────────────────


def test_conflict_resolution_intent_defaults():
    intent = ConflictResolutionIntent(
        project_id="proj",
        pending_conflict_id="abc",
        scope_path="src",
        resolver_actor="user:alice",
        source_channel="papi",
    )
    assert intent.decision == "accept"
    assert intent.resolution_tree_id == ""
    assert intent.resolution_files is None
    assert intent.audit_detail == {}


def test_conflict_resolution_intent_reject_decision():
    intent = ConflictResolutionIntent(
        project_id="proj",
        pending_conflict_id="abc",
        scope_path="src",
        resolver_actor="user:alice",
        source_channel="papi",
        decision="reject",
        resolution_message="superseded by main branch",
    )
    assert intent.decision == "reject"


def test_version_submission_intent_carries_scope_excludes():
    intent = VersionSubmissionIntent(
        project_id="proj",
        scope_path="docs",
        actor="agent:a",
        source_channel="git",
        base_commit_id="b",
        proposed_tree_id="t",
        scope_excludes=["docs/secret"],
    )
    assert intent.scope_excludes == ["docs/secret"]


def test_rollback_intent_defaults():
    intent = RollbackIntent(
        project_id="proj",
        scope_path="src",
        actor="user:alice",
        source_channel="papi",
        target_commit_id="aaa",
    )
    assert intent.message == ""
    assert intent.scope_excludes == []


def test_operation_write_intent_immutable():
    intent = OperationWriteIntent(
        project_id="proj",
        scope_path="src",
        actor="user:alice",
        source_channel="papi",
        operation_type="write_file",
    )
    # ``frozen=True`` dataclass — direct attribute writes are blocked.
    import dataclasses
    try:
        intent.actor = "user:bob"  # type: ignore[misc]
    except dataclasses.FrozenInstanceError:
        return
    raise AssertionError("OperationWriteIntent should be frozen")
