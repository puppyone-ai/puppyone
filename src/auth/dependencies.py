from src.auth.repository import UserRepositorySupabase
from src.auth.service import UserService


def get_user_service() -> UserService:
    """
    user_service的依赖注入工厂。使用Supabase作为存储后端
    """
    return UserService(UserRepositorySupabase())
