"""
Mut Protocol — 依赖注入

MutCompatService（Mut 内核 + 旧接口兼容层）是唯一的写入服务。
所有调用方通过 get_collaboration_service() 获取实例。

内部架构:
  get_collaboration_service() → MutCompatService
    └── MutWriteService（Mut 内核）
        ├── MutRepoManager（per-project repo）
        │   ├── ObjectStore (S3StorageBackend)
        │   ├── HistoryManager (SupabaseHistoryManager → mut_commits 表)
        │   └── AuditLog (SupabaseAuditManager → audit_logs 表)
        └── IndexSync（Mut tree → content_nodes 同步）
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

from src.mut_core.repo_manager import MutRepoManager
from src.mut_core.index_sync import IndexSync
from src.mut_core.write_service import MutWriteService
from src.mut_core.compat_service import MutCompatService


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


# ── Mut-native DI ──

def _get_repo_manager(
    s3: S3Service = Depends(get_s3_service),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> MutRepoManager:
    return MutRepoManager(s3, supabase)


def _get_mut_write_service(
    repo_manager: MutRepoManager = Depends(_get_repo_manager),
    node_repo: ContentNodeRepository = Depends(get_content_node_repository),
) -> MutWriteService:
    index_sync = IndexSync(node_repo)
    return MutWriteService(repo_manager, node_repo, index_sync)


def get_collaboration_service(
    node_repo: ContentNodeRepository = Depends(get_content_node_repository),
    node_service: ContentNodeService = Depends(get_content_node_service),
    mut_write: MutWriteService = Depends(_get_mut_write_service),
    repo_manager: MutRepoManager = Depends(_get_repo_manager),
) -> MutCompatService:
    """获取 MutCompatService（Mut 内核 + 旧接口兼容）— FastAPI DI 版"""
    return MutCompatService(
        node_repo=node_repo,
        node_service=node_service,
        mut_write=mut_write,
        repo_manager=repo_manager,
    )


def create_collaboration_service() -> MutCompatService:
    """在非请求上下文中构造 MutCompatService。

    用于 Scheduler job、ARQ worker、测试等无法使用 FastAPI Depends 的场景。
    """
    supabase = SupabaseClient()
    s3 = S3Service()
    node_repo = ContentNodeRepository(supabase)
    node_service = ContentNodeService(node_repo, s3)

    repo_manager = MutRepoManager(s3, supabase)
    index_sync = IndexSync(node_repo)
    mut_write = MutWriteService(repo_manager, node_repo, index_sync)

    return MutCompatService(
        node_repo=node_repo,
        node_service=node_service,
        mut_write=mut_write,
        repo_manager=repo_manager,
    )
