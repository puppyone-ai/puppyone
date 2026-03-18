"""Content Node 依赖注入"""

from fastapi import Depends
from src.infra.supabase.client import SupabaseClient
from src.infra.s3.service import S3Service
from src.infra.s3.dependencies import get_s3_service
from src.content.repository import ContentNodeRepository
from src.content.service import ContentNodeService


def get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


def get_content_node_repository(
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> ContentNodeRepository:
    return ContentNodeRepository(supabase)


def get_content_node_service(
    repo: ContentNodeRepository = Depends(get_content_node_repository),
    s3_service: S3Service = Depends(get_s3_service),
) -> ContentNodeService:
    return ContentNodeService(repo, s3_service)
