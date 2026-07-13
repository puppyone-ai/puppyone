from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.exceptions import NotFoundException
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_repository
from src.platform.project.git_view import ProjectGitViewService
from src.platform.project.router import (
    get_project_git_view_service,
)
from src.platform.project.router import (
    router as project_router,
)
from tests.authorization_fakes import authorization_for, install_authorization

PROJECT_ID = "project-1"


class _ScopeRepository:
    def __init__(self, scope):
        self.scope = scope

    def get_root_scope(self, project_id: str):
        assert project_id == PROJECT_ID
        return self.scope


class _ScopeBackend:
    def list_all(self):
        return []


class _RepoManager:
    def __init__(self):
        self.repo = object()
        self.scope_backend = _ScopeBackend()

    def get_server_repo(self, project_id: str):
        assert project_id == PROJECT_ID
        return self.repo

    def get_scope_backend(self, project_id: str):
        assert project_id == PROJECT_ID
        return self.scope_backend


def _root_scope(**overrides):
    values = {
        "id": "scope-root",
        "project_id": PROJECT_ID,
        "path": "",
        "exclude": ["private"],
        "mode": "rw",
        "is_root": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_human_health_uses_the_exact_root_view_and_explicit_repair_capability(
    monkeypatch,
):
    from src.platform.project import git_view as module

    manager = _RepoManager()
    captured = {}

    def fake_health(repo, **kwargs):
        captured["repo"] = repo
        captured.update(kwargs)
        return {"health": "healthy", "read_only": kwargs["read_only"]}

    monkeypatch.setattr(module, "git_view_health_payload", fake_health)
    service = ProjectGitViewService(manager, _ScopeRepository(_root_scope()))

    payload = service.health(
        PROJECT_ID,
        content_write_allowed=False,
        cache_rebuild_allowed=True,
    )

    assert captured == {
        "repo": manager.repo,
        "project_id": PROJECT_ID,
        "scope_path": "",
        "scope_excludes": ["private"],
        "read_only": True,
    }
    assert payload["can_rebuild"] is True


def test_human_rebuild_rewarms_both_root_cache_variants(monkeypatch):
    from src.platform.project import git_view as module

    calls = []

    def fake_rebuild(repo, **kwargs):
        calls.append((repo, kwargs))
        return {
            "history_mode": "full" if kwargs["follow_history"] else "receive-boundary",
            "blob_mode": "included" if kwargs["include_blobs"] else "omitted",
        }

    manager = _RepoManager()
    monkeypatch.setattr(module, "rebuild_git_transport_view", fake_rebuild)
    service = ProjectGitViewService(manager, _ScopeRepository(_root_scope()))

    result = service.rebuild(PROJECT_ID)

    assert [call[1] for call in calls] == [
        {
            "scope_path": "",
            "scope_excludes": ["private"],
            "follow_history": True,
            "include_blobs": True,
        },
        {
            "scope_path": "",
            "scope_excludes": ["private"],
            "follow_history": False,
            "include_blobs": False,
        },
    ]
    assert result == {
        "variants": [
            {"history_mode": "full", "blob_mode": "included"},
            {"history_mode": "receive-boundary", "blob_mode": "omitted"},
        ]
    }


@pytest.mark.parametrize(
    "scope",
    [
        None,
        _root_scope(project_id="project-2"),
        _root_scope(is_root=False),
        _root_scope(path="docs"),
    ],
)
def test_human_git_view_fails_closed_without_exact_root_geometry(scope):
    service = ProjectGitViewService(_RepoManager(), _ScopeRepository(scope))

    with pytest.raises(NotFoundException):
        service.health(
            PROJECT_ID,
            content_write_allowed=True,
            cache_rebuild_allowed=True,
        )


def _app(role: str):
    app = FastAPI()
    app.include_router(project_router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id="user-1",
        email="user@example.com",
        role="authenticated",
    )
    install_authorization(app, authorization_for(PROJECT_ID, role=role))

    project_repository = MagicMock()
    project_repository.get_by_id.return_value = SimpleNamespace(id=PROJECT_ID)
    app.dependency_overrides[get_project_repository] = lambda: project_repository

    git_view = MagicMock()
    git_view.health.return_value = {"health": "healthy", "can_rebuild": role == "admin"}
    git_view.rebuild.return_value = {"variants": []}
    app.dependency_overrides[get_project_git_view_service] = lambda: git_view
    return app, git_view


@pytest.mark.parametrize(
    ("role", "content_write", "can_rebuild"),
    [("viewer", False, False), ("editor", True, False), ("admin", True, True)],
)
def test_health_control_plane_uses_project_read_and_passes_capabilities(
    role,
    content_write,
    can_rebuild,
):
    app, git_view = _app(role)

    with TestClient(app) as client:
        response = client.get(f"/api/v1/projects/{PROJECT_ID}/git-view/health")

    assert response.status_code == 200, response.text
    git_view.health.assert_called_once_with(
        PROJECT_ID,
        content_write_allowed=content_write,
        cache_rebuild_allowed=can_rebuild,
    )


def test_cache_rebuild_control_plane_requires_project_management():
    viewer_app, viewer_service = _app("viewer")
    with TestClient(viewer_app) as client:
        denied = client.post(
            f"/api/v1/projects/{PROJECT_ID}/git-view/rebuild-cache"
        )
    assert denied.status_code == 403, denied.text
    viewer_service.rebuild.assert_not_called()

    admin_app, admin_service = _app("admin")
    with TestClient(admin_app) as client:
        allowed = client.post(
            f"/api/v1/projects/{PROJECT_ID}/git-view/rebuild-cache"
        )
    assert allowed.status_code == 200, allowed.text
    admin_service.rebuild.assert_called_once_with(PROJECT_ID)
