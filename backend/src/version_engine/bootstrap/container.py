"""Explicit Version Engine service container.

FastAPI installs one container on ``app.state`` at startup. Worker processes
can build their own container at bootstrap and pass it down explicitly. This
keeps app-scoped caches out of business modules while preserving the expensive
per-process repository cache where it belongs.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.infra.s3.service import S3Service
from src.infra.supabase.client import SupabaseClient
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
from src.version_engine.read.admin import VersionAdminService
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager
from src.version_engine.adapters.product.commands import VersionWriteCommandService


@dataclass
class VersionEngineContainer:
    """App/worker scoped Version Engine object graph."""

    repo_manager: VersionRepoManager

    def admin_service(self) -> VersionAdminService:
        return VersionAdminService(self.repo_manager)

    def product_operations(self) -> ProductOperationAdapter:
        return ProductOperationAdapter(self.repo_manager)

    def write_commands(self) -> VersionWriteCommandService:
        return VersionWriteCommandService(self.product_operations())


def build_version_engine_container(
    *,
    s3: S3Service | None = None,
    supabase: SupabaseClient | None = None,
) -> VersionEngineContainer:
    """Build a fresh container for one FastAPI app or worker process."""

    repo_manager = VersionRepoManager(s3 or S3Service(), supabase or SupabaseClient())
    return VersionEngineContainer(repo_manager=repo_manager)

