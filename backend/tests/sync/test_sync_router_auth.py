from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.project.dependencies import get_project_service
from src.connectors.datasource.dependencies import get_sync_service
from src.connectors.datasource.router import router


class StubProjectService:
    def __init__(self, allowed_projects: set[str]):
        self.allowed_projects = allowed_projects

    def verify_project_access(self, project_id: str, user_id: str) -> bool:
        return project_id in self.allowed_projects


class StubSyncRepo:
    def __init__(self):
        self.list_by_project_calls: list[str] = []
        self.sync_allowed = SimpleNamespace(
            id="sync-allowed",
            project_id="project-allowed",
            node_id="node-1",
            direction="bidirectional",
            provider="filesystem",
            config={},
            status="active",
            last_sync_version=3,
            error_message=None,
            access_key="access-key-123",
            last_synced_at=None,
            trigger={},
            authority="authoritative",
            credentials_ref=None,
            conflict_strategy=None,
            remote_hash=None,
        )
        self.sync_other = SimpleNamespace(
            id="sync-other",
            project_id="project-other",
            node_id="node-2",
            direction="bidirectional",
            provider="filesystem",
            config={},
            status="active",
            last_sync_version=1,
            error_message=None,
            access_key="access-key-other",
            last_synced_at=None,
            trigger={},
            authority="authoritative",
            credentials_ref=None,
            conflict_strategy=None,
            remote_hash=None,
        )
        self.by_id = {
            self.sync_allowed.id: self.sync_allowed,
            self.sync_other.id: self.sync_other,
        }

    def list_by_project(self, project_id: str):
        self.list_by_project_calls.append(project_id)
        return [
            s for s in (self.sync_allowed, self.sync_other)
            if s.project_id == project_id
        ]

    def list_by_provider(self, project_id: str, provider: str):
        return [
            s for s in self.list_by_project(project_id)
            if s.provider == provider
        ]

    def list_active(self, provider=None):
        raise AssertionError("list_active should not be used by authenticated routes")

    def get_by_id(self, sync_id: str):
        return self.by_id.get(sync_id)


class StubSyncService:
    def __init__(self, repo: StubSyncRepo):
        self.sync_repo = repo
        self.removed: list[str] = []
        self.paused: list[str] = []
        self.resumed: list[str] = []

    def remove_sync(self, sync_id: str) -> None:
        self.removed.append(sync_id)

    def pause_sync(self, sync_id: str) -> None:
        self.paused.append(sync_id)

    def resume_sync(self, sync_id: str) -> None:
        self.resumed.append(sync_id)


@pytest.fixture
def current_user() -> CurrentUser:
    return CurrentUser(
        user_id="user-1",
        role="authenticated",
        email="u@example.com",
    )


def _build_client(*, allowed_projects: set[str], current_user: CurrentUser):
    repo = StubSyncRepo()
    sync_svc = StubSyncService(repo)
    project_svc = StubProjectService(allowed_projects)

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_sync_service] = lambda: sync_svc
    app.dependency_overrides[get_project_service] = lambda: project_svc
    app.dependency_overrides[get_current_user] = lambda: current_user
    client = TestClient(app)
    return client, repo, sync_svc


def test_status_forbidden_without_project_access(current_user: CurrentUser):
    client, repo, _ = _build_client(
        allowed_projects=set(),
        current_user=current_user,
    )
    response = client.get("/api/v1/sync/status", params={"project_id": "project-other"})
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"
    assert repo.list_by_project_calls == []


def test_status_authorized_can_read_openclaw_access_key(current_user: CurrentUser):
    client, _, _ = _build_client(
        allowed_projects={"project-allowed"},
        current_user=current_user,
    )
    response = client.get(
        "/api/v1/sync/status",
        params={"project_id": "project-allowed"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["data"]["syncs"][0]["access_key"] == "access-key-123"


def test_list_syncs_requires_project_id(current_user: CurrentUser):
    client, _, _ = _build_client(
        allowed_projects={"project-allowed"},
        current_user=current_user,
    )
    response = client.get("/api/v1/sync/syncs")
    assert response.status_code == 400
    assert response.json()["detail"] == "project_id is required"


def test_list_syncs_forbidden_without_project_access(current_user: CurrentUser):
    client, _, _ = _build_client(
        allowed_projects=set(),
        current_user=current_user,
    )
    response = client.get(
        "/api/v1/sync/syncs",
        params={"project_id": "project-other"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("delete", "/api/v1/sync/syncs/sync-other"),
        ("post", "/api/v1/sync/syncs/sync-other/pause"),
        ("post", "/api/v1/sync/syncs/sync-other/resume"),
    ],
)
def test_sync_management_routes_forbid_other_project(
    method: str,
    path: str,
    current_user: CurrentUser,
):
    client, _, _ = _build_client(
        allowed_projects={"project-allowed"},
        current_user=current_user,
    )
    response = getattr(client, method)(path)
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


def test_bootstrap_openclaw_forbidden_without_project_access(current_user: CurrentUser):
    client, _, _ = _build_client(
        allowed_projects=set(),
        current_user=current_user,
    )
    response = client.post(
        "/api/v1/sync/syncs/openclaw/bootstrap",
        params={"project_id": "project-other", "node_id": "node-2"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"
