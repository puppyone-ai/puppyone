from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from src.platform.project.control_plane import IdempotentProjectResult
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
            release=SimpleNamespace(id="1.0.0", bundle_sha256="a" * 64),
            bundle=SimpleNamespace(files={"README.md": b"hello"}),
        )


class _Entitlements:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def enforced_limit_value(self, org_id: str, key: str):
        self.events.append("capacity")
        assert (org_id, key) == ("org-1", "projects.max")
        return 3


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
    writes = _Writes(events)

    async def create_project_with_tree(**kwargs):
        events.append("create")
        assert kwargs["name"] == "Custom copy"
        assert kwargs["operation_key"] == "123e4567-e89b-42d3-a456-426614174000"
        assert kwargs["publication_mode"] == "deferred"
        assert kwargs["source_fingerprint"] == {
            "kind": "template-instantiation",
            "template_id": "hello",
            "release_id": "1.0.0",
            "bundle_sha256": "a" * 64,
        }
        await kwargs["initialize"](_project())
        return IdempotentProjectResult(project=_project(), replayed=False, ready=True)

    monkeypatch.setattr(
        "src.platform.template_registry.instantiation.create_project_with_tree",
        create_project_with_tree,
    )
    service = TemplateInstantiationService(
        registry=_Registry(events),  # type: ignore[arg-type]
        control_plane=SimpleNamespace(),  # type: ignore[arg-type]
        entitlements=_Entitlements(events),  # type: ignore[arg-type]
        version_engine=SimpleNamespace(),  # type: ignore[arg-type]
        write_commands=writes,  # type: ignore[arg-type]
    )

    result = await service.instantiate(
        template_id="hello",
        release_id="1.0.0",
        project_name="Custom copy",
        project_description=None,
        org_id="org-1",
        actor_user_id="user-1",
        operation_key="123e4567-e89b-42d3-a456-426614174000",
    )

    assert events == ["resolve", "capacity", "create", "write"]
    assert result.project.id == "project-1"
    assert writes.call == (
        "project-1",
        {"README.md": b"hello"},
        {"actor": "user-1", "message": "template:hello@1.0.0"},
    )


@pytest.mark.asyncio
async def test_instantiation_propagates_deferred_initializer_failure(monkeypatch) -> None:
    events: list[str] = []

    async def create_project_with_tree(**kwargs):
        events.append("create")
        await kwargs["initialize"](_project())
        raise AssertionError("unreachable")

    monkeypatch.setattr(
        "src.platform.template_registry.instantiation.create_project_with_tree",
        create_project_with_tree,
    )
    service = TemplateInstantiationService(
        registry=_Registry(events),  # type: ignore[arg-type]
        control_plane=SimpleNamespace(),  # type: ignore[arg-type]
        entitlements=_Entitlements(events),  # type: ignore[arg-type]
        version_engine=SimpleNamespace(),  # type: ignore[arg-type]
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
            operation_key="123e4567-e89b-42d3-a456-426614174000",
        )

    assert events == ["resolve", "capacity", "create", "write"]
