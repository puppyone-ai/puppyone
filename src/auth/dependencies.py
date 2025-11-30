from src.config import settings
from src.auth.repository import UserRepositoryJSON
from src.auth.service import UserService


def get_user_service() -> UserService:
    """
    user_service的依赖注入工厂。支持通过配置项来决定存储策略
    """
    if settings.STORAGE_TYPE == "json":
        return UserService(UserRepositoryJSON())
    else:
        raise ValueError(f"Unsupported storage type: {settings.STORAGE_TYPE}")
