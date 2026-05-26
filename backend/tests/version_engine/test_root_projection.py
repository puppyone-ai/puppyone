from __future__ import annotations

import pytest

from src.version_engine.derived.hooks import _update_global_root
from src.version_engine.derived.projection import rebuild_project_root_after_commit
from src.version_engine.read.tree_reader import VersionTreeReader
from src.version_engine.write_engine.git_commit import build_git_commit
from src.version_engine.write_engine.git_object_format import EMPTY_TREE_SHA1
from src.version_engine.write_engine.tree import read_tree
from src.version_engine.write_engine.tree_objects import build_tree_from_files


@pytest.fixture
def server_repo(memory_store):
    """Small in-memory repo for projection tests.

    The shared version_engine fixture instantiates PuppyOneServerRepo, which is
    useful for adapter tests but pulls the Supabase/HTTP stack into these pure
    projection unit tests. P17800 is about the projection contract, so keep this
    fixture at the L5/L6 boundary only.
    """

    from tests.version_engine.test_server_repo import FakeHistoryManager

    class _Repo:
        def __init__(self):
            self.store = memory_store
            self.history = FakeHistoryManager()

        def get_all_scope_hashes(self):
            return self.history.get_all_scope_hashes()

        def get_root_hash(self):
            return self.history.get_root_hash()

        def cas_update_root_hash(self, old_hash: str, new_hash: str) -> bool:
            return self.history.cas_update_root_hash(old_hash, new_hash)

        def record_version_index(self, **kwargs):
            return self.history.record_version_index(**kwargs)

        def get_latest_project_view_commit_id(self) -> str:
            return self.history.get_latest_project_view_commit_id()

    return _Repo()


def test_root_projection_skips_damaged_legacy_scope_hash(server_repo) -> None:
    """A bad historical scope must not block new child history grafts."""

    server_repo.history.set_scope_hash("legacy", "1234567890abcdef")
    docs_tree = build_tree_from_files(server_repo.store, {"a.md": b"docs A\n"})
    docs_commit = build_git_commit(
        server_repo,
        tree_sha=docs_tree,
        parent_sha="",
        who="git:docs",
        message="docs add",
        created_at_iso="2026-05-19T00:00:00Z",
    )
    server_repo.history.set_scope_hash("docs", docs_tree)
    server_repo.history.record(
        commit_id=docs_commit,
        who="git:docs",
        message="docs add",
        scope_path="docs",
        changes=[{"path": "docs/a.md", "action": "add"}],
        root_hash=docs_tree,
        scope_hash=docs_tree,
    )

    ok = rebuild_project_root_after_commit(
        server_repo,
        {"status": "ok", "commit_id": docs_commit, "root": docs_tree},
    )

    assert ok is True
    root_entries = read_tree(server_repo.store, server_repo.history.get_root_hash())
    assert "docs" in root_entries
    assert "legacy" not in root_entries
    assert server_repo.history._version_index[-1]["source_commit_id"] == docs_commit


def test_tree_reader_repairs_empty_project_root_from_scope_state(server_repo) -> None:
    """A successful scoped push must remain visible even if projection lags."""

    scope_tree = build_tree_from_files(
        server_repo.store,
        {"Articles/hello.md": b"hello\n"},
    )
    server_repo.history.set_scope_hash("New Folder (2)", scope_tree)
    server_repo.history.set_root_hash(EMPTY_TREE_SHA1)

    class _Repos:
        def get_repo(self, _project_id):
            return server_repo

        def get_server_repo(self, _project_id):
            return server_repo

    reader = VersionTreeReader(_Repos())

    entries = reader.list_dir("test-proj")

    assert [entry.name for entry in entries] == ["New Folder (2)"]
    repaired_root = server_repo.history.get_root_hash()
    assert repaired_root and repaired_root != EMPTY_TREE_SHA1
    assert "New Folder (2)" in read_tree(server_repo.store, repaired_root)


def test_post_push_root_projection_failure_is_retryable(server_repo, monkeypatch) -> None:
    """Projection failure must surface so the version outbox retries the row."""

    docs_tree = build_tree_from_files(server_repo.store, {"a.md": b"docs A\n"})
    docs_commit = build_git_commit(
        server_repo,
        tree_sha=docs_tree,
        parent_sha="",
        who="git:docs",
        message="docs add",
        created_at_iso="2026-05-19T00:00:00Z",
    )
    server_repo.history.set_scope_hash("docs", docs_tree)
    server_repo.history.record(
        commit_id=docs_commit,
        who="git:docs",
        message="docs add",
        scope_path="docs",
        changes=[{"path": "docs/a.md", "action": "add"}],
        root_hash=docs_tree,
        scope_hash=docs_tree,
    )
    monkeypatch.setattr(server_repo, "cas_update_root_hash", lambda _old, _new: False)

    with pytest.raises(RuntimeError, match="project-root projection did not publish"):
        _update_global_root(
            server_repo,
            {"status": "ok", "commit_id": docs_commit, "root": docs_tree},
        )
