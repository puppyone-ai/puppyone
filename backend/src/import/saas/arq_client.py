"""
SaaS Import ARQ Client

API-side helper to enqueue sync jobs and access the underlying ArqRedis pool.
Similar to ETLArqClient for consistency.
"""

from __future__ import annotations

import logging
from typing import Optional

from arq.connections import ArqRedis, RedisSettings, create_pool

from .config import sync_config

logger = logging.getLogger(__name__)


class SyncArqClient:
    """
    ARQ client for enqueueing sync jobs.
    
    Uses the same Redis instance and queue as ETL for unified worker management.
    """

    def __init__(
        self,
        *,
        redis_url: str | None = None,
        queue_name: str | None = None,
    ):
        self.redis_url = redis_url or sync_config.sync_redis_url
        self.queue_name = queue_name or sync_config.sync_arq_queue_name
        self._pool: Optional[ArqRedis] = None

    async def get_pool(self) -> ArqRedis:
        """Get or create the Redis connection pool."""
        if self._pool is None:
            settings = RedisSettings.from_dsn(self.redis_url)
            self._pool = await create_pool(settings)
            logger.info("SyncArqClient: redis pool created")
        return self._pool

    async def close(self) -> None:
        """Close the Redis connection pool."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def enqueue_github_sync(self, task_id: int) -> str:
        """Enqueue a GitHub repository sync job."""
        redis = await self.get_pool()
        job = await redis.enqueue_job(
            "sync_github_repo_job", task_id, _queue_name=self.queue_name
        )
        return job.job_id

    async def enqueue_notion_sync(self, task_id: int) -> str:
        """Enqueue a Notion database sync job (future)."""
        redis = await self.get_pool()
        job = await redis.enqueue_job(
            "sync_notion_db_job", task_id, _queue_name=self.queue_name
        )
        return job.job_id

    async def enqueue_sync(self, task_id: int, task_type: str) -> str:
        """
        Enqueue a sync job based on task type.
        
        Args:
            task_id: The sync task ID
            task_type: The type of sync (github_repo, notion_database, etc.)
            
        Returns:
            The ARQ job ID
        """
        job_mapping = {
            "github_repo": "sync_github_repo_job",
            "notion_database": "sync_notion_db_job",
            "notion_page": "sync_notion_page_job",
            "airtable_base": "sync_airtable_job",
            "google_sheet": "sync_google_sheet_job",
            "linear_project": "sync_linear_job",
        }

        job_name = job_mapping.get(task_type)
        if not job_name:
            raise ValueError(f"Unknown sync task type: {task_type}")

        redis = await self.get_pool()
        job = await redis.enqueue_job(
            job_name, task_id, _queue_name=self.queue_name
        )
        return job.job_id

