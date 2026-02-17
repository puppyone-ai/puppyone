"""
L2 Collaboration — 依赖注入

提供 FastAPI Depends 工厂函数：
- get_collaboration_service() → CollaborationService
- get_version_service()       → VersionService（向后兼容）

同时导出内部组件的工厂函数供其他模块使用。
"""

from fastapi import Depends
from src.supabase.client import SupabaseClient
from src.s3.service import S3Service
from src.s3.dependencies import get_s3_service
from src.content_node.repository import ContentNodeRepository

from src.collaboration.version_repository import FileVersionRepository, FolderSnapshotRepository
from src.collaboration.version_service import VersionService
from src.collaboration.conflict_service import ConflictService
from src.collaboration.lock_service import LockService
from src.collaboration.audit_service import AuditService
from src.collaboration.service import CollaborationService


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


def _get_content_node_repository(
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> ContentNodeRepository:
    return ContentNodeRepository(supabase)


def _get_file_version_repository(
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> FileVersionRepository:
    return FileVersionRepository(supabase)


def _get_folder_snapshot_repository(
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> FolderSnapshotRepository:
    return FolderSnapshotRepository(supabase)


def get_version_service(
    node_repo: ContentNodeRepository = Depends(_get_content_node_repository),
    version_repo: FileVersionRepository = Depends(_get_file_version_repository),
    snapshot_repo: FolderSnapshotRepository = Depends(_get_folder_snapshot_repository),
    s3_service: S3Service = Depends(get_s3_service),
) -> VersionService:
    """获取 VersionService（向后兼容 + 内部使用）"""
    return VersionService(node_repo, version_repo, snapshot_repo, s3_service)


def get_conflict_service() -> ConflictService:
    """获取 ConflictService"""
    return ConflictService()


def get_lock_service(
    node_repo: ContentNodeRepository = Depends(_get_content_node_repository),
) -> LockService:
    """获取 LockService"""
    return LockService(node_repo)


def get_audit_service() -> AuditService:
    """获取 AuditService"""
    return AuditService()


def get_collaboration_service(
    node_repo: ContentNodeRepository = Depends(_get_content_node_repository),
    lock_service: LockService = Depends(get_lock_service),
    conflict_service: ConflictService = Depends(get_conflict_service),
    version_service: VersionService = Depends(get_version_service),
    audit_service: AuditService = Depends(get_audit_service),
) -> CollaborationService:
    """获取 CollaborationService（L2 统一入口）"""
    return CollaborationService(
        node_repo=node_repo,
        lock_service=lock_service,
        conflict_service=conflict_service,
        version_service=version_service,
        audit_service=audit_service,
    )
