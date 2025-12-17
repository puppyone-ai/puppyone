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

    # 从 API_KEY 解析 table_id 和 json_path（挂载点）
    try:
        parsed_table_id, parsed_json_path = parse_table_scope_from_api_key(api_key)
    except Exception:
        return None

    # 从 internal API 获取 mcp_instance（用于有效性校验、工具配置）
    mcp_instance = await rpc_client.get_mcp_instance(api_key)
    if not mcp_instance:
        return None

    # 表格元数据使用 token 里的 table_id（与“table_id 从 api_key 解析”要求一致）
    table_metadata = await rpc_client.get_table_metadata(parsed_table_id)
    if not table_metadata:
        return None

    config: Dict[str, Any] = {
        "mcp_instance": {
            "api_key": mcp_instance.api_key,
            "user_id": mcp_instance.user_id,
            "project_id": mcp_instance.project_id,
            "table_id": parsed_table_id,
            "json_path": parsed_json_path,
            "status": mcp_instance.status,
            "register_tools": mcp_instance.register_tools
            or ALL_TOOLS_LIST,
            "preview_keys": mcp_instance.preview_keys,
        },
        "table_metadata": {
            "table_id": table_metadata.table_id,
            "name": table_metadata.name,
            "description": table_metadata.description,
            "user_id": table_metadata.user_id,
            "project_id": table_metadata.project_id,
        },
        "tools_definition": mcp_instance.tools_definition,
    }

    await CacheManager.set_config(api_key, config)
    return config
