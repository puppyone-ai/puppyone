"""
配置加载：从 api_key / internal API 拉取 MCP 配置，并写入缓存
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ..cache import CacheManager
from ..rpc.client import InternalApiClient
from .tools_definition import ALL_TOOLS_LIST
from .auth import parse_table_scope_from_api_key


async def load_mcp_config(api_key: str, rpc_client: InternalApiClient) -> Optional[Dict[str, Any]]:
    """加载 MCP 实例配置（带缓存）"""
    cached = await CacheManager.get_config(api_key)
    if cached:
        return cached

    # 0) 优先尝试新契约：MCP v2 + bound tools
    try:
        mcp_v2_payload = await rpc_client.get_mcp_v2_instance_and_tools(api_key)
    except Exception:
        mcp_v2_payload = None

    if mcp_v2_payload and mcp_v2_payload.get("mcp_v2"):
        mcp_v2 = mcp_v2_payload["mcp_v2"]
        config: Dict[str, Any] = {
            "mode": "v2",
            "mcp_v2": mcp_v2,
            "bound_tools": mcp_v2_payload.get("bound_tools") or [],
        }
        await CacheManager.set_config(api_key, config)
        return config

    # 从 API_KEY 解析 table_id/json_path（仅用于兜底与快速失败）
    # 注意：MCP 实例的“真实配置”以主服务 internal/mcp-instance 返回为准，
    # 否则当用户在数据库/主服务更新 json_path 后，旧 token payload 会导致一直走旧路径。
    try:
        parsed_table_id, parsed_json_path = parse_table_scope_from_api_key(api_key)
    except Exception:
        parsed_table_id, parsed_json_path = 0, ""

    # 从 internal API 获取 mcp_instance（用于有效性校验、工具配置）
    mcp_instance = await rpc_client.get_mcp_instance(api_key)

    if not mcp_instance:
        return None


    # 以主服务返回为准（若缺失则回退到 token 解析结果）
    effective_table_id = int(mcp_instance.table_id or parsed_table_id)
    effective_json_path = (mcp_instance.json_path or "").strip()
    if effective_json_path == "" and parsed_json_path is not None:
        effective_json_path = str(parsed_json_path)

    # 表格元数据也使用最终 table_id
    table_metadata = await rpc_client.get_table_metadata(effective_table_id)
    if not table_metadata:
        return None

    config: Dict[str, Any] = {
        "mode": "legacy",
        "mcp_instance": {
            "api_key": mcp_instance.api_key,
            "user_id": mcp_instance.user_id,
            "project_id": mcp_instance.project_id,
            "table_id": effective_table_id,
            "json_path": effective_json_path,
            "status": mcp_instance.status,
            "register_tools": mcp_instance.register_tools
            or ALL_TOOLS_LIST,
            "preview_keys": mcp_instance.preview_keys,
        },
        "table_metadata": {
            "table_id": table_metadata.table_id,
            "name": table_metadata.name,
            "description": table_metadata.description,
            "project_id": table_metadata.project_id,
        },
        "tools_definition": mcp_instance.tools_definition,
    }

    await CacheManager.set_config(api_key, config)
    return config
