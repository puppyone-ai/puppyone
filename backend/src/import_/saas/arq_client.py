"""
SaaS Import ARQ Client

API-side helper to enqueue sync jobs and access the underlying ArqRedis pool.
Similar to ETLArqClient for consistency.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from arq.connections import ArqRedis, RedisSettings, create_pool

from .config import sync_config

logger = logging.getLogger(__name__)

# Result expiration time (1 hour) - prevents old failed results from blocking new tasks
RESULT_TIMEOUT_SECONDS = 3600


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
        return await self.enqueue_sync(task_id, "github_repo")

    async def enqueue_notion_sync(self, task_id: int) -> str:
        """Enqueue a Notion database sync job."""
        return await self.enqueue_sync(task_id, "notion_database")

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
        
        # Generate unique job ID to avoid conflicts with previous failed jobs
        unique_job_id = str(uuid.uuid4())
        
        logger.info(f"[DEBUG] Enqueueing job '{job_name}' to queue '{self.queue_name}' for task {task_id}, job_id={unique_job_id}")
        job = await redis.enqueue_job(
            job_name, 
            task_id, 
            _queue_name=self.queue_name,
            _job_id=unique_job_id,  # Unique ID prevents conflicts
            _expires=RESULT_TIMEOUT_SECONDS,  # Results expire after 1 hour
        )
        
        if job is None:
            # This shouldn't happen with unique job IDs, but handle gracefully
            logger.warning(f"[WARN] Job enqueue returned None for task {task_id}")
            return unique_job_id
            
        logger.info(f"[DEBUG] Job enqueued successfully: {job.job_id}")
        return job.job_id

