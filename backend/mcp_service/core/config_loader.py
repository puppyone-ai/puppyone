"""
配置加载：从 api_key / internal API 拉取 MCP 配置，并写入缓存

整合后的架构：只支持 Agent 模式（通过 Agent 的 mcp_api_key 访问）
- V2 模式已移除（mcp_v2 + mcp_binding 表已删除）
- Legacy 模式已移除（旧的 mcp_instance 表已废弃）

Agent 配置包括：
- agent_bash: 数据访问权限（CRUD 操作）
- agent_tool: 关联的自定义工具（如 search, custom_script 等）
"""

from __future__ import annotations

from typing import Any, Dict, Optional
import logging

from ..cache import CacheManager
from ..rpc.client import InternalApiClient

logger = logging.getLogger(__name__)


def _is_agent_mcp_key(api_key: str) -> bool:
    """判断是否是 Agent 的 MCP API key"""
    return api_key.startswith("mcp_")


async def load_mcp_config(api_key: str, rpc_client: InternalApiClient) -> Optional[Dict[str, Any]]:
    """
    加载 MCP 配置（带缓存）
    
    整合后只支持 Agent 模式：
    - api_key 必须是 Agent 的 mcp_api_key（以 "mcp_" 开头）
    - 配置从 agent + agent_bash + agent_tool 表读取
    """
    # 检查缓存
    cached = await CacheManager.get_config(api_key)
    if cached:
        return cached

    # 只支持 Agent 模式
    if not _is_agent_mcp_key(api_key):
        logger.warning(f"Invalid MCP API key format: {api_key[:20]}... (must start with 'mcp_')")
        return None

    # 从 Internal API 获取 Agent 配置
    agent_data = await rpc_client.get_agent_by_mcp_key(api_key)
    if not agent_data:
        logger.warning(f"Agent not found for MCP API key: {api_key[:20]}...")
        return None

    # 构建配置
    agent_info = agent_data.get("agent", {})
    accesses = agent_data.get("accesses", [])
    tools = agent_data.get("tools", [])  # 新增：关联的 tools
    
    config: Dict[str, Any] = {
        "mode": "agent",
        "agent": {
            "id": agent_info.get("id"),
            "name": agent_info.get("name"),
            "user_id": agent_info.get("user_id"),
            "type": agent_info.get("type"),
        },
        # Bash 访问权限（用于内置数据 CRUD 工具）
        "accesses": [
            {
                "node_id": a.get("node_id"),
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
        # 关联的自定义 Tools（mcp_exposed=True 的）
        "tools": [
            {
                "id": t.get("id"),  # agent_tool 关联 ID
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
            if t.get("enabled") and t.get("mcp_exposed")  # 只包含启用且暴露的
        ],
    }
    
    await CacheManager.set_config(api_key, config)
    logger.info(f"Loaded Agent MCP config: agent_id={agent_info.get('id')}, accesses={len(accesses)}, tools={len(config['tools'])}")
    return config
