"""
Import ARQ Client

API-side helper to enqueue import jobs and access the underlying ArqRedis pool.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from arq.connections import ArqRedis, RedisSettings, create_pool

from src.import_.config import import_config

logger = logging.getLogger(__name__)

# Result expiration time (1 hour)
RESULT_TIMEOUT_SECONDS = 3600


class ImportArqClient:
    """ARQ client for enqueueing import jobs."""

    def __init__(self, *, redis_url: str | None = None):
        self._redis_url = redis_url
        self._pool: Optional[ArqRedis] = None

    @property
    def redis_url(self) -> str:
        return self._redis_url or import_config.import_redis_url

    @property
    def queue_name(self) -> str:
        return import_config.import_arq_queue_name

    async def get_pool(self) -> ArqRedis:
        """Get or create the Redis connection pool."""
        if self._pool is None:
            settings = RedisSettings.from_dsn(self.redis_url)
            self._pool = await create_pool(settings)
            logger.info("ImportArqClient: redis pool created")
        return self._pool

    async def close(self) -> None:
        """Close the Redis connection pool."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def enqueue_import(self, task_id: str) -> str:
        """
        Enqueue an import job.
        
        Args:
            task_id: The import task ID (UUID)
            
        Returns:
            The ARQ job ID
        """
        redis = await self.get_pool()
        
        # Generate unique job ID
        unique_job_id = str(uuid.uuid4())
        
        logger.info(f"Enqueueing import_job for task {task_id}, job_id={unique_job_id}")
        
        job = await redis.enqueue_job(
            "import_job",
            task_id,
            _queue_name=self.queue_name,
            _job_id=unique_job_id,
            _expires=RESULT_TIMEOUT_SECONDS,
        )
        
        if job is None:
            logger.warning(f"Job enqueue returned None for task {task_id}")
            return unique_job_id
            
        return job.job_id


# Global singleton
_arq_client: Optional[ImportArqClient] = None


async def get_import_arq_client() -> ImportArqClient:
    """Get or create the ImportArqClient singleton."""
    global _arq_client
    if _arq_client is None:
        _arq_client = ImportArqClient()
    return _arq_client
