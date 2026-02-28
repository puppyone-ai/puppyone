"""
Mut Protocol — 依赖注入

提供 FastAPI Depends 工厂函数：
- get_collaboration_service() → CollaborationService（唯一写入入口）
- get_version_service()       → VersionService
"""

from fastapi import Depends
from src.supabase.client import SupabaseClient
from src.s3.service import S3Service
from src.s3.dependencies import get_s3_service
from src.content_node.repository import ContentNodeRepository
from src.content_node.service import ContentNodeService
from src.content_node.dependencies import (
    get_content_node_repository,
    get_content_node_service,
)

from src.collaboration.version_repository import FileVersionRepository, FolderSnapshotRepository
from src.collaboration.audit_repository import AuditRepository
from src.collaboration.version_service import VersionService
from src.collaboration.conflict_service import ConflictService
from src.collaboration.lock_service import LockService
from src.collaboration.audit_service import AuditService
from src.collaboration.service import CollaborationService
from src.sync.changelog import SyncChangelogRepository


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


def _get_file_version_repository(
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> FileVersionRepository:
    return FileVersionRepository(supabase)


def _get_folder_snapshot_repository(
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> FolderSnapshotRepository:
    return FolderSnapshotRepository(supabase)


def _get_changelog_repository(
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> SyncChangelogRepository:
    return SyncChangelogRepository(supabase)


def get_version_service(
    node_repo: ContentNodeRepository = Depends(get_content_node_repository),
    version_repo: FileVersionRepository = Depends(_get_file_version_repository),
    snapshot_repo: FolderSnapshotRepository = Depends(_get_folder_snapshot_repository),
    s3_service: S3Service = Depends(get_s3_service),
    changelog_repo: SyncChangelogRepository = Depends(_get_changelog_repository),
) -> VersionService:
    return VersionService(node_repo, version_repo, snapshot_repo, s3_service, changelog_repo)


def get_conflict_service() -> ConflictService:
    return ConflictService()


def get_lock_service(
    node_repo: ContentNodeRepository = Depends(get_content_node_repository),
) -> LockService:
    return LockService(node_repo)


def _get_audit_repository(
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> AuditRepository:
    return AuditRepository(supabase)


def get_audit_service(
    audit_repo: AuditRepository = Depends(_get_audit_repository),
) -> AuditService:
    return AuditService(audit_repo=audit_repo)


def get_collaboration_service(
    node_repo: ContentNodeRepository = Depends(get_content_node_repository),
    node_service: ContentNodeService = Depends(get_content_node_service),
    lock_service: LockService = Depends(get_lock_service),
    conflict_service: ConflictService = Depends(get_conflict_service),
    version_service: VersionService = Depends(get_version_service),
    audit_service: AuditService = Depends(get_audit_service),
) -> CollaborationService:
    """获取 CollaborationService（Mut Protocol 统一入口）"""
    return CollaborationService(
        node_repo=node_repo,
        node_service=node_service,
        lock_service=lock_service,
        conflict_service=conflict_service,
        version_service=version_service,
        audit_service=audit_service,
    )
