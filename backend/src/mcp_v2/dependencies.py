from __future__ import annotations

from fastapi import Depends, Path

from src.exceptions import ErrorCode, NotFoundException
from src.mcp_v2.models import McpV2Instance
from src.mcp_v2.service import McpV2Service


_mcp_v2_service: McpV2Service | None = None


def get_mcp_v2_service() -> McpV2Service:
    global _mcp_v2_service
    if _mcp_v2_service is None:
        _mcp_v2_service = McpV2Service()
    return _mcp_v2_service


async def get_mcp_v2_instance_by_api_key(
    api_key: str = Path(..., description="MCP v2 实例的 API Key"),
    svc: McpV2Service = Depends(get_mcp_v2_service),
) -> McpV2Instance:
    """
    仅验证 MCP v2 api_key 是否存在（不校验用户登录/所有权）。

    用于 mcp_v2 代理路由等仅凭 api_key 访问的场景。
    """
    inst = svc.get_by_api_key(api_key)
    if not inst:
        raise NotFoundException(
            f"MCP v2 instance not found: api_key={api_key[:20]}...",
            code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
        )
    return inst
