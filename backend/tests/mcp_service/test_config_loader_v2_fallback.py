"""
mcp_service.core.config_loader v2/legacy fallback 测试（轻量）

不依赖真实网络，通过 fake rpc_client 验证：
- v2 可用时优先走 v2
- v2 不可用时回退 legacy
"""

from __future__ import annotations

import pytest

from mcp_service.core.config_loader import load_mcp_config


class _FakeRpc:
    def __init__(self, *, v2: dict | None, legacy: object | None):
        self._v2 = v2
        self._legacy = legacy

    async def get_mcp_v2_instance_and_tools(self, api_key: str):
        return self._v2

    async def get_mcp_instance(self, api_key: str):
        return self._legacy

    async def get_table_metadata(self, table_id: int):
        # legacy path needs table metadata
        return type("T", (), {"table_id": table_id, "name": "n", "description": "", "project_id": 1})()


@pytest.mark.asyncio
async def test_load_config_prefers_v2(monkeypatch):
    # disable cache for deterministic test
    from mcp_service.cache import CacheManager

    async def _no_cache(_):
        return None

    monkeypatch.setattr(CacheManager, "get_config", _no_cache)
    monkeypatch.setattr(CacheManager, "set_config", lambda *args, **kwargs: None)

    rpc = _FakeRpc(
        v2={"mcp_v2": {"api_key": "k", "status": True}, "bound_tools": []},
        legacy=None,
    )
    cfg = await load_mcp_config("k", rpc)  # type: ignore[arg-type]
    assert cfg is not None
    assert cfg["mode"] == "v2"


@pytest.mark.asyncio
async def test_load_config_falls_back_to_legacy(monkeypatch):
    from mcp_service.cache import CacheManager

    async def _no_cache(_):
        return None

    monkeypatch.setattr(CacheManager, "get_config", _no_cache)
    monkeypatch.setattr(CacheManager, "set_config", lambda *args, **kwargs: None)

    legacy = type(
        "L",
        (),
        {
            "api_key": "k",
            "user_id": "u",
            "project_id": 1,
            "table_id": 1,
            "json_path": "",
            "status": 1,
            "register_tools": None,
            "preview_keys": None,
            "tools_definition": None,
        },
    )()
    rpc = _FakeRpc(v2=None, legacy=legacy)
    cfg = await load_mcp_config("k", rpc)  # type: ignore[arg-type]
    assert cfg is not None
    assert cfg["mode"] == "legacy"


