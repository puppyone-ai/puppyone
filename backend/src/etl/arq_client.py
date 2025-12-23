"""
ETL ARQ Client

API-side helper to enqueue ETL jobs and access the underlying ArqRedis pool.
"""

from __future__ import annotations

import logging
from typing import Optional

from arq.connections import ArqRedis, RedisSettings, create_pool

from src.etl.config import etl_config

logger = logging.getLogger(__name__)


class ETLArqClient:
    def __init__(
        self,
        *,
        redis_url: str | None = None,
        queue_name: str | None = None,
    ):
        self.redis_url = redis_url or etl_config.etl_redis_url
        self.queue_name = queue_name or etl_config.etl_arq_queue_name
        self._pool: Optional[ArqRedis] = None

    async def get_pool(self) -> ArqRedis:
        if self._pool is None:
            settings = RedisSettings.from_dsn(self.redis_url)
            self._pool = await create_pool(settings)
            logger.info("ETLArqClient: redis pool created")
        return self._pool

    async def enqueue_ocr(self, task_id: int) -> str:
        redis = await self.get_pool()
        job = await redis.enqueue_job("etl_ocr_job", task_id, _queue_name=self.queue_name)
        return job.job_id

    async def enqueue_postprocess(self, task_id: int) -> str:
        redis = await self.get_pool()
        job = await redis.enqueue_job("etl_postprocess_job", task_id, _queue_name=self.queue_name)
        return job.job_id


