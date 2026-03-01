"""
Sync Worker - ARQ worker configuration.

Handles: db_sync_job (DB connector refresh).

Run worker:
  uv run arq src.sync.jobs.worker.WorkerSettings
"""

from __future__ import annotations

from pathlib import Path
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
load_dotenv(_env_path, override=True)

from typing import Any

from arq.connections import RedisSettings

from src.sync.config import import_config
from src.db_connector.jobs import db_sync_job
from src.content_node.repository import ContentNodeRepository
from src.content_node.service import ContentNodeService
from src.supabase.client import SupabaseClient
from src.s3.service import S3Service
from src.db_connector.repository import DBConnectionRepository
from src.utils.logger import log_info


async def startup(ctx: dict[str, Any]) -> None:
    """Initialize services on worker startup."""
    log_info("Sync worker starting up...")

    supabase_client = SupabaseClient()
    node_repository = ContentNodeRepository(supabase_client)
    s3_service = S3Service()

    ctx["node_service"] = ContentNodeService(node_repository, s3_service)
    ctx["db_repo"] = DBConnectionRepository(supabase_client)

    log_info("Sync worker initialized (db_sync_job)")


async def shutdown(ctx: dict[str, Any]) -> None:
    """Cleanup on worker shutdown."""
    log_info("Sync worker shutting down...")


class WorkerSettings:
    """ARQ Worker configuration."""

    functions = [db_sync_job]
    on_startup = startup
    on_shutdown = shutdown

    redis_settings = RedisSettings.from_dsn(import_config.import_redis_url)

    max_jobs = import_config.import_max_jobs
    job_timeout = import_config.import_job_timeout_seconds
    keep_result = 3600
    queue_name = import_config.import_arq_queue_name
