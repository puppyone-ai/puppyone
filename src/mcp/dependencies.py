from src.config import settings
from src.mcp.repository import McpInstanceRepositoryJSON, McpInstanceRepositorySupabase
from src.mcp.service import McpService


def get_mcp_instance_service() -> McpService:
    """
    mcp_instance_service的依赖注入工厂。支持通过配置项来决定存储策略
    """
    if settings.STORAGE_TYPE == "json":
        return McpService(McpInstanceRepositoryJSON())
    elif settings.STORAGE_TYPE == "supabase":
        return McpService(McpInstanceRepositorySupabase())
    else:
        raise ValueError(f"Unsupported storage type: {settings.STORAGE_TYPE}")
