from __future__ import annotations

import pytest
from fastapi import HTTPException

from src.version_engine.domain.errors import PathNotFoundError
from src.version_engine.entrypoints.http import content_read
from src.version_engine.read.tree_reader import VersionEntry
from src.platform.auth.models import CurrentUser


class _FakeOps:
    def __init__(self) -> None:
        self._entries = [
            VersionEntry(name=".env", path=".env", type="file"),
            VersionEntry(name="visible.md", path="visible.md", type="markdown"),
            VersionEntry(name="config.json", path=".config/config.json", type="json"),
        ]

    def list_dir(self, _project_id: str, _path: str):
        return list(self._entries)

    def list_tree(self, _project_id: str, _path: str, *, max_depth: int = -1):
        return list(self._entries)

    def get_head_commit_id(self, _project_id: str) -> str:
        return "head-1"


class _FakeProjectService:
    def verify_project_access(self, _project_id: str, _user_id: str) -> str:
        return "owner"


def _user() -> CurrentUser:
    return CurrentUser(user_id="user-1", role="authenticated")


class _MissingDirOps(_FakeOps):
    def list_dir(self, _project_id: str, _path: str):
        raise PathNotFoundError("directory not found: missing")

    def list_tree(self, _project_id: str, _path: str, *, max_depth: int = -1):
        raise PathNotFoundError("directory not found: missing")


def test_content_ls_includes_dotfiles_by_default():
    response = content_read.list_dir(
        "project-1",
        path="",
        ops=_FakeOps(),
        project_service=_FakeProjectService(),
        current_user=_user(),
    )

    paths = [entry.path for entry in response.data.entries]
    assert ".env" in paths
    assert ".config/config.json" in paths
    assert "visible.md" in paths


def test_content_tree_includes_dotfiles_by_default():
    response = content_read.full_tree(
        "project-1",
        path="",
        max_depth=-1,
        ops=_FakeOps(),
        project_service=_FakeProjectService(),
        current_user=_user(),
    )

    paths = [entry.path for entry in response.data.entries]
    assert ".env" in paths
    assert ".config/config.json" in paths
    assert "visible.md" in paths


def test_content_ls_missing_directory_returns_404_not_empty():
    with pytest.raises(HTTPException) as exc:
        content_read.list_dir(
            "project-1",
            path="missing",
            ops=_MissingDirOps(),
            project_service=_FakeProjectService(),
            current_user=_user(),
        )

    assert exc.value.status_code == 404
    assert exc.value.detail == {
        "code": "DIRECTORY_NOT_FOUND",
        "message": "Directory not found: missing",
        "path": "missing",
    }


def test_content_tree_missing_directory_returns_404_not_empty():
    with pytest.raises(HTTPException) as exc:
        content_read.full_tree(
            "project-1",
            path="missing",
            max_depth=-1,
            ops=_MissingDirOps(),
            project_service=_FakeProjectService(),
            current_user=_user(),
        )

    assert exc.value.status_code == 404
    assert exc.value.detail == {
        "code": "DIRECTORY_NOT_FOUND",
        "message": "Directory not found: missing",
        "path": "missing",
    }
