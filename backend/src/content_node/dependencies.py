"""Content Node 依赖注入

注意：VersionService / FileVersionRepository / FolderSnapshotRepository
已迁移到 src.collaboration 模块。此处保留 re-export 以保持向后兼容。
"""

from fastapi import Depends
from src.supabase.client import SupabaseClient
from src.s3.service import S3Service
from src.s3.dependencies import get_s3_service
from src.content_node.repository import ContentNodeRepository
from src.content_node.service import ContentNodeService

# 向后兼容：从 collaboration 模块导入
from src.collaboration.version_repository import FileVersionRepository, FolderSnapshotRepository
from src.collaboration.version_service import VersionService


def get_supabase_client() -> SupabaseClient:
    """获取 Supabase 客户端"""
    return SupabaseClient()


def get_content_node_repository(
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> ContentNodeRepository:
    """获取 Content Node Repository"""
    return ContentNodeRepository(supabase)


def get_file_version_repository(
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> FileVersionRepository:
    """获取 FileVersion Repository（已迁移到 collaboration）"""
    return FileVersionRepository(supabase)


def get_folder_snapshot_repository(
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> FolderSnapshotRepository:
    """获取 FolderSnapshot Repository（已迁移到 collaboration）"""
    return FolderSnapshotRepository(supabase)


def get_version_service(
    node_repo: ContentNodeRepository = Depends(get_content_node_repository),
    version_repo: FileVersionRepository = Depends(get_file_version_repository),
    snapshot_repo: FolderSnapshotRepository = Depends(get_folder_snapshot_repository),
    s3_service: S3Service = Depends(get_s3_service),
) -> VersionService:
    """获取 Version Service（已迁移到 collaboration）"""
    return VersionService(node_repo, version_repo, snapshot_repo, s3_service)


def get_content_node_service(
    repo: ContentNodeRepository = Depends(get_content_node_repository),
    s3_service: S3Service = Depends(get_s3_service),
    version_service: VersionService = Depends(get_version_service),
) -> ContentNodeService:
    """获取 Content Node Service（已注入版本管理）"""
    return ContentNodeService(repo, s3_service, version_service)

