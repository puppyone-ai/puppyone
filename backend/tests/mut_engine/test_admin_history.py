from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.mut_engine.server.admin import MutAdminService
from tests.mut_engine.test_server_repo import FakeHistoryManager


def _service_with_history(history: FakeHistoryManager) -> MutAdminService:
    repo = SimpleNamespace(history=history)
    repo_manager = MagicMock()
    repo_manager.get_repo.return_value = repo
    return MutAdminService(repo_manager)


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
