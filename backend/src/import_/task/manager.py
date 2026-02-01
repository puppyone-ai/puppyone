"""
Import Task Manager - High-level task management with Redis state.
"""

from typing import Any, Optional

import redis.asyncio as aioredis

from src.import_.task.models import ImportTask, ImportTaskStatus, ImportTaskType
from src.import_.task.repository import ImportTaskRepository
from src.import_.config import import_config
from src.utils.logger import log_info, log_error


# Global Redis connection
_redis_client: Optional[aioredis.Redis] = None


async def get_redis_client() -> aioredis.Redis:
    """Get or create async Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            import_config.import_redis_url,
            decode_responses=True,
        )
    return _redis_client


class ImportTaskManager:
    """
    Manages import tasks with Redis for real-time state and DB for persistence.
    
    Redis is source of truth during task execution.
    DB is updated at key checkpoints and terminal states.
    """

    REDIS_PREFIX = import_config.import_redis_prefix + "task:"
    REDIS_TTL = import_config.import_state_ttl_seconds

    def __init__(self, repository: Optional[ImportTaskRepository] = None):
        self.repo = repository or ImportTaskRepository()
        self._redis: Optional[aioredis.Redis] = None

    async def _get_redis(self) -> aioredis.Redis:
        """Get Redis client lazily."""
        if self._redis is None:
            self._redis = await get_redis_client()
        return self._redis

    async def create_task(
        self,
        user_id: str,
        project_id: str,
        task_type: ImportTaskType,
        source_url: Optional[str] = None,
        source_file_key: Optional[str] = None,
        config: Optional[dict[str, Any]] = None,
    ) -> ImportTask:
        """Create a new import task."""
        task = ImportTask(
            user_id=user_id,
            project_id=project_id,
            task_type=task_type,
            source_url=source_url,
            source_file_key=source_file_key,
            config=config or {},
        )
        
        # Save to DB
        task = await self.repo.create(task)
        
        # Cache in Redis
        await self._save_to_redis(task)
        
        log_info(f"Created import task: {task.id} ({task_type.value})")
        return task

    async def get_task(self, task_id: str) -> Optional[ImportTask]:
        """Get task, preferring Redis cache."""
        # Try Redis first
        task = await self._get_from_redis(task_id)
        if task:
            return task
        
        # Fallback to DB
        task = await self.repo.get(task_id)
        if task:
            await self._save_to_redis(task)
        
        return task

    async def update_progress(
        self,
        task_id: str,
        progress: int,
        message: Optional[str] = None,
    ) -> None:
        """Update task progress (Redis only for performance)."""
        task = await self._get_from_redis(task_id)
        if task:
            task.update_progress(progress, message)
            await self._save_to_redis(task)

    async def mark_processing(self, task_id: str, message: str = "Processing...") -> None:
        """Mark task as processing."""
        task = await self.get_task(task_id)
        if task:
            task.mark_processing(message)
            await self._save_to_redis(task)
            # Also update DB status
            await self.repo.update_status(
                task_id, ImportTaskStatus.PROCESSING, message=message
            )

    async def mark_completed(
        self,
        task_id: str,
        content_node_id: str,
        items_count: int = 0,
    ) -> None:
        """Mark task as completed."""
        task = await self.get_task(task_id)
        if task:
            task.mark_completed(content_node_id, items_count)
            await self._save_to_redis(task)
            # Update DB
            await self.repo.update_status(
                task_id,
                ImportTaskStatus.COMPLETED,
                progress=100,
                message="Completed",
                content_node_id=content_node_id,
                items_count=items_count,
            )
            log_info(f"Import task completed: {task_id}")

    async def mark_failed(self, task_id: str, error: str) -> None:
        """Mark task as failed."""
        task = await self.get_task(task_id)
        if task:
            task.mark_failed(error)
            await self._save_to_redis(task)
            # Update DB
            await self.repo.update_status(
                task_id,
                ImportTaskStatus.FAILED,
                error=error,
                message=f"Failed: {error[:100]}",
            )
            log_error(f"Import task failed: {task_id} - {error}")

    async def mark_cancelled(self, task_id: str, reason: Optional[str] = None) -> None:
        """Mark task as cancelled."""
        task = await self.get_task(task_id)
        if task:
            task.mark_cancelled(reason)
            await self._save_to_redis(task)
            # Update DB
            await self.repo.update_status(
                task_id,
                ImportTaskStatus.CANCELLED,
                error=reason,
                message=f"Cancelled: {reason}" if reason else "Cancelled",
            )

    async def get_user_tasks(
        self,
        user_id: str,
        project_id: Optional[str] = None,
        limit: int = 50,
    ) -> list[ImportTask]:
        """Get tasks for a user."""
        return await self.repo.get_by_user(user_id, project_id, limit)

    # === Redis helpers ===

    def _redis_key(self, task_id: str) -> str:
        return f"{self.REDIS_PREFIX}{task_id}"

    async def _save_to_redis(self, task: ImportTask) -> None:
        """Save task to Redis."""
        if not task.id:
            return
        redis = await self._get_redis()
        key = self._redis_key(task.id)
        data = task.model_dump_json()
        await redis.set(key, data, ex=self.REDIS_TTL)

    async def _get_from_redis(self, task_id: str) -> Optional[ImportTask]:
        """Get task from Redis."""
        redis = await self._get_redis()
        key = self._redis_key(task_id)
        data = await redis.get(key)
        if data:
            return ImportTask.model_validate_json(data)
        return None

    async def _delete_from_redis(self, task_id: str) -> None:
        """Delete task from Redis."""
        redis = await self._get_redis()
        key = self._redis_key(task_id)
        await redis.delete(key)
