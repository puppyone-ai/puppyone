"""Content Node 依赖注入"""

from fastapi import Depends
from src.supabase.client import SupabaseClient
from src.s3.service import S3Service
from src.s3.dependencies import get_s3_service
from src.content_node.repository import ContentNodeRepository
from src.content_node.service import ContentNodeService


def get_supabase_client() -> SupabaseClient:
    """获取 Supabase 客户端"""
    return SupabaseClient()


def get_content_node_repository(
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> ContentNodeRepository:
    """获取 Content Node Repository"""
    return ContentNodeRepository(supabase)


def get_content_node_service(
    repo: ContentNodeRepository = Depends(get_content_node_repository),
    s3_service: S3Service = Depends(get_s3_service),
) -> ContentNodeService:
    """获取 Content Node Service"""
    return ContentNodeService(repo, s3_service)

