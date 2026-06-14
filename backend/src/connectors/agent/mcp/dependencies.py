"""
MCP V3 Dependency Injection
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import Header, HTTPException, Request

from src.connectors.agent.config.repository import AgentRepository
from src.connectors.mcp_endpoint.repository import McpEndpointRepository
from src.exceptions import NotFoundException, ErrorCode

from .service import McpV3Service


@dataclass(frozen=True)
class McpRuntimePrincipal:
    api_key: str
    kind: Literal["agent", "mcp_endpoint"]


# Singleton service instance
_mcp_v3_service: McpV3Service | None = None


def get_mcp_v3_service() -> McpV3Service:
    """Get MCP V3 service singleton."""
    global _mcp_v3_service
    if _mcp_v3_service is None:
        _mcp_v3_service = McpV3Service()
    return _mcp_v3_service


def get_mcp_runtime_principal(
    request: Request,
    x_mcp_api_key: str | None = Header(
        default=None,
        alias="X-MCP-API-Key",
        description="MCP API Key (recommended: pass via Header)",
    ),
) -> McpRuntimePrincipal:
    """
    Resolve an MCP runtime key for proxy routing.

    Supports two sources:
    1) Header: `X-MCP-API-Key` (recommended)
    2) Legacy path: `/mcp/proxy/{api_key}` (migration compatibility)
    """
    legacy_api_key = request.path_params.get("api_key")
    api_key = (x_mcp_api_key or legacy_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing X-MCP-API-Key")

    repo = AgentRepository()
    agent = repo.get_by_mcp_api_key_with_accesses(api_key)
    if agent:
        return McpRuntimePrincipal(api_key=agent.mcp_api_key, kind="agent")

    endpoint = McpEndpointRepository().get_by_api_key(api_key)
    if endpoint and endpoint.get("status") == "active":
        return McpRuntimePrincipal(api_key=api_key, kind="mcp_endpoint")

    raise NotFoundException(
        "MCP runtime not found for API key",
        code=ErrorCode.NOT_FOUND,
    )
