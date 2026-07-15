from __future__ import annotations

from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.exception_handler import app_exception_handler
from src.exceptions import AppException, ServiceUnavailableException
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.authorization.models import (
    ROLE_CAPABILITIES,
    GrantSource,
    ProjectGrant,
    ProjectRole,
)
from src.platform.project.models import Project
from src.platform.repository_target.models import ScopeTarget
from src.platform.workspace_binding.dependencies import get_workspace_binding_service
from src.platform.workspace_binding.models import (
    BindingMode,
    BindingStatus,
    CanonicalProjectContext,
    WorkspaceBinding,
)
from src.platform.workspace_binding.router import router

_CONTRACT_HEADERS = {"X-PuppyOne-Repository-Contract": "2"}


class CanonicalContextServiceStub:
    def __init__(self):
        now = datetime.now(UTC)
        target = ScopeTarget(project_id="project-1", scope_id="scope-child")
        self.context = CanonicalProjectContext(
            project=Project(
                id="project-1",
                name="Project One",
                description="Secret-free metadata",
                org_id="org-1",
                visibility="private",
                bound_git_branch="main",
                created_at=now,
                updated_at=now,
            ),
            grant=ProjectGrant(
                project_id="project-1",
                org_id="org-1",
                user_id="user-1",
                role=ProjectRole.EDITOR,
                source=GrantSource.PROJECT_MEMBER,
                capabilities=ROLE_CAPABILITIES[ProjectRole.EDITOR],
            ),
            target=target,
            scope_path="docs/private",
        )
        self.binding = WorkspaceBinding(
            id="binding-1",
            org_id="org-1",
            target=target,
            scope_path="docs/private",
            workspace_instance_id="workspace-instance-0001",
            bound_user_id="user-1",
            cloud_origin="https://cloud.puppyone.ai",
            mode=BindingMode.READ,
            status=BindingStatus.ACTIVE,
            created_at=now,
            updated_at=now,
            last_seen_at=now,
        )

    def resolve_canonical_remote(self, remote_url, user_id, *, expected_origin=None):
        assert remote_url == ("https://cloud.puppyone.ai/git/project-1/scopes/scope-child.git")
        assert user_id == "user-1"
        assert expected_origin
        return self.context

    def resolve_legacy_remote(self, remote_url, user_id, *, expected_origin=None):
        assert remote_url == "https://cloud.puppyone.ai/git/ap/masked-token.git"
        assert user_id == "user-1"
        assert expected_origin
        return self.context.target

    def get(self, binding_id, user_id):
        assert binding_id == "binding-1"
        assert user_id == "user-1"
        return self.binding, True, None, self.context.grant


def _app(service=None) -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.add_exception_handler(AppException, app_exception_handler)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id="user-1",
        email="user@example.com",
        role="authenticated",
    )
    app.dependency_overrides[get_workspace_binding_service] = lambda: (
        service or CanonicalContextServiceStub()
    )
    return app


def test_canonical_remote_route_returns_exact_secret_free_context():
    response = TestClient(_app()).post(
        "/api/v1/desktop/project-bindings/resolve-canonical-remote",
        headers=_CONTRACT_HEADERS,
        json={"remote_url": ("https://cloud.puppyone.ai/git/project-1/scopes/scope-child.git")},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["target"] == {
        "kind": "scope",
        "project_id": "project-1",
        "scope_id": "scope-child",
    }
    assert data["project"]["id"] == "project-1"
    assert data["project"]["effective_role"] == "editor"
    assert "content.read" in data["project"]["capabilities"]
    assert data["scope_path"] == "docs/private"
    serialized = response.text.lower()
    assert "requires_confirmation" not in serialized
    assert "binding_kind" not in serialized
    assert "credential" not in serialized
    assert "masked-token" not in serialized


def test_legacy_remote_route_remains_confirmation_gated():
    response = TestClient(_app()).post(
        "/api/v1/desktop/project-bindings/resolve-legacy-remote",
        headers=_CONTRACT_HEADERS,
        json={"remote_url": "https://cloud.puppyone.ai/git/ap/masked-token.git"},
    )

    assert response.status_code == 200
    assert response.json()["data"] == {
        "target": {
            "kind": "scope",
            "project_id": "project-1",
            "scope_id": "scope-child",
        },
        "requires_confirmation": True,
    }


def test_binding_context_returns_current_human_capabilities():
    response = TestClient(_app()).get(
        "/api/v1/workspace-bindings/binding-1",
        headers=_CONTRACT_HEADERS,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["target"] == {
        "kind": "scope",
        "project_id": "project-1",
        "scope_id": "scope-child",
    }
    assert "project.read" in data["capabilities"]
    assert "agent.read" in data["capabilities"]
    assert data["credential"] is None


def test_binding_route_preserves_retryable_authorization_unavailability():
    class UnavailableService(CanonicalContextServiceStub):
        def get(self, binding_id, user_id):
            raise ServiceUnavailableException("Project authorization is temporarily unavailable")

    response = TestClient(_app(UnavailableService())).get(
        "/api/v1/workspace-bindings/binding-1",
        headers=_CONTRACT_HEADERS,
    )

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert response.json() == {
        "code": 1000,
        "message": "Project authorization is temporarily unavailable",
        "data": {"retryable": True},
    }
