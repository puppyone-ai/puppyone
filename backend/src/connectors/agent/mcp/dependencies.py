"""
MCP V3 Dependency Injection
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import Header, HTTPException

from src.connectors.agent.config.repository import AgentRepository
from src.connectors.mcp_endpoint.repository import McpEndpointRepository

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
    authorization: str | None = Header(
        default=None,
        alias="Authorization",
        description="Bearer token for an MCP access point",
    ),
) -> McpRuntimePrincipal:
    """
    Resolve an MCP runtime key for proxy routing.

    Public MCP clients authenticate with the standard HTTP Authorization
    header: `Authorization: Bearer mcp_...`.
    """
    scheme, _, token = (authorization or "").strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    api_key = token.strip()

    repo = AgentRepository()
    agent = repo.get_by_mcp_api_key_with_accesses(api_key)
    if agent:
        return McpRuntimePrincipal(api_key=agent.mcp_api_key, kind="agent")

    endpoint = McpEndpointRepository().get_by_api_key(api_key)
    if endpoint:
        if endpoint.get("status") == "active":
            return McpRuntimePrincipal(api_key=api_key, kind="mcp_endpoint")
        raise HTTPException(status_code=403, detail="MCP endpoint is not active")

    raise HTTPException(
        status_code=401,
        detail="Invalid MCP bearer token",
        headers={"WWW-Authenticate": "Bearer"},
    )
