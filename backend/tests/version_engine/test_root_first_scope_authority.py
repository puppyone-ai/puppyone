from __future__ import annotations

import pytest

from src.version_engine.domain.intents import OperationWriteIntent, VersionSubmissionIntent
from src.version_engine.read.tree_reader import VersionTreeReader
from src.version_engine.write_engine.engine import VersionWriteEngine
from src.version_engine.write_engine.git_commit import build_git_commit
from src.version_engine.write_engine.tree import read_tree
from src.version_engine.write_engine.tree_objects import build_tree_from_files
from src.version_engine.adapters.product.tree_patch import splice_put_blob


def _repos(server_repo):
    class _Repos:
        def get_repo(self, _project_id):
            return server_repo

        def get_server_repo(self, _project_id):
            return server_repo

    return _Repos()


@pytest.mark.asyncio
async def test_scoped_git_submission_publishes_canonical_project_root(
    repo_manager,
    server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    scope_tree = build_tree_from_files(server_repo.store, {"a.md": b"docs\n"})
    client_commit = build_git_commit(
        server_repo,
        tree_sha=scope_tree,
        parent_sha="",
        who="git:docs",
        message="docs add",
        created_at_iso="2026-05-26T00:00:00+00:00",
    )

    result = await VersionWriteEngine(repo_manager).submit_version(
        VersionSubmissionIntent(
            project_id="test-proj",
            scope_path="docs",
            actor="git:docs",
            source_channel="git",
            base_commit_id="",
            proposed_tree_id=scope_tree,
            client_commit_id=client_commit,
            message="docs add",
            changed_paths=["a.md"],
            defer_projection=True,
        )
    )

    root_hash = server_repo.get_root_hash()
    root_entries = read_tree(server_repo.store, root_hash)
    assert root_entries["docs"][1] == scope_tree
    assert server_repo.get_scope_hash("docs") == scope_tree
    assert server_repo.get_scope_head_commit_id("docs") == client_commit
    assert result.new_scope_hash == scope_tree

    entry = server_repo.get_history_entry(result.commit_id)
    assert entry["root_hash"] == root_hash
    assert entry["scope_hash"] == scope_tree
    assert entry["scope_path"] == "docs"


@pytest.mark.asyncio
async def test_scoped_operation_grafts_into_root_not_scope_authority(
    repo_manager,
    server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")

    result = await VersionWriteEngine(repo_manager).apply_operation(
        OperationWriteIntent(
            project_id="test-proj",
            scope_path="docs",
            actor="agent:cli",
            source_channel="agent",
            operation_type="write_file",
            message="write docs",
            defer_projection=True,
        ),
        lambda store, scope_root: splice_put_blob(
            store, scope_root, "note.md", b"note\n",
        ),
    )

    root_hash = server_repo.get_root_hash()
    docs_tree = read_tree(server_repo.store, root_hash)["docs"][1]
    assert server_repo.get_scope_hash("docs") == docs_tree
    assert result.new_scope_hash == docs_tree

    reader = VersionTreeReader(_repos(server_repo))
    assert reader.read_file("test-proj", "docs/note.md") == b"note\n"
    assert reader.read_file_in_scope("test-proj", "docs", "note.md") == b"note\n"


def test_scoped_reads_prefer_root_over_stale_scope_cache(server_repo):
    root_tree = build_tree_from_files(
        server_repo.store,
        {"docs/a.md": b"root truth\n"},
    )
    stale_scope_tree = build_tree_from_files(
        server_repo.store,
        {"a.md": b"stale cache\n"},
    )
    server_repo.history.set_root_hash(root_tree)
    server_repo.history.set_scope_hash("docs", stale_scope_tree)

    reader = VersionTreeReader(_repos(server_repo))

    assert reader.read_file_in_scope("test-proj", "docs", "a.md") == b"root truth\n"
    assert server_repo.list_scope_files({"id": "docs-scope", "path": "docs"}) == {
        "a.md": b"root truth\n",
    }
