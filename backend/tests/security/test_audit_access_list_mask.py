"""ISSUE-002 — GET /api/v1/access (list_connections) IDOR + credential exposure.

Two guarantees verified:
  1. A caller passing a project_id they are NOT a member of gets an empty list
     (no IDOR into another tenant's access points).
  2. The list view never returns raw credentials — access_key is nulled and the
     secret-bearing config keys are stripped; only has_key/key_last4 remain.

Hermetic: get_current_user overridden; org/project resolution and the Supabase
client are faked, so no DB is touched.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.connectors.manager import router as access_router_mod
from src.connectors.manager.router import router as access_router
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser

ALLOWED = "proj-allowed"
FOREIGN = "proj-foreign"


class _FakeConnectorsClient:
    """Chainable Supabase stub returning one agent connector for the list query."""

    def __init__(self, rows):
        self._rows = rows

    def table(self, name):
        return self

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def in_(self, *a, **k):
        return self

    def order(self, *a, **k):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


def _install(monkeypatch, rows):
    monkeypatch.setattr(access_router_mod, "resolve_org_ids", lambda *a, **k: ["org-1"])
    monkeypatch.setattr(access_router_mod, "_get_user_project_ids", lambda *a, **k: [ALLOWED])
    monkeypatch.setattr(access_router_mod, "_get_client", lambda: _FakeConnectorsClient(rows))


def _app():
    app = FastAPI()
    app.include_router(access_router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id="user-alice", email="a@example.com", role="authenticated",
    )
    return app


def _agent_row():
    return {
        "id": "conn-1",
        "project_id": ALLOWED,
        "provider": "agent",
        "name": "My Agent",
        "status": "active",
        "direction": "outbound",
        "scope_id": None,  # keeps _enrich from querying repo_scopes
        "config": {"mcp_api_key": "mcpkey_abcd1234WXYZ", "name": "My Agent"},
        "trigger": None,
        "last_run_at": None,
        "error_message": None,
        "created_at": None,
        "updated_at": None,
    }


def test_foreign_project_returns_empty_no_idor(monkeypatch):
    _install(monkeypatch, rows=[_agent_row()])
    with TestClient(_app()) as tc:
        r = tc.get(f"/api/v1/access/?project_id={FOREIGN}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["data"] == [], "foreign project_id must yield an empty list (no IDOR)"


def test_member_list_masks_credentials(monkeypatch):
    _install(monkeypatch, rows=[_agent_row()])
    with TestClient(_app()) as tc:
        r = tc.get(f"/api/v1/access/?project_id={ALLOWED}")
    assert r.status_code == 200, r.text
    items = r.json()["data"]
    assert len(items) == 1
    conn = items[0]

    # Raw credential must NOT be present in the list view.
    assert conn["access_key"] is None
    # Masked indicators are present instead.
    assert conn["has_key"] is True
    assert conn["key_last4"] == "WXYZ"
    # And the raw secret must be stripped from the echoed config.
    assert "mcp_api_key" not in (conn.get("config") or {})
    # Non-secret config is preserved.
    assert (conn.get("config") or {}).get("name") == "My Agent"


def test_list_response_carries_no_raw_secret_anywhere(monkeypatch):
    """Belt-and-suspenders: the serialized body must not contain the raw key."""
    _install(monkeypatch, rows=[_agent_row()])
    with TestClient(_app()) as tc:
        r = tc.get(f"/api/v1/access/?project_id={ALLOWED}")
    assert "mcpkey_abcd1234WXYZ" not in r.text
