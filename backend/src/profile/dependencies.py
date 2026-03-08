"""
Profile 依赖注入

提供 FastAPI 的依赖注入函数
"""

from functools import lru_cache
from typing import Optional

from src.profile.repository import ProfileRepositorySupabase
from src.profile.service import ProfileService
from src.auth.dependencies import get_initialization_service
from src.project.dependencies import get_project_service
from src.supabase.client import SupabaseClient
from src.s3.service import S3Service
from src.content_node.repository import ContentNodeRepository
from src.content_node.service import ContentNodeService


@lru_cache()
def get_profile_repository() -> ProfileRepositorySupabase:
    """获取 Profile Repository 单例"""
    return ProfileRepositorySupabase()


def _create_content_node_service() -> ContentNodeService:
    supabase = SupabaseClient()
    repo = ContentNodeRepository(supabase)
    s3_service = S3Service()
    return ContentNodeService(repo, s3_service)


def get_profile_service() -> ProfileService:
    """获取 Profile Service"""
    return ProfileService(
        profile_repository=get_profile_repository(),
        initialization_service=get_initialization_service(),
        project_service=get_project_service(),
        content_node_service=_create_content_node_service(),
    )

