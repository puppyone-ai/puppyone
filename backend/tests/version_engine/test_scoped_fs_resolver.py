from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.version_engine.scoped_fs import resolver


class _Query:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _Supabase:
    def __init__(self, tables: dict[str, list[dict]]):
        self._tables = tables

    def table(self, name: str):
        return _Query(self._tables.get(name, []))


class _McpEndpointRepo:
    def __init__(self, endpoint: dict | None):
        self._endpoint = endpoint

    def get_by_api_key(self, api_key: str):
        assert api_key == "mcp_key"
        return self._endpoint


def test_resolver_builds_writable_context_when_scope_and_access_are_rw(monkeypatch):
    endpoint = {
        "id": "endpoint-1",
        "name": "Files",
        "project_id": "proj-1",
        "scope_id": "scope-1",
        "status": "active",
        "created_by": "user-1",
        "accesses": [{"readonly": False}],
        "tools_config": {},
    }
    sb = _Supabase({
        "repo_scopes": [{
            "id": "scope-1",
            "project_id": "proj-1",
            "path": "docs",
            "exclude": ["private"],
            "mode": "rw",
        }],
    })
    monkeypatch.setattr(resolver, "get_supabase_client", lambda: sb)
    monkeypatch.setattr(resolver, "McpEndpointRepository", lambda: _McpEndpointRepo(endpoint))

    ctx = resolver.resolve_mcp_scoped_fs_context("mcp_key")

    assert ctx.endpoint_id == "endpoint-1"
    assert ctx.project_id == "proj-1"
    assert ctx.user_id == "user-1"
    assert ctx.scope_path == "docs"
    assert ctx.exclude == ["private"]
    assert ctx.mode == "rw"
    assert ctx.allowed_tools is not None
    assert "fs_write" in ctx.allowed_tools
    assert "fs_rm" not in ctx.allowed_tools


def test_resolver_downgrades_to_readonly_without_writable_access(monkeypatch):
    endpoint = {
        "id": "endpoint-1",
        "name": "Files",
        "project_id": "proj-1",
        "scope_id": "scope-1",
        "status": "active",
        "accesses": [{"readonly": True}],
        "tools_config": {},
    }
    sb = _Supabase({
        "repo_scopes": [{
            "id": "scope-1",
            "project_id": "proj-1",
            "path": "",
            "exclude": [],
            "mode": "rw",
        }],
        "projects": [{"created_by": "project-owner"}],
    })
    monkeypatch.setattr(resolver, "get_supabase_client", lambda: sb)
    monkeypatch.setattr(resolver, "McpEndpointRepository", lambda: _McpEndpointRepo(endpoint))

    ctx = resolver.resolve_mcp_scoped_fs_context("mcp_key")

    assert ctx.mode == "ro"
    assert ctx.user_id == "project-owner"
    assert ctx.allowed_tools is not None
    assert "fs_ls" in ctx.allowed_tools
    assert "fs_write" not in ctx.allowed_tools


def test_resolver_applies_mcp_tools_config(monkeypatch):
    endpoint = {
        "id": "endpoint-1",
        "name": "Files",
        "project_id": "proj-1",
        "scope_id": "scope-1",
        "status": "active",
        "created_by": "user-1",
        "accesses": [{"readonly": False}],
        "tools_config": {
            "filesystem": {
                "allowed": ["fs_ls", "fs_rm"],
            },
        },
    }
    sb = _Supabase({
        "repo_scopes": [{
            "id": "scope-1",
            "project_id": "proj-1",
            "path": "docs",
            "exclude": [],
            "mode": "rw",
        }],
    })
    monkeypatch.setattr(resolver, "get_supabase_client", lambda: sb)
    monkeypatch.setattr(resolver, "McpEndpointRepository", lambda: _McpEndpointRepo(endpoint))

    ctx = resolver.resolve_mcp_scoped_fs_context("mcp_key")

    assert ctx.allowed_tools == frozenset({"fs_ls", "fs_rm"})


def test_resolver_rejects_non_mcp_key():
    with pytest.raises(HTTPException) as exc:
        resolver.resolve_mcp_scoped_fs_context("cli_key")

    assert exc.value.status_code == 401
