"""
Mut Core — FastAPI 依赖注入

提供 MutWriteService 的 DI 工厂函数，替代 collaboration/dependencies.py 中的
6 个子服务注入。
"""

from __future__ import annotations

from fastapi import Depends

from src.s3.service import S3Service
from src.s3.dependencies import get_s3_service
from src.supabase.client import SupabaseClient
from src.content_node.repository import ContentNodeRepository
from src.content_node.dependencies import get_content_node_repository

from src.mut_core.repo_manager import MutRepoManager
from src.mut_core.index_sync import IndexSync
from src.mut_core.write_service import MutWriteService


_repo_manager: MutRepoManager | None = None


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


def get_repo_manager(
    s3: S3Service = Depends(get_s3_service),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> MutRepoManager:
    global _repo_manager
    if _repo_manager is None:
        _repo_manager = MutRepoManager(s3, supabase)
    return _repo_manager


def get_index_sync(
    node_repo: ContentNodeRepository = Depends(get_content_node_repository),
) -> IndexSync:
    return IndexSync(node_repo)


def get_mut_write_service(
    repo_manager: MutRepoManager = Depends(get_repo_manager),
    node_repo: ContentNodeRepository = Depends(get_content_node_repository),
    index_sync: IndexSync = Depends(get_index_sync),
) -> MutWriteService:
    return MutWriteService(repo_manager, node_repo, index_sync)


def get_repo_manager_standalone() -> MutRepoManager:
    """Get a cached MutRepoManager outside of FastAPI DI context."""
    global _repo_manager
    if _repo_manager is None:
        _repo_manager = MutRepoManager(S3Service(), SupabaseClient())
    return _repo_manager


def read_blob_content(project_id: str, content_hash: str | None, node_type: str = "json"):
    """Read content from MUT ObjectStore via content_hash.

    Returns (json_content, text_content). One of them will be None.
    Gracefully returns (None, None) on any failure.
    """
    if not content_hash:
        return None, None
    try:
        import json as _json
        repo = get_repo_manager_standalone().get_repo(project_id)
        blob = repo.store.get(content_hash)
        if node_type == "json":
            return _json.loads(blob.decode("utf-8")), None
        return None, blob.decode("utf-8", errors="replace")
    except Exception:
        return None, None


def create_mut_write_service() -> MutWriteService:
    """在非请求上下文中构造 MutWriteService。

    用于 Scheduler job、ARQ worker、测试等无法使用 FastAPI Depends 的场景。
    替代旧的 create_collaboration_service()。
    """
    supabase = SupabaseClient()
    s3 = S3Service()
    node_repo = ContentNodeRepository(supabase)

    repo_manager = MutRepoManager(s3, supabase)
    index_sync = IndexSync(node_repo)

    return MutWriteService(repo_manager, node_repo, index_sync)
