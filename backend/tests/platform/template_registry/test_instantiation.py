from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from src.platform.project.models import Project
from src.platform.template_registry.instantiation import TemplateInstantiationService


def _project() -> Project:
    return Project(
        id="project-1",
        name="Starter copy",
        description="Copied",
        org_id="org-1",
        created_by="user-1",
        created_at=datetime.now(UTC),
    )


class _Registry:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def status(self):
        return SimpleNamespace(instantiation_enabled=True, reason=None)

    async def resolve_release(self, *, template_id: str, release_id: str | None):
        self.events.append("resolve")
        assert template_id == "hello"
        assert release_id == "1.0.0"
        return SimpleNamespace(
            template=SimpleNamespace(name="Hello", description="Starter description"),
            release=SimpleNamespace(id="1.0.0"),
            bundle=SimpleNamespace(files={"README.md": b"hello"}),
        )


class _Projects:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.deleted: list[str] = []

    def get_by_org_id(self, org_id: str):
        assert org_id == "org-1"
        return []

    def delete(self, project_id: str) -> None:
        self.events.append("delete")
        self.deleted.append(project_id)


class _Entitlements:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def require_capacity(self, org_id: str, key: str, *, current_count: int):
        self.events.append("capacity")
        assert (org_id, key, current_count) == ("org-1", "projects.max", 0)


class _Writes:
    def __init__(self, events: list[str], *, fail: bool = False) -> None:
        self.events = events
        self.fail = fail
        self.call = None

    async def bulk_write(self, project_id, files, **kwargs):
        self.events.append("write")
        self.call = (project_id, files, kwargs)
        if self.fail:
            raise RuntimeError("write failed")


@pytest.mark.asyncio
async def test_instantiation_verifies_before_project_and_commits_once(monkeypatch) -> None:
    events: list[str] = []
    projects = _Projects(events)
    writes = _Writes(events)

    async def create_project_with_tree(**kwargs):
        events.append("create")
        assert kwargs["name"] == "Custom copy"
        return _project()

    monkeypatch.setattr(
        "src.platform.template_registry.instantiation.create_project_with_tree",
        create_project_with_tree,
    )
    service = TemplateInstantiationService(
        registry=_Registry(events),  # type: ignore[arg-type]
        projects=projects,  # type: ignore[arg-type]
        entitlements=_Entitlements(events),  # type: ignore[arg-type]
        version_admin=SimpleNamespace(),  # type: ignore[arg-type]
        write_commands=writes,  # type: ignore[arg-type]
    )

    result = await service.instantiate(
        template_id="hello",
        release_id="1.0.0",
        project_name="Custom copy",
        project_description=None,
        org_id="org-1",
        actor_user_id="user-1",
    )

    assert events == ["capacity", "resolve", "create", "write"]
    assert result.project.id == "project-1"
    assert writes.call == (
        "project-1",
        {"README.md": b"hello"},
        {"actor": "user-1", "message": "template:hello@1.0.0"},
    )


@pytest.mark.asyncio
async def test_instantiation_compensates_project_when_write_fails(monkeypatch) -> None:
    events: list[str] = []
    projects = _Projects(events)

    async def create_project_with_tree(**_kwargs):
        events.append("create")
        return _project()

    monkeypatch.setattr(
        "src.platform.template_registry.instantiation.create_project_with_tree",
        create_project_with_tree,
    )
    service = TemplateInstantiationService(
        registry=_Registry(events),  # type: ignore[arg-type]
        projects=projects,  # type: ignore[arg-type]
        entitlements=_Entitlements(events),  # type: ignore[arg-type]
        version_admin=SimpleNamespace(),  # type: ignore[arg-type]
        write_commands=_Writes(events, fail=True),  # type: ignore[arg-type]
    )

    with pytest.raises(RuntimeError, match="write failed"):
        await service.instantiate(
            template_id="hello",
            release_id="1.0.0",
            project_name=None,
            project_description=None,
            org_id="org-1",
            actor_user_id="user-1",
        )

    assert events == ["capacity", "resolve", "create", "write", "delete"]
    assert projects.deleted == ["project-1"]
