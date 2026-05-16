"""
Mut Engine — FastAPI dependency injection

Provides DI factory functions for MutAdminService and MutOps.
"""

from __future__ import annotations

from fastapi import Depends

from src.infra.s3.dependencies import get_s3_service
from src.infra.s3.service import S3Service
from src.infra.supabase.client import SupabaseClient
from src.mut_engine.server.admin import MutAdminService
from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.adapters.operations.ops_adapter import MutOps

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


def get_mut_admin_service(
    repo_manager: MutRepoManager = Depends(get_repo_manager),
) -> MutAdminService:
    return MutAdminService(repo_manager)


def get_repo_manager_standalone() -> MutRepoManager:
    """Get a cached MutRepoManager outside of FastAPI DI context."""
    global _repo_manager
    if _repo_manager is None:
        _repo_manager = MutRepoManager(S3Service(), SupabaseClient())
    return _repo_manager


def create_mut_admin_service() -> MutAdminService:
    """Construct MutAdminService outside of a request context.

    Used by scheduler jobs, ARQ workers, tests, and other scenarios
    where FastAPI Depends is not available.
    """
    repo_manager = get_repo_manager_standalone()
    return MutAdminService(repo_manager)


def get_mut_ops(
    repo_manager: MutRepoManager = Depends(get_repo_manager),
) -> MutOps:
    """FastAPI DI: MutOps for request handlers."""
    return MutOps(repo_manager)


def create_mut_ops() -> MutOps:
    """Non-request context: MutOps for jobs, workers, etc."""
    return MutOps(get_repo_manager_standalone())

