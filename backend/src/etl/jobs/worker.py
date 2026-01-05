"""
ETL ARQ Worker Settings

Run worker:
  uv run arq src.etl.jobs.worker.WorkerSettings
"""

from __future__ import annotations

import logging

from arq.connections import RedisSettings

from src.etl.config import etl_config
from src.etl.jobs.jobs import etl_ocr_job, etl_postprocess_job
from src.etl.mineru.client import MineRUClient
from src.etl.state.repository import ETLStateRepositoryRedis
from src.etl.tasks.repository import ETLTaskRepositorySupabase
from src.llm.service import LLMService
from src.s3.service import S3Service

logger = logging.getLogger(__name__)


async def startup(ctx: dict) -> None:
    # Core services
    ctx["s3_service"] = S3Service()
    ctx["llm_service"] = LLMService()
    ctx["mineru_client"] = MineRUClient()
    ctx["task_repository"] = ETLTaskRepositorySupabase()

    # Redis runtime state repo (shares same Redis as ARQ)
    ctx["state_repo"] = ETLStateRepositoryRedis(ctx["redis"])
    ctx["arq_queue_name"] = etl_config.etl_arq_queue_name
    logger.info("ETL ARQ worker startup complete")


async def shutdown(ctx: dict) -> None:
    logger.info("ETL ARQ worker shutdown")


class WorkerSettings:
    functions = [etl_ocr_job, etl_postprocess_job]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(etl_config.etl_redis_url)
    queue_name = etl_config.etl_arq_queue_name
    # NOTE: ARQ cancels jobs on timeout via asyncio.CancelledError (BaseException on Py3.12).
    # Keep this in sync with MineRU/LLM latency expectations.
    job_timeout = etl_config.etl_task_timeout
