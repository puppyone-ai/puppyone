"""
配置加载：从 api_key / internal API 拉取 MCP 配置，并写入缓存

支持双源认证：
1. 独立 MCP 端点 (connections 表, provider='mcp') — 优先
2. Agent 模式 (connections 表, provider='agent') — 回退

所有 MCP API key 均以 "mcp_" 开头。
"""

from __future__ import annotations

from typing import Any, Dict, Optional
import logging

from ..cache import CacheManager
from ..rpc.client import InternalApiClient

logger = logging.getLogger(__name__)


def _is_valid_mcp_key(api_key: str) -> bool:
    return api_key.startswith("mcp_")


async def load_mcp_config(api_key: str, rpc_client: InternalApiClient) -> Optional[Dict[str, Any]]:
    """
    Load MCP config with dual-source resolution.

    1. Check cache
    2. Try independent mcp_endpoints table
    3. Fall back to agent-based MCP config
    """
    cached = await CacheManager.get_config(api_key)
    if cached:
        return cached

    if not _is_valid_mcp_key(api_key):
        logger.warning(f"Invalid MCP API key format: {api_key[:20]}... (must start with 'mcp_')")
        return None

    data = await rpc_client.resolve_mcp_config(api_key)
    if not data:
        logger.warning(f"No config found for MCP API key: {api_key[:20]}...")
        return None

    agent_info = data.get("agent", {})
    accesses = data.get("accesses", [])
    tools = data.get("tools", [])

    config: Dict[str, Any] = {
        "mode": "agent" if agent_info.get("type") != "mcp_endpoint" else "mcp_endpoint",
        "agent": {
            "id": agent_info.get("id"),
            "name": agent_info.get("name"),
            "project_id": agent_info.get("project_id"),
            "type": agent_info.get("type"),
        },
        "accesses": [
            {
                "node_id": a.get("node_id"),
                "node_name": a.get("node_name", ""),
                "node_type": a.get("node_type", ""),
                "bash_enabled": a.get("bash_enabled", True),
                "bash_readonly": a.get("bash_readonly", True),
                "tool_query": a.get("tool_query", True),
                "tool_create": a.get("tool_create", False),
                "tool_update": a.get("tool_update", False),
                "tool_delete": a.get("tool_delete", False),
                "json_path": a.get("json_path", ""),
            }
            for a in accesses
        ],
        "tools": [
            {
                "id": t.get("id"),
                "tool_id": t.get("tool_id"),
                "name": t.get("name"),
                "type": t.get("type"),
                "description": t.get("description"),
                "node_id": t.get("node_id"),
                "json_path": t.get("json_path", ""),
                "input_schema": t.get("input_schema"),
                "category": t.get("category", "builtin"),
                "enabled": t.get("enabled", True),
                "mcp_exposed": t.get("mcp_exposed", True),
            }
            for t in tools
            if t.get("enabled")
        ],
    }

    await CacheManager.set_config(api_key, config)
    source = config["mode"]
    logger.info(f"Loaded MCP config ({source}): id={agent_info.get('id')}, accesses={len(accesses)}, tools={len(config['tools'])}")
    return config
