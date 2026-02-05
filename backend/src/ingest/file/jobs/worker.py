"""
ETL ARQ Worker Settings

This worker handles ETL jobs (OCR + postprocess for document processing).
SaaS sync jobs are handled by the separate import_worker.

Run worker:
  uv run arq src.etl.jobs.worker.WorkerSettings
"""

from __future__ import annotations

# Load .env file before any other imports that need env vars
from pathlib import Path
from dotenv import load_dotenv

# Find .env relative to this file (backend/.env)
# worker.py -> jobs/ -> file/ -> ingest/ -> src/ -> backend/
_env_path = Path(__file__).resolve().parent.parent.parent.parent.parent / ".env"
print(f"[DEBUG] Loading .env from: {_env_path}")
print(f"[DEBUG] .env exists: {_env_path.exists()}")
load_dotenv(_env_path)

import os
print(f"[DEBUG] ETL_REDIS_URL from env: {os.environ.get('ETL_REDIS_URL', 'NOT SET')}")
print(f"[DEBUG] ETL_ARQ_QUEUE_NAME from env: {os.environ.get('ETL_ARQ_QUEUE_NAME', 'NOT SET')}")

import logging

from arq.connections import RedisSettings

from src.ingest.file.config import etl_config
from src.ingest.file.jobs.jobs import etl_ocr_job, etl_postprocess_job
from src.ingest.file.mineru.client import MineRUClient
from src.ingest.file.state.repository import ETLStateRepositoryRedis
from src.ingest.file.tasks.repository import ETLTaskRepositorySupabase
from src.llm.service import LLMService
from src.s3.service import S3Service

# NOTE: legacy_sync_job has been removed - SaaS sync now uses separate import_worker
# See: src/import_/jobs/worker.py

logger = logging.getLogger(__name__)


async def startup(ctx: dict) -> None:
    """
    Initialize services for ETL jobs.
    """
    # ========== ETL Services ==========
    ctx["s3_service"] = S3Service()
    ctx["llm_service"] = LLMService()
    ctx["mineru_client"] = MineRUClient()
    ctx["task_repository"] = ETLTaskRepositorySupabase()

    # ETL Redis runtime state repo (shares same Redis as ARQ)
    ctx["state_repo"] = ETLStateRepositoryRedis(ctx["redis"])
    ctx["arq_queue_name"] = etl_config.etl_arq_queue_name
    
    logger.info("ETL ARQ worker startup complete")


async def shutdown(ctx: dict) -> None:
    """
    Cleanup on worker shutdown.
    """
    logger.info("ETL ARQ worker shutdown")


class WorkerSettings:
    # ETL jobs only (SaaS sync uses separate import_worker)
    functions = [etl_ocr_job, etl_postprocess_job]
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
