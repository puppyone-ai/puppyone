"""Tests for the new domain intents and parent-scope promote helper.

Focus is on shape and helper logic — no Supabase, no S3. The engine's
end-to-end publish path is covered by ``test_git_native_transaction_engine.py``.
"""

from __future__ import annotations

from src.mut_engine.application.parent_scope_promote import (
    ancestor_scope_paths,
    promote_to_parents,
)
from src.mut_engine.domain.intents import (
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


# ── ancestor_scope_paths ──────────────────────────────────────────


class _FakeRepoWithScopes:
    def __init__(self, scopes: list[str]):
        self._scopes = scopes

    def get_all_scope_hashes(self) -> dict:
        return {s: "" for s in self._scopes}


class _RepoWithoutScopeListing:
    def get_all_scope_hashes(self) -> dict:  # noqa: D401 - test stub
        raise NotImplementedError


def test_ancestor_walk_uses_declared_scope_set():
    repo = _FakeRepoWithScopes(["", "a", "a/b"])
    assert ancestor_scope_paths(repo, "a/b/c") == ["a/b", "a", ""]


def test_ancestor_walk_skips_undeclared_intermediate_scopes():
    """An intermediate path with no declared scope is skipped."""
    repo = _FakeRepoWithScopes(["", "a"])  # 'a/b' is not a real scope
    assert ancestor_scope_paths(repo, "a/b/c") == ["a", ""]


def test_ancestor_walk_falls_back_when_repo_cannot_enumerate():
    repo = _RepoWithoutScopeListing()
    # Falls back to a structural walk: every parent path becomes an ancestor.
    assert ancestor_scope_paths(repo, "a/b/c") == ["a/b", "a", ""]


def test_root_scope_has_no_ancestors():
    repo = _FakeRepoWithScopes([""])
    assert ancestor_scope_paths(repo, "") == []


# ── promote_to_parents: minimal stub run ──────────────────────────


class _RecordingRepo:
    """Just enough to drive promote_to_parents through one ancestor."""

    def __init__(self):
        self._scopes = {"": ""}  # root scope only
        self.publish_calls: list[dict] = []
        from src.mut_engine.application.object_store import ObjectStore
        from pathlib import Path
        import tempfile
        self._tmp = tempfile.mkdtemp()
        self.store = ObjectStore(Path(self._tmp))

    def get_all_scope_hashes(self) -> dict:
        return dict(self._scopes)

    def get_scope_state(self, scope_path: str) -> tuple[str, str]:
        return self._scopes.get(scope_path, ""), ""

    def get_scope_hash(self, scope_path: str) -> str:
        return self._scopes.get(scope_path, "")

    def get_scope_head_commit_id(self, scope_path: str) -> str:
        return ""

    def publish_scope_update(self, **kwargs):
        self.publish_calls.append(kwargs)
        return True, 1


def test_promote_to_parents_calls_publish_for_ancestor_scope(tmp_path):
    from src.mut_engine.application.git_object_format import encode_tree
    repo = _RecordingRepo()
    # Build a non-empty child subtree so the graft produces a different root.
    blob = repo.store.put_blob(b"hello")
    from src.mut_engine.application.git_object_format import MODE_FILE, TreeEntry
    child_tree = repo.store.put_tree(encode_tree([
        TreeEntry(name="readme.md", mode=MODE_FILE, sha1_hex=blob),
    ]))

    promotions = promote_to_parents(
        repo,
        project_id="proj",
        child_scope_path="docs",
        child_new_tree_hash=child_tree,
        child_commit_actor="user:alice",
        child_commit_id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        created_at_iso="2026-05-16T00:00:00Z",
    )
    assert promotions, "expected one promotion for the root ancestor"
    assert promotions[0]["scope_path"] == ""
    assert repo.publish_calls and repo.publish_calls[0]["audit_event_type"] == "scope_promote"
    # The promote message must carry the audit trailer so the synthesized
    # commit is recognisable in history.
    msg = repo.publish_calls[0]["message"]
    assert "PuppyOne-Source: scope-promote" in msg
    assert "PuppyOne-Child-Commit:" in msg


def test_promote_to_parents_noop_for_root_scope_writes():
    repo = _RecordingRepo()
    promotions = promote_to_parents(
        repo,
        project_id="proj",
        child_scope_path="",
        child_new_tree_hash="",
        child_commit_actor="",
        child_commit_id="",
        created_at_iso="",
    )
    assert promotions == []
    assert repo.publish_calls == []
