from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.platform.project.orchestration import create_project_with_tree


class _Projects:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def create(self, **_kwargs):
        return SimpleNamespace(id="project-1")

    def delete(self, project_id: str):
        self.deleted.append(project_id)


@pytest.mark.asyncio
async def test_create_chain_deletes_project_when_tree_initialization_fails() -> None:
    projects = _Projects()

    class Admin:
        async def init_tree(self, _project_id: str):
            raise RuntimeError("tree failed")

    with pytest.raises(RuntimeError, match="tree failed"):
        await create_project_with_tree(
            project_service=projects,
            admin_service=Admin(),
            name="Copy",
            description=None,
            org_id="org-1",
            created_by="user-1",
        )

    assert projects.deleted == ["project-1"]


@pytest.mark.asyncio
async def test_create_chain_deletes_project_when_root_scope_fails(monkeypatch) -> None:
    projects = _Projects()

    class Admin:
        async def init_tree(self, _project_id: str):
            return "commit"

    class Scope:
        def ensure_root_scope(self, _project_id: str):
            raise RuntimeError("scope failed")

    monkeypatch.setattr("src.repo.scope_service.ScopeService", Scope)

    with pytest.raises(RuntimeError, match="scope failed"):
        await create_project_with_tree(
            project_service=projects,
            admin_service=Admin(),
            name="Copy",
            description=None,
            org_id="org-1",
            created_by="user-1",
        )

    assert projects.deleted == ["project-1"]
