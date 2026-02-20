"""
MCP V3 依赖注入
"""

from __future__ import annotations

from fastapi import Header, HTTPException, Request

from src.access.config.models import Agent
from src.access.config.repository import AgentRepository
from src.exceptions import NotFoundException, ErrorCode

from .service import McpV3Service


# 单例服务实例
_mcp_v3_service: McpV3Service | None = None


def get_mcp_v3_service() -> McpV3Service:
    """获取 MCP V3 服务单例"""
    global _mcp_v3_service
    if _mcp_v3_service is None:
        _mcp_v3_service = McpV3Service()
    return _mcp_v3_service


def get_agent_by_mcp_api_key(
    request: Request,
    x_mcp_api_key: str | None = Header(
        default=None,
        alias="X-MCP-API-Key",
        description="MCP API Key（推荐：通过 Header 传递）",
    ),
) -> Agent:
    """
    通过 MCP API Key 获取 Agent（用于代理路由）。

    支持两种来源：
    1) Header: `X-MCP-API-Key`（推荐）
    2) Legacy path: `/mcp/proxy/{api_key}`（兼容迁移）
    """
    legacy_api_key = request.path_params.get("api_key")
    api_key = (x_mcp_api_key or legacy_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing X-MCP-API-Key")

    repo = AgentRepository()
    agent = repo.get_by_mcp_api_key_with_accesses(api_key)
    if not agent:
        raise NotFoundException(
            "Agent not found for MCP API key",
            code=ErrorCode.NOT_FOUND,
        )
    return agent
