"""src.internal.router 中 MCP POSIX internal 端点测试。"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.content_node.dependencies import get_content_node_service
from src.content_node.models import ContentNode
from src.exceptions import BusinessException
from src.internal import router as internal_router_module
from src.internal.router import get_agent_config_service, router as internal_router, verify_internal_secret


def _node(
    node_id: str,
    *,
    project_id: str = "proj-1",
    name: str,
    node_type: str,
    parent_id: str | None = None,
    preview_json=None,
    preview_md: str | None = None,
    s3_key: str | None = None,
) -> ContentNode:
    now = datetime.now(UTC)
    return ContentNode(
        id=node_id,
        project_id=project_id,
        created_by="u1",
        sync_oauth_user_id=None,
        parent_id=parent_id,
        name=name,
        type=node_type,
        id_path=f"/{node_id}" if parent_id is None else f"/{parent_id}/{node_id}",
        preview_json=preview_json,
        preview_md=preview_md,
        s3_key=s3_key,
        mime_type="text/plain" if s3_key else None,
        size_bytes=12,
        permissions={"inherit": True},
        sync_url=None,
        sync_id=None,
        sync_config=None,
        sync_status="idle",
        last_synced_at=None,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def app():
    test_app = FastAPI()
    test_app.include_router(internal_router)
    return test_app


@pytest.fixture
def node_service_mock():
    service = Mock()
    service.resolve_path = Mock()
    service.build_display_path = Mock()
    service.list_children = Mock()
    service.get_by_id = Mock()
    service.update_markdown_content = AsyncMock()
    service.update_node = Mock()
    service.create_folder = Mock()
    service.create_json_node = Mock()
    service.create_markdown_node = AsyncMock()
    service.soft_delete_node = Mock()
    return service


@pytest.fixture
def client(app, node_service_mock):
    app.dependency_overrides[verify_internal_secret] = lambda: None
    app.dependency_overrides[get_content_node_service] = lambda: node_service_mock
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_resolve_node_path_success(client, node_service_mock):
    resolved = _node("md-1", name="readme.md", node_type="markdown", parent_id="folder-1")
    node_service_mock.resolve_path.return_value = resolved
    node_service_mock.build_display_path.return_value = "/docs/readme.md"

    resp = client.post(
        "/internal/nodes/resolve-path",
        json={
            "project_id": "proj-1",
            "root_accesses": [{"node_id": "folder-1", "node_name": "docs", "node_type": "folder"}],
            "path": "/docs/readme.md",
        },
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["node_id"] == "md-1"
    assert body["type"] == "markdown"
    assert body["path"] == "/docs/readme.md"


def test_resolve_node_path_virtual_root(client, node_service_mock):
    node_service_mock.resolve_path.side_effect = BusinessException("VIRTUAL_ROOT")

    resp = client.post(
        "/internal/nodes/resolve-path",
        json={"project_id": "proj-1", "root_accesses": [], "path": "/"},
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"virtual_root": True, "path": "/"}


def test_list_node_children_filters_trash(client, node_service_mock):
    node_service_mock.list_children.return_value = [
        _node("trash", name=internal_router_module.ContentNodeService.TRASH_FOLDER_NAME, node_type="folder", parent_id="p1"),
        _node("md-1", name="readme.md", node_type="markdown", parent_id="p1"),
    ]

    resp = client.get(
        "/internal/nodes/p1/children?project_id=proj-1",
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["parent_id"] == "p1"
    assert [child["name"] for child in body["children"]] == ["readme.md"]


def test_read_node_content_json_returns_content(client, node_service_mock):
    node_service_mock.get_by_id.return_value = _node(
        "json-1", name="users.json", node_type="json", preview_json={"users": []}
    )

    resp = client.get(
        "/internal/nodes/json-1/content?project_id=proj-1",
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "json"
    assert body["content"] == {"users": []}


def test_read_node_content_folder_returns_children_without_trash(client, node_service_mock):
    node_service_mock.get_by_id.return_value = _node("folder-1", name="docs", node_type="folder")
    node_service_mock.list_children.return_value = [
        _node("trash", name=internal_router_module.ContentNodeService.TRASH_FOLDER_NAME, node_type="folder", parent_id="folder-1"),
        _node("child-1", name="guide.md", node_type="markdown", parent_id="folder-1"),
    ]

    resp = client.get(
        "/internal/nodes/folder-1/content?project_id=proj-1",
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "folder"
    assert [child["name"] for child in body["children"]] == ["guide.md"]


def test_write_node_content_markdown_requires_string(client, node_service_mock):
    node_service_mock.get_by_id.return_value = _node("md-1", name="readme.md", node_type="markdown")

    resp = client.put(
        "/internal/nodes/md-1/content",
        json={"project_id": "proj-1", "content": {"bad": "type"}},
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 400
    assert "Markdown content must be a string" in resp.json()["detail"]


def test_write_node_content_markdown_success(client, node_service_mock):
    md_node = _node("md-1", name="readme.md", node_type="markdown")
    node_service_mock.get_by_id.return_value = md_node
    node_service_mock.update_markdown_content.return_value = md_node

    resp = client.put(
        "/internal/nodes/md-1/content",
        json={"project_id": "proj-1", "content": "# title"},
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 200
    assert resp.json()["updated"] is True
    node_service_mock.update_markdown_content.assert_awaited_once_with("md-1", "proj-1", "# title")


def test_create_node_routes_to_expected_service_method(client, node_service_mock):
    folder_node = _node("f1", name="docs", node_type="folder", parent_id="p1")
    node_service_mock.create_folder.return_value = folder_node

    resp = client.post(
        "/internal/nodes/create",
        json={
            "project_id": "proj-1",
            "parent_id": "p1",
            "name": "docs",
            "node_type": "folder",
        },
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 200
    assert resp.json()["created"] is True
    node_service_mock.create_folder.assert_called_once_with("proj-1", "docs", "p1", None)


def test_create_node_rejects_unsupported_type(client):
    resp = client.post(
        "/internal/nodes/create",
        json={
            "project_id": "proj-1",
            "parent_id": "p1",
            "name": "bad.bin",
            "node_type": "file",
        },
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 400
    assert "Unsupported node type" in resp.json()["detail"]


def test_trash_node_defaults_user_id_to_system(client, node_service_mock):
    resp = client.post(
        "/internal/nodes/n1/trash",
        json={"project_id": "proj-1"},
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 200
    assert resp.json()["removed"] is True
    node_service_mock.soft_delete_node.assert_called_once_with("n1", "proj-1", "system")


def test_get_agent_by_mcp_key_enriches_access_with_node_info(client, app, monkeypatch):
    bash_access = SimpleNamespace(node_id="node-1", readonly=False, json_path="/users")
    agent_tool = SimpleNamespace(id="at-1", tool_id="tool-1", enabled=True, mcp_exposed=True)
    agent = SimpleNamespace(
        id="agent-1",
        name="Agent",
        project_id="proj-1",
        type="custom",
        bash_accesses=[bash_access],
        tools=[agent_tool],
    )

    class _AgentService:
        def get_by_mcp_api_key(self, mcp_api_key: str):
            assert mcp_api_key == "mcp_k"
            return agent

    class _FakeToolRepo:
        def __init__(self, _repo):
            pass

        def get_by_id(self, tool_id: str):
            assert tool_id == "tool-1"
            return SimpleNamespace(
                id="tool-1",
                name="search_docs",
                type="search",
                description="Search docs",
                node_id="node-1",
                json_path="",
                input_schema={"type": "object"},
                category="builtin",
            )

    class _FakeNodeRepo:
        def get_by_id(self, node_id: str):
            assert node_id == "node-1"
            return SimpleNamespace(name="docs", type="folder")

    monkeypatch.setattr(internal_router_module, "ToolRepositorySupabase", _FakeToolRepo)
    monkeypatch.setattr(internal_router_module, "get_supabase_repository", lambda: object())

    import src.content_node.dependencies as content_node_deps
    import src.supabase.client as sb_client

    monkeypatch.setattr(content_node_deps, "get_content_node_repository", lambda _sb: _FakeNodeRepo())
    monkeypatch.setattr(sb_client, "SupabaseClient", lambda: object())

    app.dependency_overrides[get_agent_config_service] = lambda: _AgentService()

    resp = client.get(
        "/internal/agent-by-mcp-key/mcp_k",
        headers={"X-Internal-Secret": "ignored"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["agent"]["id"] == "agent-1"
    assert body["accesses"][0]["node_name"] == "docs"
    assert body["accesses"][0]["node_type"] == "folder"
    assert body["tools"][0]["tool_id"] == "tool-1"

