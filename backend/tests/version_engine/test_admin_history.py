from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.version_engine.read.admin import VersionAdminService
from src.version_engine.storage.object_store import ObjectStore
from src.version_engine.write_engine.git_object_format import (
    MODE_DIR,
    MODE_FILE,
    TreeEntry,
    encode_tree,
)
from tests.version_engine.test_server_repo import FakeHistoryManager


def _service_with_repo(repo: SimpleNamespace) -> VersionAdminService:
    repo_manager = MagicMock()
    repo_manager.get_repo.return_value = repo
    return VersionAdminService(repo_manager)


def _service_with_history(history: FakeHistoryManager) -> VersionAdminService:
    repo = SimpleNamespace(history=history)
    return _service_with_repo(repo)


def _record(
    history: FakeHistoryManager,
    commit_id: str,
    *,
    message: str = "",
    changes: list[dict] | None = None,
) -> None:
    history.record(
        commit_id=commit_id,
        who="user:test",
        message=message,
        scope_path="",
        changes=changes or [{"path": "data.csv", "action": "update"}],
        root_hash=f"root-{commit_id}",
        scope_hash=f"scope-{commit_id}",
    )


@pytest.mark.asyncio
async def test_commit_history_hides_scope_promote_projection_rows() -> None:
    history = FakeHistoryManager()
    _record(history, "visible-1", message="edit csv")
    for i in range(25):
        _record(
            history,
            f"promote-{i}",
            message=(
                "scope-promote docs -> /\n\n"
                "PuppyOne-Source: scope-promote\n"
                "PuppyOne-Child-Commit: child\n"
            ),
            changes=[{"path": "docs", "action": "scope-promote"}],
        )
    _record(history, "visible-2", message="save csv")

    entries = await _service_with_history(history).get_commit_history(
        "project-1",
        limit=2,
    )

    assert [entry["commit_id"] for entry in entries] == [
        "visible-1",
        "visible-2",
    ]


@pytest.mark.asyncio
async def test_file_history_filter_does_not_return_scope_promote_rows() -> None:
    history = FakeHistoryManager()
    _record(history, "visible-1", changes=[{"path": "data.csv", "action": "update"}])
    _record(
        history,
        "promote-1",
        message="scope-promote data.csv -> /\n\nPuppyOne-Source: scope-promote\n",
        changes=[{"path": "data.csv", "action": "scope-promote"}],
    )

    entries = await _service_with_history(history).get_commit_history(
        "project-1",
        path="data.csv",
        limit=10,
    )

    assert [entry["commit_id"] for entry in entries] == ["visible-1"]


@pytest.mark.asyncio
async def test_commit_content_resolves_full_paths_against_scope_tree(tmp_path) -> None:
    store = ObjectStore(tmp_path / "objects")
    history = FakeHistoryManager()
    blob_hash = store.put_blob(b"agent rules")
    scope_hash = store.put_tree(encode_tree([
        TreeEntry(name="AGENTS.md", mode=MODE_FILE, sha1_hex=blob_hash),
    ]))
    history.record(
        commit_id="scope-commit",
        who="user:test",
        message="add scoped file",
        scope_path="New Folder (2)",
        changes=[{"path": "New Folder (2)/AGENTS.md", "action": "add"}],
        root_hash="",
        scope_hash=scope_hash,
    )
    service = _service_with_repo(SimpleNamespace(history=history, store=store))

    content = await service.get_commit_content(
        "project-1",
        "New Folder (2)/AGENTS.md",
        "scope-commit",
    )

    assert content == b"agent rules"


@pytest.mark.asyncio
async def test_commit_content_prefers_project_root_when_available(tmp_path) -> None:
    store = ObjectStore(tmp_path / "objects")
    history = FakeHistoryManager()
    blob_hash = store.put_blob(b"project-root content")
    scope_hash = store.put_tree(encode_tree([
        TreeEntry(name="AGENTS.md", mode=MODE_FILE, sha1_hex=blob_hash),
    ]))
    root_hash = store.put_tree(encode_tree([
        TreeEntry(name="New Folder (2)", mode=MODE_DIR, sha1_hex=scope_hash),
    ]))
    history.record(
        commit_id="root-commit",
        who="user:test",
        message="add project file",
        scope_path="New Folder (2)",
        changes=[{"path": "New Folder (2)/AGENTS.md", "action": "add"}],
        root_hash=root_hash,
        scope_hash=scope_hash,
    )
    service = _service_with_repo(SimpleNamespace(history=history, store=store))

    content = await service.get_commit_content(
        "project-1",
        "New Folder (2)/AGENTS.md",
        "root-commit",
    )

    assert content == b"project-root content"


@pytest.mark.asyncio
async def test_compute_diff_returns_changes_between_commits(tmp_path) -> None:
    store = ObjectStore(tmp_path / "objects")
    history = FakeHistoryManager()
    blob_v1 = store.put_blob(b"v1")
    blob_v2 = store.put_blob(b"v2")
    root1 = store.put_tree(encode_tree([
        TreeEntry(name="a.txt", mode=MODE_FILE, sha1_hex=blob_v1),
    ]))
    root2 = store.put_tree(encode_tree([
        TreeEntry(name="a.txt", mode=MODE_FILE, sha1_hex=blob_v2),
        TreeEntry(name="b.txt", mode=MODE_FILE, sha1_hex=blob_v1),
    ]))
    history.record(commit_id="c1", who="u", message="one", scope_path="",
                   changes=[], root_hash=root1, scope_hash=root1)
    history.record(commit_id="c2", who="u", message="two", scope_path="",
                   changes=[], root_hash=root2, scope_hash=root2)
    service = _service_with_repo(SimpleNamespace(history=history, store=store))

    changes = await service.compute_diff("project-1", "c1", "c2")
    ops = {c["path"]: c["op"] for c in changes}
    assert ops == {"a.txt": "modified", "b.txt": "added"}


@pytest.mark.asyncio
async def test_compute_diff_tolerant_on_missing_tree_object(tmp_path) -> None:
    """A commit whose tree object is missing/corrupt must not 500 the diff.

    Regression for the deployed-version bug where compute_diff let an
    ObjectNotFoundError from the storage read bubble into a 500. With tolerant
    diffing the unreadable side is treated as empty and a best-effort diff is
    returned (here: the present tree's entries show as deleted).
    """
    store = ObjectStore(tmp_path / "objects")
    history = FakeHistoryManager()
    blob = store.put_blob(b"present")
    root_present = store.put_tree(encode_tree([
        TreeEntry(name="kept.txt", mode=MODE_FILE, sha1_hex=blob),
    ]))
    missing_root = "0" * 40  # valid-looking hash with no object behind it
    history.record(commit_id="present", who="u", message="p", scope_path="",
                   changes=[], root_hash=root_present, scope_hash=root_present)
    history.record(commit_id="gone", who="u", message="g", scope_path="",
                   changes=[], root_hash=missing_root, scope_hash=missing_root)
    service = _service_with_repo(SimpleNamespace(history=history, store=store))

    # Must not raise; missing side is empty so kept.txt reads as deleted.
    changes = await service.compute_diff("project-1", "present", "gone")
    assert {c["path"]: c["op"] for c in changes} == {"kept.txt": "deleted"}
