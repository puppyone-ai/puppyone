from __future__ import annotations

from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.authorization.dependencies import get_authorization_service
from src.platform.authorization.models import (
    ROLE_CAPABILITIES,
    GrantSource,
    ProjectGrant,
    ProjectRole,
)
from src.platform.project.dependencies import get_project_repository
from src.platform.project.models import Project
from src.platform.repository_context.dependencies import get_repository_context_service
from src.platform.repository_context.models import (
    GitCredentialMode,
    IssuedGitCredential,
    RepositoryProjectContext,
)
from src.platform.repository_context.router import router
from src.platform.repository_target.models import ProjectRootTarget, ScopeTarget

_CONTRACT_HEADERS = {"X-PuppyOne-Repository-Contract": "2"}


def _project():
    now = datetime.now(UTC)
    return Project(
        id="project-1",
        name="Project One",
        description="Secret-free metadata",
        org_id="org-1",
        visibility="private",
        bound_git_branch="main",
        created_at=now,
        updated_at=now,
    )


def _grant():
    return ProjectGrant(
        project_id="project-1",
        org_id="org-1",
        user_id="user-1",
        role=ProjectRole.EDITOR,
        source=GrantSource.PROJECT_MEMBER,
        capabilities=ROLE_CAPABILITIES[ProjectRole.EDITOR],
    )


class ServiceStub:
    def get_repository_context(self, project_id, user_id, target):
        assert project_id == "project-1" and user_id == "user-1"
        assert target.scope_id == "scope-child"
        return RepositoryProjectContext(
            project=_project(),
            grant=_grant(),
            target=ScopeTarget(project_id="project-1", scope_id="scope-child"),
            scope_path="docs/private",
        )

    def issue_git_credential(self, project_id, user_id, target, mode):
        assert project_id == "project-1" and user_id == "user-1"
        return IssuedGitCredential(
            credential_id="credential-1",
            target=ProjectRootTarget(project_id="project-1"),
            mode=mode,
            credential="pwg_one-time-secret",
        )

    def revoke_git_credential(self, project_id, user_id, credential_id):
        assert (project_id, user_id, credential_id) == ("project-1", "user-1", "credential-1")


class AuthorizationStub:
    def authorize(self, project_id, user_id, _action):
        assert project_id == "project-1" and user_id == "user-1"
        return _grant()


class ProjectRepositoryStub:
    def get_by_id(self, project_id):
        return _project() if project_id == "project-1" else None


def _app():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id="user-1", email="user@example.com", role="authenticated"
    )
    app.dependency_overrides[get_repository_context_service] = ServiceStub
    app.dependency_overrides[get_authorization_service] = AuthorizationStub
    app.dependency_overrides[get_project_repository] = ProjectRepositoryStub
    return app


def test_repository_context_route_returns_secret_free_project_context():
    response = TestClient(_app()).post(
        "/api/v1/projects/project-1/repository-context",
        headers=_CONTRACT_HEADERS,
        json={
            "target": {
                "kind": "scope",
                "project_id": "project-1",
                "scope_id": "scope-child",
            }
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["target"] == {
        "kind": "scope",
        "project_id": "project-1",
        "scope_id": "scope-child",
    }
    assert data["project"]["effective_role"] == "editor"
    assert data["scope_path"] == "docs/private"
    assert "credential" not in response.text.lower()
    assert "workspace_instance" not in response.text.lower()


def test_git_credential_route_returns_one_time_secret_for_exact_remote():
    response = TestClient(_app()).post(
        "/api/v1/projects/project-1/git-credentials",
        headers=_CONTRACT_HEADERS,
        json={
            "target": {"kind": "project_root", "project_id": "project-1"},
            "mode": GitCredentialMode.READ_WRITE.value,
        },
    )
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["credential"] == "pwg_one-time-secret"
    assert data["remote"]["target"] == {
        "kind": "project_root",
        "project_id": "project-1",
    }
    assert data["remote"]["username"] == "x-puppyone-token"


def test_git_credential_route_revokes_only_the_named_user_credential():
    response = TestClient(_app()).delete(
        "/api/v1/projects/project-1/git-credentials/credential-1",
        headers=_CONTRACT_HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["data"] == {"id": "credential-1", "revoked": True}
