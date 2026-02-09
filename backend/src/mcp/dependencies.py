from fastapi import Depends, Path
from src.config import settings
from src.mcp.repository import McpInstanceRepositoryJSON, McpInstanceRepositorySupabase
from src.mcp.service import McpService
from src.mcp.models import McpInstance
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user


# 使用全局变量存储单例，而不是 lru_cache
# 这样可以避免 reload 时的缓存问题
_mcp_service = None


def get_mcp_instance_service() -> McpService:
    """
    mcp_instance_service的依赖注入工厂。支持通过配置项来决定存储策略
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
    api_key: str = Path(..., description="MCP实例的API Key"),
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> McpInstance:
    """
    依赖注入函数：获取并验证用户对 MCP 实例的访问权限

    这个依赖会自动验证：
    1. MCP 实例是否存在
    2. MCP 实例是否属于当前用户

    如果验证失败，会抛出 NotFoundException

    Args:
        api_key: MCP 实例的 API Key（从路径参数获取）
        mcp_instance_service: McpService 实例（通过依赖注入）
        current_user: 当前用户（通过依赖注入）

    Returns:
        已验证的 McpInstance 对象

    Raises:
        NotFoundException: 如果实例不存在或用户无权限
    """
    return await mcp_instance_service.get_mcp_instance_by_api_key_with_access_check(
        api_key, current_user.user_id
    )


async def get_mcp_instance_by_api_key(
    api_key: str = Path(..., description="MCP实例的API Key"),
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
) -> McpInstance:
    """
    依赖注入函数：仅验证 API Key 是否有效，不检查用户权限

    用于代理路由等不需要用户登录的场景

    这个依赖只验证：
    1. MCP 实例是否存在

    不验证：
    - 用户登录状态
    - 用户对实例的所有权

    Args:
        api_key: MCP 实例的 API Key（从路径参数获取）
        mcp_instance_service: McpService 实例（通过依赖注入）

    Returns:
        McpInstance 对象

    Raises:
        NotFoundException: 如果实例不存在
    """
    from src.exceptions import NotFoundException, ErrorCode

    instance = await mcp_instance_service.get_mcp_instance_by_api_key(api_key)
    if not instance:
        raise NotFoundException(
            f"MCP instance not found: api_key={api_key[:20]}...",
            code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
        )

    return instance
