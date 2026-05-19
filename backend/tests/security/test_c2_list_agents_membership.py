"""C-2 — list_agents must verify project membership.

The vulnerability: GET /agent-config/?project_id=... only checked that the
caller had a valid JWT — not that the caller was a member of project_id.
Any logged-in user could list every agent (including system_prompt config)
of any project just by changing the query parameter.

These tests verify that the fix `require_project_membership_query` does
its job, both by accepting members and rejecting non-members.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.connectors.agent.config.dependencies import (
    get_agent_config_service,
    require_project_membership_query,
)
from src.connectors.agent.config.router import router as agent_config_router
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.version_engine.bootstrap.dependencies import get_product_operation_adapter


PROJECT_USER_BELONGS_TO = "proj-A"
PROJECT_USER_DOES_NOT_BELONG_TO = "proj-B"


def _make_app(verify_returns):
    """Build a TestClient app with the project access check stubbed."""
    app = FastAPI()
    app.include_router(agent_config_router, prefix="/api/v1")

    fake_user = CurrentUser(
        user_id="user-alice", email="a@example.com", role="authenticated",
    )

    def _user(): return fake_user

    fake_project_service = MagicMock()
    fake_project_service.verify_project_access.side_effect = verify_returns

    fake_agent_service = MagicMock()
    fake_agent_service.list_agents.return_value = []
    fake_agent_service.get_default_agent.return_value = None

    fake_ops = MagicMock()

    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_project_service] = lambda: fake_project_service
    app.dependency_overrides[get_agent_config_service] = lambda: fake_agent_service
    app.dependency_overrides[get_product_operation_adapter] = lambda: fake_ops
    return app, fake_project_service, fake_agent_service


def test_list_agents_member_succeeds():
    """Valid JWT + project membership → 200 with empty list."""
    def verify(project_id, user_id):
        return "member" if project_id == PROJECT_USER_BELONGS_TO else None

    app, project_svc, agent_svc = _make_app(verify)
    with TestClient(app) as client:
        r = client.get(
            f"/api/v1/agent-config/?project_id={PROJECT_USER_BELONGS_TO}"
        )

    assert r.status_code == 200, r.text
    project_svc.verify_project_access.assert_called_with(
        PROJECT_USER_BELONGS_TO, "user-alice"
    )
    agent_svc.list_agents.assert_called_once()


def test_list_agents_non_member_is_rejected_with_403():
    """Valid JWT but NOT a project member → 403, NO agent service call."""
    def verify(project_id, user_id):
        return None  # never a member of anything

    app, project_svc, agent_svc = _make_app(verify)
    with TestClient(app) as client:
        r = client.get(
            f"/api/v1/agent-config/?project_id={PROJECT_USER_DOES_NOT_BELONG_TO}"
        )

    assert r.status_code == 403, r.text
    assert "Not a member" in r.json().get("detail", "")
    # CRITICAL: agent service must NOT have been called — the fix must
    # gate access BEFORE any data is read.
    agent_svc.list_agents.assert_not_called()


def test_get_default_agent_non_member_is_rejected():
    """Same protection on /default endpoint."""
    def verify(project_id, user_id):
        return None

    app, project_svc, agent_svc = _make_app(verify)
    with TestClient(app) as client:
        r = client.get(
            f"/api/v1/agent-config/default?project_id={PROJECT_USER_DOES_NOT_BELONG_TO}"
        )

    assert r.status_code == 403, r.text
    agent_svc.get_default_agent.assert_not_called()


def test_create_agent_for_other_project_is_rejected():
    """create_agent reads project_id from BODY — fix must verify body too."""
    def verify(project_id, user_id):
        return None

    app, project_svc, agent_svc = _make_app(verify)
    with TestClient(app) as client:
        r = client.post(
            "/api/v1/agent-config/",
            json={
                "project_id": PROJECT_USER_DOES_NOT_BELONG_TO,
                "name": "Evil Agent",
            },
        )

    assert r.status_code == 403, r.text
    agent_svc.create_agent.assert_not_called()
