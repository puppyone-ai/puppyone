"""mcp_service.core.config_loader tests (agent-only mode)."""

from __future__ import annotations

import pytest

from mcp_service.core.config_loader import load_mcp_config


class _FakeRpc:
    def __init__(self, *, agent_data: dict | None):
        self._agent_data = agent_data

    async def get_agent_by_mcp_key(self, api_key: str):
        return self._agent_data


@pytest.mark.asyncio
async def test_load_config_rejects_non_agent_key(monkeypatch):
    from mcp_service.cache import CacheManager

    async def _no_cache(_):
        return None

    async def _set_cache(*args, **kwargs):
        return None

    monkeypatch.setattr(CacheManager, "get_config", _no_cache)
    monkeypatch.setattr(CacheManager, "set_config", _set_cache)

    rpc = _FakeRpc(agent_data={"agent": {"id": "a1"}, "accesses": [], "tools": []})
    cfg = await load_mcp_config("legacy_key", rpc)  # type: ignore[arg-type]
    assert cfg is None


@pytest.mark.asyncio
async def test_load_config_agent_mode_success(monkeypatch):
    from mcp_service.cache import CacheManager

    async def _no_cache(_):
        return None

    async def _set_cache(*args, **kwargs):
        return None

    monkeypatch.setattr(CacheManager, "get_config", _no_cache)
    monkeypatch.setattr(CacheManager, "set_config", _set_cache)

    rpc = _FakeRpc(
        agent_data={
            "agent": {
                "id": "agent-1",
                "name": "My Agent",
                "project_id": "proj-1",
                "type": "custom",
            },
            "accesses": [
                {
                    "node_id": "node-1",
                    "bash_enabled": True,
                    "bash_readonly": False,
                    "tool_query": True,
                    "tool_create": True,
                    "tool_update": False,
                    "tool_delete": False,
                    "json_path": "/users",
                }
            ],
            "tools": [
                {
                    "id": "at-1",
                    "tool_id": "tool-1",
                    "name": "search_docs",
                    "type": "search",
                    "enabled": True,
                    "mcp_exposed": True,
                },
                {
                    "id": "at-2",
                    "tool_id": "tool-2",
                    "name": "hidden_tool",
                    "type": "search",
                    "enabled": False,
                    "mcp_exposed": True,
                },
            ],
        }
    )

    cfg = await load_mcp_config("mcp_valid_key", rpc)  # type: ignore[arg-type]
    assert cfg is not None
    assert cfg["mode"] == "agent"
    assert cfg["agent"]["id"] == "agent-1"
    assert len(cfg["accesses"]) == 1
    assert len(cfg["tools"]) == 1
    assert cfg["tools"][0]["tool_id"] == "tool-1"
