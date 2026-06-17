"""Tests for the damaged-folder repair tool (scripts/repair_damaged_folders).

Recovery is only possible when a PRESENT alternate version of the damaged
path's subtree exists (storage is content-addressed, so a missing object has
no other copy by that hash). The tool restores that version; for a single-write
folder whose only version is gone it correctly reports the folder unrecoverable.
"""

from __future__ import annotations

import pytest

from src.version_engine.storage.object_store import ObjectStore
from src.version_engine.write_engine.git_object_format import decode_tree
from src.version_engine.write_engine.tree_objects import build_tree_from_files
from src.version_engine.infrastructure.supabase.scope_manager import ScopeManager
from src.version_engine.infrastructure.supabase.server_repo import PuppyOneServerRepo

from scripts.repair_damaged_folders import (
    find_recovery_subtree,
    repair_repo,
    scan_damaged_dirs,
)
from tests.version_engine.test_server_repo import FakeAuditManager, FakeHistoryManager


@pytest.fixture
def repo(tmp_path):
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
        project_id="repair-proj",
        project_name="Repair Project",
        store=ObjectStore(tmp_path / "objects"),
        history=FakeHistoryManager(),
        audit=FakeAuditManager(),
        scopes=ScopeManager(FakeScopeBackend()),
    )


def _subtree_id(store, root, name):
    return next(
        e.sha1_hex for e in decode_tree(store.get_object(root)[1]) if e.name == name
    )


def test_recovers_previous_healthy_version_of_rewritten_folder(repo):
    store = repo.store
    # v1: docs/old.md  → a healthy docs subtree we can fall back to.
    root1 = build_tree_from_files(store, {"docs/old.md": b"old", "keep.txt": b"k"})
    repo.history.record("c1", "who", "v1", "", [], root_hash=root1)
    docs_v1 = _subtree_id(store, root1, "docs")

    # v2: docs rewritten to new.md → current root, then its docs subtree is lost.
    root2 = build_tree_from_files(store, {"docs/new.md": b"new", "keep.txt": b"k"})
    repo.history.record("c2", "who", "v2", "", [], root_hash=root2)
    repo.history.set_root_hash(root2)
    docs_v2 = _subtree_id(store, root2, "docs")
    assert store._backend.delete(docs_v2)  # simulate object loss

    assert scan_damaged_dirs(store, root2) == ["docs"]
    sub, source = find_recovery_subtree(store, repo, "docs")
    assert sub == docs_v1 and "history_root" in source

    assert repair_repo(repo, apply=True) == 0
    healed_root = repo.get_root_hash()
    assert scan_damaged_dirs(store, healed_root) == []
    assert _subtree_id(store, healed_root, "docs") == docs_v1


def test_recovers_from_scope_hash_when_root_graft_lost(repo):
    store = repo.store
    # The docs sub-scope's own tree survives (a different, present version)…
    docs_scope_tree = build_tree_from_files(store, {"guide.md": b"guide"})
    repo.history.set_scope_hash("docs", docs_scope_tree)
    # …while the project root references a now-missing docs subtree.
    root = build_tree_from_files(store, {"docs/stale.md": b"stale", "keep.txt": b"k"})
    repo.history.set_root_hash(root)
    assert store._backend.delete(_subtree_id(store, root, "docs"))

    sub, source = find_recovery_subtree(store, repo, "docs")
    assert sub == docs_scope_tree and "scope_hash" in source


def test_reports_unrecoverable_when_only_version_is_gone(repo):
    store = repo.store
    root = build_tree_from_files(store, {"docs/only.md": b"only", "keep.txt": b"k"})
    repo.history.record("c1", "who", "v1", "", [], root_hash=root)
    repo.history.set_root_hash(root)
    assert store._backend.delete(_subtree_id(store, root, "docs"))

    assert scan_damaged_dirs(store, root) == ["docs"]
    sub, _source = find_recovery_subtree(store, repo, "docs")
    assert sub is None
    # apply is a no-op: nothing recoverable, root unchanged, no data invented.
    assert repair_repo(repo, apply=True) == 0
    assert repo.get_root_hash() == root
    assert scan_damaged_dirs(store, root) == ["docs"]
