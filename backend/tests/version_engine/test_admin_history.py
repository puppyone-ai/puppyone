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
