from __future__ import annotations

from src.mut_engine.routers import content_read
from src.mut_engine.services.tree_reader import MutEntry
from src.platform.auth.models import CurrentUser


class _FakeOps:
    def __init__(self) -> None:
        self._entries = [
            MutEntry(name=".env", path=".env", type="file"),
            MutEntry(name="visible.md", path="visible.md", type="markdown"),
            MutEntry(name="config.json", path=".config/config.json", type="json"),
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
