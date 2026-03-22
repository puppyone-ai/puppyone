"""
Mut Engine — FastAPI dependency injection

Provides DI factory functions for MutWriteService and MutOps.
"""

from __future__ import annotations

from fastapi import Depends

from src.infra.s3.service import S3Service
from src.infra.s3.dependencies import get_s3_service
from src.infra.supabase.client import SupabaseClient

from src.mut_engine.repo_manager import MutRepoManager
from src.mut_engine.write_service import MutWriteService
from src.mut_engine.ops import MutOps


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
    """Construct MutWriteService outside of a request context.

    Used by scheduler jobs, ARQ workers, tests, and other scenarios
    where FastAPI Depends is not available.
    """
    repo_manager = get_repo_manager_standalone()
    return MutWriteService(repo_manager)


def get_mut_ops(
    repo_manager: MutRepoManager = Depends(get_repo_manager),
) -> MutOps:
    """FastAPI DI: MutOps for request handlers."""
    return MutOps(repo_manager)


def create_mut_ops() -> MutOps:
    """Non-request context: MutOps for jobs, workers, etc."""
    return MutOps(get_repo_manager_standalone())

