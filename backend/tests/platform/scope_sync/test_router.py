"""HTTP wiring tests for the scope-sync policy endpoint."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.scope_sync.router import router
from src.platform.scope_sync.service import ScopeSyncService, get_scope_sync_service


@dataclass
class _Scope:
    id: str
    project_id: str
    path: str
    is_root: bool


_LOOKUP = {"s1": _Scope("s1", "proj-1", "docs", False)}


class _FakeProjectService:
    def get_by_id_with_access_check(self, project_id, user_id):
        return {"id": project_id} if project_id == "proj-1" else None


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id="u1", email="u1@corp.com", role="authenticated", user_metadata={},
    )
    app.dependency_overrides[get_project_service] = lambda: _FakeProjectService()
    app.dependency_overrides[get_scope_sync_service] = lambda: ScopeSyncService(
        scope_lookup=lambda sid: _LOOKUP.get(sid),
    )
    return app


def test_policy_happy_path():
    client = TestClient(_app())
    resp = client.get("/api/v1/scope-sync/policy", params={
        "project_id": "proj-1", "scope_id": "s1", "persona": "non_dev",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["persona"] == "non_dev" and data["scope_role"] == "sub"
    assert "checkpoint_debounce_s" in data["policy"]


def test_policy_forbidden_project_404():
    client = TestClient(_app())
    resp = client.get("/api/v1/scope-sync/policy", params={"project_id": "OTHER", "scope_id": "s1"})
    assert resp.status_code == 404


def test_policy_unknown_scope_404():
    client = TestClient(_app())
    resp = client.get("/api/v1/scope-sync/policy", params={"project_id": "proj-1", "scope_id": "ghost"})
    assert resp.status_code == 404
