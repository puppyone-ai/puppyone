"""mcp_service.server list_tools/call_tool 行为测试。"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import mcp_service.server as server_module


class _FakeMcpServer:
    latest: "_FakeMcpServer | None" = None

    def __init__(self, _name: str):
        self.request_context = None
        self._list_tools_fn = None
        self._call_tool_fn = None
        _FakeMcpServer.latest = self

    def list_tools(self):
        def _decorator(fn):
            self._list_tools_fn = fn
            return fn

        return _decorator

    def call_tool(self):
        def _decorator(fn):
            self._call_tool_fn = fn
            return fn

        return _decorator


class _FakeSessionManager:
    def __init__(self, **_kwargs):
        pass

    async def handle_request(self, **_kwargs):
        return None

    class _RunCtx:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def run(self):
        return self._RunCtx()


class _FakeSessions:
    async def bind(self, *_args):
        return None

    async def notify_tools_list_changed(self, *_args):
        return 0


class _FakeRpc:
    def __init__(self):
        self.search_tool_query = AsyncMock(return_value={"results": [{"id": "r1"}]})
        self.close = AsyncMock()


class _FakeTableTool:
    def __init__(self, _rpc):
        self.get_data_schema = AsyncMock(return_value={"schema": {}})
        self.get_all_data = AsyncMock(return_value={"data": []})
        self.query_data = AsyncMock(return_value={"data": [{"k": "v"}]})
        self.create_element = AsyncMock(return_value={"created": 1})
        self.update_element = AsyncMock(return_value={"updated": 1})
        self.delete_element = AsyncMock(return_value={"deleted": 1})


class _FakeFsTool:
    latest: "_FakeFsTool | None" = None

    def __init__(self, _rpc):
        self.ls = AsyncMock(return_value={"entries": []})
        self.cat = AsyncMock(return_value={"content": "ok"})
        self.write = AsyncMock(return_value={"updated": True})
        self.mkdir = AsyncMock(return_value={"created": True})
        self.rm = AsyncMock(return_value={"removed": True})
        _FakeFsTool.latest = self


@pytest.fixture
def server_env(monkeypatch):
    fake_rpc = _FakeRpc()

    monkeypatch.setattr(server_module, "MCP_Server", _FakeMcpServer)
    monkeypatch.setattr(server_module, "StreamableHTTPSessionManager", _FakeSessionManager)
    monkeypatch.setattr(server_module, "SessionRegistry", lambda: _FakeSessions())
    monkeypatch.setattr(server_module, "create_client", lambda: fake_rpc)
    monkeypatch.setattr(server_module, "TableToolImplementation", _FakeTableTool)
    monkeypatch.setattr(server_module, "FsToolImplementation", _FakeFsTool)
    monkeypatch.setattr(server_module, "extract_api_key", lambda _req: "mcp_key")

    app = server_module.build_starlette_app()
    fake_server = _FakeMcpServer.latest
    assert fake_server is not None

    fake_server.request_context = SimpleNamespace(request=object(), session=object())

    return app, fake_server, fake_rpc


@pytest.mark.asyncio
async def test_list_tools_returns_agent_tools(server_env, monkeypatch):
    _app, fake_server, _fake_rpc = server_env
    monkeypatch.setattr(
        server_module,
        "load_mcp_config",
        AsyncMock(
            return_value={
                "mode": "agent",
                "agent": {"id": "agent-1", "name": "Agent", "project_id": "proj-1"},
                "accesses": [
                    {
                        "node_id": "n1",
                        "node_name": "docs",
                        "node_type": "folder",
                        "bash_readonly": False,
                        "tool_query": True,
                        "tool_create": True,
                        "tool_update": True,
                        "tool_delete": True,
                        "json_path": "",
                    }
                ],
                "tools": [],
            }
        ),
    )

    tools = await fake_server._list_tools_fn()
    names = {tool.name for tool in tools}
    assert {"ls", "cat", "write", "mkdir", "rm", "node_0_get_schema"}.issubset(names)


@pytest.mark.asyncio
async def test_call_tool_denies_write_when_all_accesses_readonly(server_env, monkeypatch):
    _app, fake_server, _fake_rpc = server_env
    monkeypatch.setattr(
        server_module,
        "load_mcp_config",
        AsyncMock(
            return_value={
                "mode": "agent",
                "agent": {"id": "agent-1", "project_id": "proj-1"},
                "accesses": [{"node_id": "n1", "node_name": "docs", "node_type": "folder", "bash_readonly": True}],
                "tools": [],
            }
        ),
    )

    out = await fake_server._call_tool_fn("write", {"path": "/x.md", "content": "x"})
    assert "没有写入权限" in out[0].text


@pytest.mark.asyncio
async def test_call_tool_routes_rm_and_uses_agent_id_as_user_id(server_env, monkeypatch):
    _app, fake_server, _fake_rpc = server_env
    monkeypatch.setattr(
        server_module,
        "load_mcp_config",
        AsyncMock(
            return_value={
                "mode": "agent",
                "agent": {"id": "agent-abc", "project_id": "proj-1"},
                "accesses": [{"node_id": "n1", "node_name": "docs", "node_type": "folder", "bash_readonly": False}],
                "tools": [],
            }
        ),
    )

    out = await fake_server._call_tool_fn("rm", {"path": "/docs/a.md"})
    payload = json.loads(out[0].text)
    assert payload["removed"] is True
    assert _FakeFsTool.latest is not None
    _FakeFsTool.latest.rm.assert_awaited_once_with(
        "proj-1",
        [{"node_id": "n1", "node_name": "docs", "node_type": "folder", "bash_readonly": False}],
        "/docs/a.md",
        user_id="agent-abc",
    )


@pytest.mark.asyncio
async def test_call_tool_custom_search_routes_to_rpc(server_env, monkeypatch):
    _app, fake_server, fake_rpc = server_env
    monkeypatch.setattr(
        server_module,
        "load_mcp_config",
        AsyncMock(
            return_value={
                "mode": "agent",
                "agent": {"id": "agent-1", "project_id": "proj-1"},
                "accesses": [],
                "tools": [{"name": "search_docs", "type": "search", "tool_id": "tool-1"}],
            }
        ),
    )

    out = await fake_server._call_tool_fn("tool_search_docs", {"query": "hello", "top_k": 3})
    payload = json.loads(out[0].text)
    assert payload["results"][0]["id"] == "r1"
    fake_rpc.search_tool_query.assert_awaited_once_with("tool-1", "hello", 3)


@pytest.mark.asyncio
async def test_call_tool_builtin_permission_denied(server_env, monkeypatch):
    _app, fake_server, _fake_rpc = server_env
    monkeypatch.setattr(
        server_module,
        "load_mcp_config",
        AsyncMock(
            return_value={
                "mode": "agent",
                "agent": {"id": "agent-1", "project_id": "proj-1"},
                "accesses": [
                    {
                        "node_id": "node-1",
                        "json_path": "",
                        "tool_query": False,
                        "tool_create": False,
                        "tool_update": False,
                        "tool_delete": False,
                    }
                ],
                "tools": [],
            }
        ),
    )

    out = await fake_server._call_tool_fn("node_0_query_data", {"query": "*"})
    assert "没有查询权限" in out[0].text


@pytest.mark.asyncio
async def test_call_tool_unknown_name_returns_error(server_env, monkeypatch):
    _app, fake_server, _fake_rpc = server_env
    monkeypatch.setattr(
        server_module,
        "load_mcp_config",
        AsyncMock(
            return_value={
                "mode": "agent",
                "agent": {"id": "agent-1", "project_id": "proj-1"},
                "accesses": [],
                "tools": [],
            }
        ),
    )

    out = await fake_server._call_tool_fn("unknown_tool", {})
    assert "未知的工具名称" in out[0].text

