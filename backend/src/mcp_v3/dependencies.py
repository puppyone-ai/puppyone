"""
MCP V3 依赖注入
"""

from __future__ import annotations

from fastapi import Depends, Path

from src.agent.config.models import Agent
from src.agent.config.repository import AgentRepository
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
    api_key: str = Path(..., description="MCP API Key"),
) -> Agent:
    """
    通过 MCP API Key 获取 Agent（用于代理路由）
    
    不需要用户登录，只需提供有效的 api_key
    """
    repo = AgentRepository()
    agent = repo.get_by_mcp_api_key_with_accesses(api_key)
    if not agent:
        raise NotFoundException(
            f"Agent not found for MCP API key",
            code=ErrorCode.NOT_FOUND,
        )
    return agent

