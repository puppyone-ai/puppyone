from fastapi import Depends, HTTPException

from src.connectors.mcp.repository import McpEndpointRepository
from src.connectors.mcp.service import McpEndpointService
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser


def get_mcp_endpoint_repository() -> McpEndpointRepository:
    return McpEndpointRepository()


def get_mcp_endpoint_service(
    repo: McpEndpointRepository = Depends(get_mcp_endpoint_repository),
) -> McpEndpointService:
    return McpEndpointService(repository=repo)


def get_verified_mcp_endpoint(
    endpoint_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: McpEndpointService = Depends(get_mcp_endpoint_service),
) -> dict:
    endpoint = service.get_endpoint(endpoint_id)
    if not endpoint:
        raise HTTPException(status_code=404, detail="MCP endpoint not found")
    if not service.verify_access(endpoint_id, current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return endpoint
