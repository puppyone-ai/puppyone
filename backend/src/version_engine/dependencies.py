"""
Version Engine — FastAPI dependency injection

Provides DI factory functions for VersionAdminService, ProductOperationAdapter,
and VersionWriteCommandService.
"""

from __future__ import annotations

from fastapi import Depends

from src.infra.s3.dependencies import get_s3_service
from src.infra.s3.service import S3Service
from src.infra.supabase.client import SupabaseClient
from src.version_engine.server.admin import VersionAdminService
from src.version_engine.server.repo_manager import VersionRepoManager
from src.version_engine.adapters.operations.product_operation_adapter import ProductOperationAdapter
from src.version_engine.services.write_command import VersionWriteCommandService

_repo_manager: VersionRepoManager | None = None


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


def get_repo_manager(
    s3: S3Service = Depends(get_s3_service),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> VersionRepoManager:
    global _repo_manager
    if _repo_manager is None:
        _repo_manager = VersionRepoManager(s3, supabase)
    return _repo_manager


def get_version_admin_service(
    repo_manager: VersionRepoManager = Depends(get_repo_manager),
) -> VersionAdminService:
    return VersionAdminService(repo_manager)


def get_repo_manager_standalone() -> VersionRepoManager:
    """Get a cached VersionRepoManager outside of FastAPI DI context."""
    global _repo_manager
    if _repo_manager is None:
        _repo_manager = VersionRepoManager(S3Service(), SupabaseClient())
    return _repo_manager


def create_version_admin_service() -> VersionAdminService:
    """Construct VersionAdminService outside of a request context.

    Used by scheduler jobs, ARQ workers, tests, and other scenarios
    where FastAPI Depends is not available.
    """
    repo_manager = get_repo_manager_standalone()
    return VersionAdminService(repo_manager)


def get_product_operation_adapter(
    repo_manager: VersionRepoManager = Depends(get_repo_manager),
) -> ProductOperationAdapter:
    """FastAPI DI: ProductOperationAdapter for request handlers."""
    return ProductOperationAdapter(repo_manager)


def create_product_operation_adapter() -> ProductOperationAdapter:
    """Non-request context: ProductOperationAdapter for jobs, workers, etc."""
    return ProductOperationAdapter(get_repo_manager_standalone())


def get_version_write_command_service(
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
) -> VersionWriteCommandService:
    """FastAPI DI: L3 write command service for request handlers."""
    return VersionWriteCommandService(ops)


def create_version_write_command_service() -> VersionWriteCommandService:
    """Non-request context: L3 write command service for jobs/workers."""
    return VersionWriteCommandService(create_product_operation_adapter())
