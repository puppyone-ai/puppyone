"""
Unified ARQ Worker Settings

This worker handles both ETL jobs and SaaS sync jobs.

Run worker:
  uv run arq src.etl.jobs.worker.WorkerSettings
"""

from __future__ import annotations

# Load .env file before any other imports that need env vars
from pathlib import Path
from dotenv import load_dotenv

# Find .env relative to this file (backend/.env)
_env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
print(f"[DEBUG] Loading .env from: {_env_path}")
print(f"[DEBUG] .env exists: {_env_path.exists()}")
load_dotenv(_env_path)

import os
print(f"[DEBUG] ETL_REDIS_URL from env: {os.environ.get('ETL_REDIS_URL', 'NOT SET')}")
print(f"[DEBUG] ETL_ARQ_QUEUE_NAME from env: {os.environ.get('ETL_ARQ_QUEUE_NAME', 'NOT SET')}")

import logging

from arq.connections import RedisSettings

from src.etl.config import etl_config
from src.etl.jobs.jobs import etl_ocr_job, etl_postprocess_job
from src.etl.mineru.client import MineRUClient
from src.etl.state.repository import ETLStateRepositoryRedis
from src.etl.tasks.repository import ETLTaskRepositorySupabase
from src.llm.service import LLMService
from src.s3.service import S3Service

# Import sync job bridge (uses new import_ handlers)
from src.import_.jobs.jobs import legacy_sync_job

logger = logging.getLogger(__name__)


async def startup(ctx: dict) -> None:
    """
    Initialize services for both ETL and sync jobs.
    """
    # ========== ETL Services ==========
    ctx["s3_service"] = S3Service()
    ctx["llm_service"] = LLMService()
    ctx["mineru_client"] = MineRUClient()
    ctx["task_repository"] = ETLTaskRepositorySupabase()

    # ETL Redis runtime state repo (shares same Redis as ARQ)
    ctx["state_repo"] = ETLStateRepositoryRedis(ctx["redis"])
    ctx["arq_queue_name"] = etl_config.etl_arq_queue_name
    
    # ========== Sync Services (for legacy_sync_job bridge) ==========
    # Import dependencies here to avoid circular imports
    from src.content_node.service import ContentNodeService
    from src.content_node.repository import ContentNodeRepository
    from src.oauth.github_service import GithubOAuthService
    from src.oauth.notion_service import NotionOAuthService
    from src.supabase.client import SupabaseClient
    
    # SupabaseClient wraps the raw supabase.Client
    supabase_wrapper = SupabaseClient()
    
    # Content node service for creating nodes (needs repo + s3)
    content_node_repo = ContentNodeRepository(supabase_wrapper)
    ctx["node_service"] = ContentNodeService(content_node_repo, ctx["s3_service"])
    
    # OAuth services
    ctx["github_service"] = GithubOAuthService()
    ctx["notion_service"] = NotionOAuthService()
    
    logger.info("Unified ARQ worker startup complete (ETL + Sync)")


async def shutdown(ctx: dict) -> None:
    """
    Cleanup on worker shutdown.
    """
    logger.info("Unified ARQ worker shutdown")


class WorkerSettings:
    # Combine ETL jobs and sync bridge job
    functions = [etl_ocr_job, etl_postprocess_job, legacy_sync_job]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(etl_config.etl_redis_url)
    queue_name = etl_config.etl_arq_queue_name
    # NOTE: ARQ cancels jobs on timeout via asyncio.CancelledError (BaseException on Py3.12).
    # Keep this in sync with MineRU/LLM latency expectations.
    job_timeout = etl_config.etl_task_timeout

# Debug: Print actual config values
print(f"[DEBUG] Worker redis_url: {etl_config.etl_redis_url[:50]}...")
print(f"[DEBUG] Worker queue_name: {etl_config.etl_arq_queue_name}")
