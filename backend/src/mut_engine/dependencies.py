"""
Mut Engine — FastAPI 依赖注入

提供 MutWriteService、MutTreeReader、MutEphemeralClient 的 DI 工厂函数。
"""

from __future__ import annotations

from fastapi import Depends

from src.infra.s3.service import S3Service
from src.infra.s3.dependencies import get_s3_service
from src.infra.supabase.client import SupabaseClient

from src.mut_engine.repo_manager import MutRepoManager
from src.mut_engine.write_service import MutWriteService
from src.mut_engine.tree_reader import MutTreeReader
from src.mut_engine.ephemeral_client import MutEphemeralClient


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


def get_mut_write_service(
    repo_manager: MutRepoManager = Depends(get_repo_manager),
) -> MutWriteService:
    return MutWriteService(repo_manager)


def get_tree_reader(
    repo_manager: MutRepoManager = Depends(get_repo_manager),
) -> MutTreeReader:
    return MutTreeReader(repo_manager)


def get_repo_manager_standalone() -> MutRepoManager:
    """Get a cached MutRepoManager outside of FastAPI DI context."""
    global _repo_manager
    if _repo_manager is None:
        _repo_manager = MutRepoManager(S3Service(), SupabaseClient())
    return _repo_manager


def read_blob_content(project_id: str, content_hash: str | None, node_type: str = "json"):
    """Read content from MUT ObjectStore via content_hash.

    Returns (json_content, text_content). One of them will be None.
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
    """
    repo_manager = get_repo_manager_standalone()
    return MutWriteService(repo_manager)


def create_tree_reader() -> MutTreeReader:
    """在非请求上下文中构造 MutTreeReader。"""
    repo_manager = get_repo_manager_standalone()
    return MutTreeReader(repo_manager)


def create_ephemeral_client(
    project_id: str,
    auth_context: dict,
) -> MutEphemeralClient:
    """Create a MutEphemeralClient for in-process MUT protocol access.

    Used by Agent, Sandbox, MCP, and Web UI.

    Args:
        project_id: target project
        auth_context: MUT auth dict with "agent" and "_scope" keys
    """
    repo_manager = get_repo_manager_standalone()
    return MutEphemeralClient(repo_manager, project_id, auth_context)


def create_user_ephemeral_client(
    project_id: str,
    user_id: str,
) -> MutEphemeralClient:
    """Create a MutEphemeralClient for a human user (full rw scope).

    Web UI calls use this — user gets root scope with full rw access.
    """
    auth_context = {
        "agent": f"user:{user_id}",
        "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
    }
    return create_ephemeral_client(project_id, auth_context)

