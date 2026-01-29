"""
Sync Task Dependencies

FastAPI dependency injection for sync task services.
"""

from fastapi import Depends
from supabase import Client

from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService
from src.oauth.github_service import GithubOAuthService
from src.s3.dependencies import get_s3_service
from src.s3.service import S3Service
from src.supabase.dependencies import get_supabase_client

from .repository import SyncTaskRepository
from .service import SyncTaskService


def get_sync_task_repository(
    supabase: Client = Depends(get_supabase_client),
) -> SyncTaskRepository:
    """Get sync task repository."""
    return SyncTaskRepository(supabase)


def get_sync_task_service(
    repository: SyncTaskRepository = Depends(get_sync_task_repository),
    node_service: ContentNodeService = Depends(get_content_node_service),
    s3_service: S3Service = Depends(get_s3_service),
) -> SyncTaskService:
    """Get sync task service."""
    return SyncTaskService(
        repository=repository,
        node_service=node_service,
        s3_service=s3_service,
        github_service=GithubOAuthService(),
    )

