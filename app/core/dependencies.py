from app.core.config import settings
from app.repositories.user_repo import UserRepositoryJSON
from app.repositories.mcp_repo import McpInstanceRepositoryJSON
from app.repositories.user_context_repo import UserContextRepositoryJSON
from app.service.user_service import UserService
from app.service.mcp_service import McpService
from app.service.user_context_service import UserContextService

def get_user_service() -> UserService:
    """
    user_service的依赖注入工厂。支持通过配置项来决定存储策略
    """
    if settings.STORAGE_TYPE == "json":
        return UserService(UserRepositoryJSON())
    else:
        raise ValueError(f"Unsupported storage type: {settings.STORAGE_TYPE}")

def get_mcp_instance_service() -> McpService:
    """
    mcp_instance_service的依赖注入工厂。支持通过配置项来决定存储策略
    """
    if settings.STORAGE_TYPE == "json":
        return McpService(McpInstanceRepositoryJSON())
    else:
        raise ValueError(f"Unsupported storage type: {settings.STORAGE_TYPE}")
    
def get_user_context_service() -> UserContextService:
    """
    user_context_service的依赖注入工厂。支持通过配置项来决定存储策略
    """
    if settings.STORAGE_TYPE == "json":
        return UserContextService(UserContextRepositoryJSON())
    else:
        raise ValueError(f"Unsupported storage type: {settings.STORAGE_TYPE}")