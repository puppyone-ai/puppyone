from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from src.platform.project.models import Project
from src.platform.project.service import ProjectService, resolve_untitled_project_name
from src.platform.project import router as project_router


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
    service = ProjectService(repo, MagicMock())  # type: ignore[arg-type]
    monkeypatch.setattr(service, "add_project_member", lambda *args, **kwargs: {})

    created = service.create(
        name="Untitled Project 5",
        description=None,
        org_id="org-1",
        created_by="user-1",
    )

    assert created.name == "Untitled Project 3"
    assert repo.created_name == "Untitled Project 3"


class _FakeQuery:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.filters: list[tuple[str, set]] = []

    def select(self, *_args, **_kwargs):
        return self

    def in_(self, col, values):
        self.filters.append((col, set(values)))
        return self

    def execute(self):
        rows = list(self.rows)
        for col, values in self.filters:
            rows = [row for row in rows if row.get(col) in values]
        return SimpleNamespace(data=rows)


class _FakeSupabase:
    def __init__(self, tables: dict[str, list[dict]]):
        self.tables = tables

    def table(self, name):
        return _FakeQuery(self.tables.get(name, []))


def test_project_access_point_count_reads_target_tables(monkeypatch):
    sb = _FakeSupabase({
        "connections": [
            {"project_id": "p1"},
            {"project_id": "p1"},
            {"project_id": "p2"},
        ],
        "access_surfaces": [
            {"project_id": "p1", "kind": "mcp"},
            {"project_id": "p1", "kind": "git_remote"},
            {"project_id": "p2", "kind": "agent"},
        ],
    })
    monkeypatch.setattr(project_router, "get_supabase_client", lambda: sb)

    counts = project_router._count_user_access_points(["p1", "p2"])

    assert counts == {"p1": 3, "p2": 1}
