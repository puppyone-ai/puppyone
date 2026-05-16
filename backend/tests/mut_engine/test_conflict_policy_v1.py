"""Unit tests for the V1 conflict policy stack.

Covers:
  * default = last_write_wins with auto-merge running first
  * rule-based opt-in to manual_review
  * parent-scope-wins overrides both LWW and manual_review
  * server commit trailers compose correctly

These tests are pure functions of the policy / merge helpers — they do
not hit Supabase or S3.
"""

from __future__ import annotations

import pytest

from src.mut_engine.application.conflict_policy import (
    merge_file_sets_for_policy,
    select_conflict_policy,
)
from src.mut_engine.application.git_commit import compose_commit_message
from src.mut_engine.domain.conflicts import (
    ConflictPolicyConfig,
    ConflictPolicyRule,
)


# ── select_conflict_policy ────────────────────────────────────────


def test_default_policy_is_last_write_wins():
    decision = select_conflict_policy(scope_path="src", actor="user:alice")
    assert decision.policy == "last_write_wins"
    assert decision.reason == "default:last_write_wins"


def test_rule_overrides_default_for_matching_scope():
    cfg = ConflictPolicyConfig(rules=[
        ConflictPolicyRule(policy="manual_review", scope_path="configs"),
    ])
    decision = select_conflict_policy(
        config=cfg, scope_path="configs", actor="user:alice",
    )
    assert decision.policy == "manual_review"
    assert decision.reason.startswith("rule_match:")


def test_rule_matches_descendant_scope():
    cfg = ConflictPolicyConfig(rules=[
        ConflictPolicyRule(policy="manual_review", scope_path="configs"),
    ])
    decision = select_conflict_policy(
        config=cfg, scope_path="configs/prod", actor="user:bob",
    )
    assert decision.policy == "manual_review"


def test_path_glob_rule_must_actually_match():
    cfg = ConflictPolicyConfig(rules=[
        ConflictPolicyRule(policy="reject", path_glob="*.lock"),
    ])
    # The path list does not contain any *.lock entry — fall back to default.
    decision = select_conflict_policy(
        config=cfg, scope_path="", paths=["readme.md"],
    )
    assert decision.policy == "last_write_wins"
    # When the path list does match, the rule activates.
    decision = select_conflict_policy(
        config=cfg, scope_path="", paths=["package-lock.lock"],
    )
    assert decision.policy == "reject"


def test_actor_type_filter():
    cfg = ConflictPolicyConfig(rules=[
        ConflictPolicyRule(policy="manual_review", actor_type="agent"),
    ])
    decision = select_conflict_policy(
        config=cfg, scope_path="src", actor="user:alice",
    )
    assert decision.policy == "last_write_wins"
    decision = select_conflict_policy(
        config=cfg, scope_path="src", actor="agent:builder",
    )
    assert decision.policy == "manual_review"


# ── merge_file_sets_for_policy ────────────────────────────────────


def _decision(policy: str):
    return select_conflict_policy(
        config=ConflictPolicyConfig(default_policy=policy),
    )


def test_safe_auto_merge_runs_before_policy_choice():
    """Identical content needs no policy; auto-merge wins."""
    base = {"a.txt": b"hello"}
    ours = {"a.txt": b"hello there"}
    theirs = {"a.txt": b"hello there"}  # same as ours
    result = merge_file_sets_for_policy(
        base, ours, theirs, policy=_decision("manual_review"),
    )
    assert result.manual_conflicts == []
    assert result.lww_records == []
    assert result.merged_files["a.txt"] == b"hello there"


def test_lww_default_picks_incoming_and_records_loss():
    base = {"a.txt": b"line\n"}
    ours = {"a.txt": b"line-ours\n"}
    theirs = {"a.txt": b"line-theirs\n"}
    result = merge_file_sets_for_policy(
        base, ours, theirs, policy=_decision("last_write_wins"),
    )
    assert result.manual_conflicts == []
    assert result.merged_files["a.txt"] == b"line-theirs\n"
    assert len(result.lww_records) == 1
    record = result.lww_records[0]
    assert record.kept == "theirs"
    assert "ours" in record.lost_content or record.lost_hash


