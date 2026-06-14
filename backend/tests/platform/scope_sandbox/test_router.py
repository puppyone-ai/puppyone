"""HTTP wiring tests for the scope-sandbox router (auth + envelope + parsing).

The service layer is tested separately (test_service.py); here we just confirm
the endpoints parse requests, enforce project access, and shape the ApiResponse
envelope — using dependency_overrides with a fake service."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.scope_sandbox.router import router
from src.platform.scope_sandbox.service import ConnectInfo, get_scope_sandbox_service


@dataclass
class _FakeService:
    raise_lookup: bool = False

    async def connect(self, **kw):
        if self.raise_lookup:
            raise LookupError("nope")
        return ConnectInfo(
            provider="e2b", state="running", via="created",
            host="sb-1", port=22, username="user",
            proxy_command="websocat --binary -B 65536 - wss://8081-sb-1.e2b.app",
            needs_websocat=True,
            workspace_path="/home/user/u1",
            ssh_config_block="Host puppy-scope\n    HostName sb-1\n",
            expires_at=1780531200.0, connected_users=1,
        )

    def status(self, **kw):
        return {
            "state": "running",
            "connected": True,
            "connected_users": 1,
            "workspace_path": "/home/user/u1",
        }

    def available_providers(self):
        return {"default": "e2b", "providers": [
            {"id": "e2b", "label": "E2B", "configured": True},
            {"id": "fly", "label": "Fly", "configured": False},
        ]}

    async def revoke(self, **kw):
        return 0


class _FakeProjectService:
    def get_by_id_with_access_check(self, project_id, user_id):
        return {"id": project_id} if project_id == "proj-1" else None


def _app(service: _FakeService) -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id="u1", email="u1@corp.com", role="authenticated", user_metadata={"name": "U One"},
    )
    app.dependency_overrides[get_project_service] = lambda: _FakeProjectService()
    app.dependency_overrides[get_scope_sandbox_service] = lambda: service
    return app


def test_connect_happy_path():
    client = TestClient(_app(_FakeService()))
    resp = client.post("/api/v1/scope-sandboxes/connect", json={
        "project_id": "proj-1", "scope_id": "s1", "public_key": "ssh-ed25519 AAAA u1",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["needs_websocat"] is True
    assert body["data"]["workspace_path"] == "/home/user/u1"
    assert "ProxyCommand" not in body["data"]["ssh_config_block"]  # fake block has none
    assert body["data"]["via"] == "created"


def test_connect_requires_public_key():
    client = TestClient(_app(_FakeService()))
    resp = client.post("/api/v1/scope-sandboxes/connect", json={
        "project_id": "proj-1", "scope_id": "s1", "public_key": "   ",
    })
    assert resp.status_code == 400


def test_connect_rejects_bad_provider():
    client = TestClient(_app(_FakeService()))
    resp = client.post("/api/v1/scope-sandboxes/connect", json={
        "project_id": "proj-1", "scope_id": "s1", "public_key": "k", "provider": "aws",
    })
    assert resp.status_code == 400


def test_connect_forbidden_project_is_404():
    client = TestClient(_app(_FakeService()))
    resp = client.post("/api/v1/scope-sandboxes/connect", json={
        "project_id": "OTHER", "scope_id": "s1", "public_key": "ssh-ed25519 AAAA u1",
    })
    assert resp.status_code == 404


def test_connect_unknown_scope_is_404():
    client = TestClient(_app(_FakeService(raise_lookup=True)))
    resp = client.post("/api/v1/scope-sandboxes/connect", json={
        "project_id": "proj-1", "scope_id": "ghost", "public_key": "ssh-ed25519 AAAA u1",
    })
    assert resp.status_code == 404


def test_providers_endpoint():
    client = TestClient(_app(_FakeService()))
    resp = client.get("/api/v1/scope-sandboxes/providers")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["default"] == "e2b"
    assert {p["id"] for p in data["providers"]} == {"e2b", "fly"}


def test_status_endpoint():
    client = TestClient(_app(_FakeService()))
    resp = client.get("/api/v1/scope-sandboxes/status", params={"project_id": "proj-1", "scope_id": "s1"})
    assert resp.status_code == 200 and resp.json()["data"]["connected"] is True


def test_revoke_endpoint():
    client = TestClient(_app(_FakeService()))
    resp = client.post("/api/v1/scope-sandboxes/revoke", json={"project_id": "proj-1", "scope_id": "s1"})
    assert resp.status_code == 200 and resp.json()["data"]["connected_users"] == 0
