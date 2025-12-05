from src.config import settings
from src.user_context.repository import UserContextRepositoryJSON
from src.user_context.service import UserContextService


def get_user_context_service() -> UserContextService:
    """
    user_context_service的依赖注入工厂。支持通过配置项来决定存储策略
    """
    if settings.STORAGE_TYPE == "json":
        return UserContextService(UserContextRepositoryJSON())
    else:
        raise ValueError(f"Unsupported storage type: {settings.STORAGE_TYPE}")
