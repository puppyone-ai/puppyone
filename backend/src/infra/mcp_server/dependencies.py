from fastapi import Depends, Path
from src.config import settings
from src.infra.mcp_server.repository import McpInstanceRepositoryJSON, McpInstanceRepositorySupabase
from src.infra.mcp_server.service import McpService
from src.infra.mcp_server.models import McpInstance
from src.platform.auth.models import CurrentUser
from src.platform.auth.dependencies import get_current_user
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService


# Use a global variable to store the singleton instead of lru_cache
# This avoids caching issues during reload
_mcp_service = None


def get_mcp_instance_service() -> McpService:
    """
    Dependency injection factory for mcp_instance_service. Supports choosing storage strategy via configuration.
    """
    global _mcp_service
    if _mcp_service is None:
        if settings.STORAGE_TYPE == "json":
            _mcp_service = McpService(McpInstanceRepositoryJSON())
        elif settings.STORAGE_TYPE == "supabase":
            _mcp_service = McpService(McpInstanceRepositorySupabase())
        else:
            raise ValueError(f"Unsupported storage type: {settings.STORAGE_TYPE}")
    return _mcp_service


async def get_verified_mcp_instance(
    api_key: str = Path(..., description="API Key of the MCP instance"),
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
    current_user: CurrentUser = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> McpInstance:
    """
    Dependency injection function: Get and verify user's access to an MCP instance (project_id-based access)

    This dependency automatically verifies:
    1. Whether the MCP instance exists
    2. Whether the user has access to the project the MCP instance belongs to

    Raises NotFoundException if verification fails

    Args:
        api_key: API Key of the MCP instance (from path parameter)
        mcp_instance_service: McpService instance (via dependency injection)
        current_user: Current user (via dependency injection)
        project_service: ProjectService instance (for verifying project access)

    Returns:
        Verified McpInstance object

    Raises:
        NotFoundException: If instance does not exist or user lacks permission
    """
    def verify_access(pid, uid):
        return project_service.verify_project_access(pid, uid) is not None
    return await mcp_instance_service.get_mcp_instance_by_api_key_with_access_check(
        api_key, current_user.user_id, verify_access
    )


async def get_mcp_instance_by_api_key(
    api_key: str = Path(..., description="API Key of the MCP instance"),
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
) -> McpInstance:
    """
    Dependency injection function: Only validates whether the API Key is valid, does not check user permissions

    Used for proxy routes and other scenarios that don't require user login

    This dependency only verifies:
    1. Whether the MCP instance exists

    Does not verify:
    - User login status
    - User ownership of the instance

    Args:
        api_key: API Key of the MCP instance (from path parameter)
        mcp_instance_service: McpService instance (via dependency injection)

    Returns:
        McpInstance object

    Raises:
        NotFoundException: If instance does not exist
    """
    from src.exceptions import NotFoundException, ErrorCode

    instance = await mcp_instance_service.get_mcp_instance_by_api_key(api_key)
    if not instance:
        raise NotFoundException(
            f"MCP instance not found: api_key={api_key[:20]}...",
            code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
        )

    return instance