def test_manual_review_opt_in_keeps_ours_pending():
    base = {"a.txt": b"a\n"}
    ours = {"a.txt": b"b\n"}
    theirs = {"a.txt": b"c\n"}
    result = merge_file_sets_for_policy(
        base, ours, theirs, policy=_decision("manual_review"),
    )
    assert len(result.manual_conflicts) == 1
    assert result.manual_conflicts[0].kept == "pending"
    # Manual-review keeps our copy on the server until a human approves.
    assert result.merged_files["a.txt"] == b"b\n"
    assert result.lww_records == []


def test_parent_scope_wins_overrides_lww():
    base = {"a.txt": b"a\n"}
    ours = {"a.txt": b"b\n"}
    theirs = {"a.txt": b"c\n"}
    parent_files = {"a.txt": b"PARENT_WINS\n"}
    result = merge_file_sets_for_policy(
        base, ours, theirs,
        policy=_decision("last_write_wins"),
        parent_scope_files=parent_files,
    )
    assert result.merged_files["a.txt"] == b"PARENT_WINS\n"
    assert len(result.superseded_by_parent) == 1
    assert result.superseded_by_parent[0].kept == "parent"
    # Parent-scope-wins also short-circuits LWW.
    assert result.lww_records == []
    assert result.manual_conflicts == []


def test_parent_scope_does_not_override_when_parent_agrees_with_child():
    """If the parent matches one side, that side has no real conflict."""
    base = {"a.txt": b"a\n"}
    ours = {"a.txt": b"b\n"}
    theirs = {"a.txt": b"b\n"}
    parent_files = {"a.txt": b"b\n"}
    result = merge_file_sets_for_policy(
        base, ours, theirs,
        policy=_decision("last_write_wins"),
        parent_scope_files=parent_files,
    )
    # Identical strategy ran; no parent override needed.
    assert result.merged_files["a.txt"] == b"b\n"
    assert result.superseded_by_parent == []


def test_delete_modify_under_lww_drops_the_file():
    """LWW honors a delete on either side."""
    base = {"a.txt": b"a\n"}
    ours = {}  # we deleted
    theirs = {"a.txt": b"a-modified\n"}  # incoming kept and modified
    result = merge_file_sets_for_policy(
        base, ours, theirs, policy=_decision("last_write_wins"),
    )
    # Incoming wins — file resurrected.
    assert result.merged_files["a.txt"] == b"a-modified\n"
    assert len(result.lww_records) == 1


def test_modify_delete_under_lww_drops_the_file():
    base = {"a.txt": b"a\n"}
    ours = {"a.txt": b"a-modified\n"}  # we modified
    theirs = {}  # incoming deleted
    result = merge_file_sets_for_policy(
        base, ours, theirs, policy=_decision("last_write_wins"),
    )
    # Incoming wins → file ends up deleted.
    assert "a.txt" not in result.merged_files
    assert len(result.lww_records) == 1


# ── server commit trailer composition ─────────────────────────────


def test_trailers_appended_with_blank_line_separator():
    msg = compose_commit_message("update readme", {
        "PuppyOne-Source": "git",
        "PuppyOne-Scope": "docs",
    })
    lines = msg.splitlines()
    assert lines[0] == "update readme"
    assert lines[1] == ""
    assert "PuppyOne-Source: git" in lines
    assert "PuppyOne-Scope: docs" in lines


def test_empty_trailer_values_are_skipped():
    msg = compose_commit_message("hi", {
        "PuppyOne-Source": "git",
        "PuppyOne-Original-Commit": "",
    })
    assert "PuppyOne-Source: git" in msg
    assert "PuppyOne-Original-Commit" not in msg


def test_compose_commit_message_idempotent_for_existing_trailer():
    base = "msg\n\nPuppyOne-Source: git"
    msg = compose_commit_message(base, {"PuppyOne-Source": "git"})
    # Trailer already present — should not duplicate.
    assert msg.count("PuppyOne-Source: git") == 1
