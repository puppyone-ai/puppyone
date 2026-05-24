from __future__ import annotations

from src.version_engine.derived.projection import rebuild_project_root_after_commit
from src.version_engine.write_engine.git_commit import build_git_commit
from src.version_engine.write_engine.tree import read_tree
from src.version_engine.write_engine.tree_objects import build_tree_from_files


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
