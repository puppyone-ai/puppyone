from datetime import UTC, datetime

from src.platform.project.models import Project
from src.platform.project.service import ProjectService, resolve_untitled_project_name


def _project(name: str, project_id: str = "project-id") -> Project:
    return Project(
        id=project_id,
        name=name,
        description=None,
        org_id="org-1",
        created_by="user-1",
        created_at=datetime.now(UTC),
    )


def test_resolve_untitled_project_name_uses_existing_names_not_project_count():
    existing = [
        _project("Untitled Project", "p1"),
        _project("Untitled Project 2", "p2"),
        _project("Untitled Project 4", "p4"),
        _project("Untitled Project 5", "p5"),
    ]

    assert resolve_untitled_project_name("Untitled Project 5", existing) == "Untitled Project 3"


def test_resolve_untitled_project_name_keeps_available_requested_slot():
    existing = [
        _project("Untitled Project", "p1"),
        _project("Untitled Project 2", "p2"),
    ]

    assert resolve_untitled_project_name("Untitled Project 4", existing) == "Untitled Project 4"


def test_resolve_untitled_project_name_leaves_custom_names_alone():
    assert resolve_untitled_project_name("Research", [_project("Research", "p1")]) == "Research"


class FakeProjectRepository:
    def __init__(self, existing: list[Project]):
        self.existing = existing
        self.created_name: str | None = None

    def get_by_id(self, project_id: str):
        return None

    def get_by_org_id(self, org_id: str) -> list[Project]:
        return self.existing

    def create(self, name: str, description: str | None, org_id: str, created_by: str) -> Project:
        self.created_name = name
        return _project(name, "created")

    def update(self, project_id: str, name: str | None, description: str | None, **kwargs):
        return None

    def delete(self, project_id: str) -> bool:
        return False

    def verify_project_access(self, project_id: str, user_id: str):
        return None


def test_project_service_create_resolves_stale_untitled_names(monkeypatch):
    repo = FakeProjectRepository([
        _project("Untitled Project", "p1"),
        _project("Untitled Project 2", "p2"),
        _project("Untitled Project 4", "p4"),
        _project("Untitled Project 5", "p5"),
    ])
    service = ProjectService(repo)  # type: ignore[arg-type]
    monkeypatch.setattr(service, "add_project_member", lambda *args, **kwargs: {})

    created = service.create(
        name="Untitled Project 5",
        description=None,
        org_id="org-1",
        created_by="user-1",
    )

    assert created.name == "Untitled Project 3"
    assert repo.created_name == "Untitled Project 3"
