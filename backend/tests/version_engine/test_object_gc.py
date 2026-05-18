"""Git-native object GC regression tests."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from src.version_engine.application.object_store import ObjectStore
from src.version_engine.application.tree import tree_to_flat
from src.version_engine.server.scope_manager import ScopeManager

from src.version_engine.application.git_commit import build_git_commit
from src.version_engine.application.tree_objects import build_tree_from_files
from src.version_engine.server.repo_manager import VersionRepoManager
from src.version_engine.server.server_repo import PuppyOneServerRepo
from src.version_engine.services.object_gc import (
    collect_object_gc_roots,
    mark_reachable_objects,
    run_git_object_gc,
)
from src.version_engine.services.object_gc_worker import process_object_gc_projects

from tests.version_engine.test_server_repo import FakeAuditManager, FakeHistoryManager


@pytest.fixture
def server_repo(tmp_path):
    store = ObjectStore(tmp_path / "objects")
    history = FakeHistoryManager()
    audit = FakeAuditManager()

    class FakeScopeBackend:
        def __init__(self):
            self._scopes = {}

        def get(self, sid):
            return self._scopes.get(sid)

        def put(self, sid, scope):
            self._scopes[sid] = scope

        def delete(self, sid):
            return self._scopes.pop(sid, None) is not None

        def list_all(self):
            return list(self._scopes.values())

    return PuppyOneServerRepo(
        project_id="test-proj",
        project_name="Test Project",
        store=store,
        history=history,
        audit=audit,
        scopes=ScopeManager(FakeScopeBackend()),
    )


def _commit_tree(repo, tree_id: str, message: str) -> str:
    return build_git_commit(
        repo,
        tree_sha=tree_id,
        parent_sha="",
        who="git:test",
        message=message,
        created_at_iso="2026-01-01T00:00:00+00:00",
    )


def _publish_root(repo, tree_id: str, commit_id: str) -> None:
    repo.history.set_scope_hash("", tree_id)
    repo.history.set_scope_head_commit_id("", commit_id)
    repo.history.set_head_commit_id(commit_id)
    repo.history.set_root_hash(tree_id)
    repo.history.record(
        commit_id,
        "git:test",
        "publish",
        "",
        [{"path": "keep.txt", "action": "add"}],
        scope_hash=tree_id,
        root_hash=tree_id,
    )


def test_git_object_gc_dry_run_reports_orphan_without_deleting(server_repo):
    live_tree = build_tree_from_files(server_repo.store, {"keep.txt": b"keep"})
    live_commit = _commit_tree(server_repo, live_tree, "live")
    _publish_root(server_repo, live_tree, live_commit)

    orphan_tree = build_tree_from_files(server_repo.store, {"drop.txt": b"drop"})
    orphan_commit = _commit_tree(server_repo, orphan_tree, "orphan")

    result = run_git_object_gc(
        server_repo,
        dry_run=True,
        retention_seconds=0,
    )

    assert result.dry_run is True
    assert result.unreachable_count >= 2
    assert orphan_commit in result.unreachable_sample
    assert server_repo.store.exists(orphan_commit)


def test_git_object_gc_deletes_only_unreachable_objects(server_repo):
    live_tree = build_tree_from_files(server_repo.store, {"keep.txt": b"keep"})
    live_commit = _commit_tree(server_repo, live_tree, "live")
    _publish_root(server_repo, live_tree, live_commit)
    live_blob = tree_to_flat(server_repo.store, live_tree)["keep.txt"]

    orphan_tree = build_tree_from_files(server_repo.store, {"drop.txt": b"drop"})
    orphan_blob = tree_to_flat(server_repo.store, orphan_tree)["drop.txt"]
    orphan_commit = _commit_tree(server_repo, orphan_tree, "orphan")

    result = run_git_object_gc(
        server_repo,
        dry_run=False,
        retention_seconds=0,
    )

    assert result.deleted_count >= 3
    assert server_repo.store.exists(live_commit)
    assert server_repo.store.exists(live_tree)
    assert server_repo.store.exists(live_blob)
    assert not server_repo.store.exists(orphan_commit)
    assert not server_repo.store.exists(orphan_tree)
    assert not server_repo.store.exists(orphan_blob)


def test_git_object_gc_does_not_follow_non_git_raw_tree_children(server_repo):
    raw_blob = _put_raw_object(server_repo.store, b"old raw bytes")
    raw_tree = _put_raw_object(
        server_repo.store,
        json.dumps({"old.txt": ["B", raw_blob]}).encode("utf-8"),
    )
    orphan_raw = _put_raw_object(server_repo.store, b"raw orphan")

    repo = server_repo
    repo.history.set_scope_hash("", raw_tree)
    repo.history.set_root_hash(raw_tree)

    roots = collect_object_gc_roots(repo)
    reachable = mark_reachable_objects(repo, roots)
    assert raw_tree in reachable
    assert raw_blob not in reachable

    result = run_git_object_gc(repo, dry_run=False, retention_seconds=0)

    assert result.deleted_count >= 2
    assert repo.store.exists(raw_tree)
    assert not repo.store.exists(raw_blob)
    assert not repo.store.exists(orphan_raw)


def test_git_object_gc_retention_keeps_unknown_age_orphans(server_repo):
    live_tree = build_tree_from_files(server_repo.store, {"keep.txt": b"keep"})
    live_commit = _commit_tree(server_repo, live_tree, "live")
    _publish_root(server_repo, live_tree, live_commit)

    orphan_tree = build_tree_from_files(server_repo.store, {"drop.txt": b"drop"})
    orphan_commit = _commit_tree(server_repo, orphan_tree, "orphan")

    result = run_git_object_gc(
        server_repo,
        dry_run=False,
        retention_seconds=60,
    )

    assert result.deleted_count == 0
    assert result.kept_unknown_age_count >= 1
    assert server_repo.store.exists(orphan_commit)


def test_git_object_gc_honors_object_age_metadata(server_repo, monkeypatch):
    live_tree = build_tree_from_files(server_repo.store, {"keep.txt": b"keep"})
    live_commit = _commit_tree(server_repo, live_tree, "live")
    _publish_root(server_repo, live_tree, live_commit)
    orphan_tree = build_tree_from_files(server_repo.store, {"drop.txt": b"drop"})
    orphan_commit = _commit_tree(server_repo, orphan_tree, "orphan")
    now = datetime(2026, 1, 8, tzinfo=timezone.utc)

    backend = server_repo.store._backend
    old = now - timedelta(days=10)
    young = now - timedelta(hours=1)

    def fake_metadata():
        return {
            object_id: {"last_modified": old}
            for object_id in server_repo.store.all_hashes()
        } | {orphan_commit: {"last_modified": young}}

    monkeypatch.setattr(backend, "all_hashes_with_metadata", fake_metadata, raising=False)

    result = run_git_object_gc(
        server_repo,
        dry_run=False,
        retention_seconds=7 * 24 * 60 * 60,
        now=now,
    )

    assert result.kept_young_count == 1
    assert result.kept_protected_descendant_count >= 1
    assert server_repo.store.exists(orphan_commit)
    assert server_repo.store.exists(orphan_tree)


def test_object_gc_worker_can_run_bounded_manual_project_list(server_repo, monkeypatch):
    manager = MagicMock(spec=VersionRepoManager)
    manager.get_server_repo.return_value = server_repo
    monkeypatch.setattr(
        "src.version_engine.services.object_gc_worker.settings.VERSION_OBJECT_GC_ENABLED",
        False,
    )

    tree_id = build_tree_from_files(server_repo.store, {"keep.txt": b"keep"})
    commit_id = _commit_tree(server_repo, tree_id, "live")
    _publish_root(server_repo, tree_id, commit_id)

    results = process_object_gc_projects(
        repo_manager=manager,
        client=object(),
        project_ids=["test-proj"],
        dry_run=True,
        retention_seconds=0,
    )

    assert len(results) == 1
    assert results[0].project_id == "test-proj"
    manager.get_server_repo.assert_called_once_with("test-proj")


def _put_raw_object(store: ObjectStore, data: bytes) -> str:
    object_id = hashlib.sha1(data).hexdigest()
    store._backend.put(object_id, data)
    return object_id
