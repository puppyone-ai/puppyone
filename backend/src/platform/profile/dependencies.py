"""
Profile 依赖注入

提供 FastAPI 的依赖注入函数
"""

from functools import lru_cache

from src.platform.profile.repository import ProfileRepositorySupabase
from src.platform.profile.service import ProfileService
from src.platform.auth.dependencies import get_initialization_service
from src.platform.project.dependencies import get_project_service


@lru_cache()
def get_profile_repository() -> ProfileRepositorySupabase:
    return ProfileRepositorySupabase()


def get_profile_service() -> ProfileService:
    return ProfileService(
        profile_repository=get_profile_repository(),
        initialization_service=get_initialization_service(),
        project_service=get_project_service(),
    )
