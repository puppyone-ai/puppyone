"""
Sync Task Service

Business logic for sync tasks, using ARQ for background job execution.

NOTE: The actual task execution logic has been moved to:
- src/import_/saas/github/processor.py (GitHub repos)
- src/import_/saas/jobs.py (ARQ job functions)

This service now serves as a control plane:
- Creates task records in database
- Enqueues jobs to ARQ
- Provides access to runtime state from Redis
"""

from typing import Optional
from urllib.parse import urlparse

from src.content_node.service import ContentNodeService
from src.oauth.github_service import GithubOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_error, log_info

from .models import SyncTask, SyncTaskStatus, SyncTaskType
from .repository import SyncTaskRepository


class SyncTaskService:
    """
    Service for managing sync tasks.
    
    This is the control-plane service that:
    - Creates tasks in the database
    - Enqueues jobs to ARQ
    - Provides status queries (checking Redis first, then DB)
    """

    def __init__(
        self,
        repository: SyncTaskRepository,
        node_service: ContentNodeService,
        s3_service: S3Service,
        github_service: Optional[GithubOAuthService] = None,
    ):
        self.repository = repository
        self.node_service = node_service
        self.s3_service = s3_service
        self.github_service = github_service or GithubOAuthService()
        
        # Lazy-initialized ARQ client and state repository
        self._arq_client = None
        self._state_repo = None

    async def _get_arq_client(self):
        """Get or create the ARQ client (lazy initialization)."""
        if self._arq_client is None:
            from src.import_.saas.arq_client import SyncArqClient
            self._arq_client = SyncArqClient()
        return self._arq_client

    async def _get_state_repo(self):
        """Get or create the Redis state repository (lazy initialization)."""
        if self._state_repo is None:
            from src.import_.saas.state_repository import SyncStateRepositoryRedis
            arq_client = await self._get_arq_client()
            redis = await arq_client.get_pool()
            self._state_repo = SyncStateRepositoryRedis(redis)
        return self._state_repo

    def detect_task_type(self, url: str) -> Optional[SyncTaskType]:
        """Detect task type from URL."""
        parsed = urlparse(url)
        host = parsed.netloc.lower()

        if host == "github.com" or host.endswith(".github.com"):
            return SyncTaskType.GITHUB_REPO
        if "notion.so" in host or "notion.site" in host:
            return SyncTaskType.NOTION_DATABASE
        if "airtable.com" in host:
            return SyncTaskType.AIRTABLE_BASE
        if "docs.google.com" in host and "spreadsheets" in url:
            return SyncTaskType.GOOGLE_SHEET
        if "linear.app" in host:
            return SyncTaskType.LINEAR_PROJECT

        return None

    async def create_task(
        self,
        user_id: str,
        project_id: str,
        url: str,
        task_type: Optional[SyncTaskType] = None,
    ) -> SyncTask:
        """Create a new sync task."""
        if task_type is None:
            task_type = self.detect_task_type(url)
            if task_type is None:
                raise ValueError(f"Cannot detect task type from URL: {url}")

        task = SyncTask(
            user_id=user_id,
            project_id=project_id,
            task_type=task_type,
            source_url=url,
            status=SyncTaskStatus.PENDING,
        )

        return await self.repository.create(task)

    async def enqueue_task(self, task_id: int, task_type: str) -> str:
        """
        Enqueue a task for processing by the ARQ worker.
        
        Args:
            task_id: The task ID
            task_type: The task type (github_repo, notion_database, etc.)
            
        Returns:
            The ARQ job ID
        """
        arq_client = await self._get_arq_client()
        job_id = await arq_client.enqueue_sync(task_id, task_type)
        
        # Initialize runtime state in Redis
        task = await self.repository.get_by_id(task_id)
        if task:
            from src.import_.saas.models import SyncRuntimeState
            state_repo = await self._get_state_repo()
            
            state = SyncRuntimeState(
                task_id=task_id,
                user_id=task.user_id,
                project_id=task.project_id,
                task_type=task.task_type,
                source_url=task.source_url,
                arq_job_id=job_id,
            )
            await state_repo.set(state)
        
        log_info(f"Enqueued sync task {task_id} as ARQ job {job_id}")
        return job_id

    async def get_task(self, task_id: int) -> Optional[SyncTask]:
        """Get a task by ID."""
        return await self.repository.get_by_id(task_id)

    async def get_runtime_state(self, task_id: int):
        """
        Get runtime state from Redis (if available).
        
        Returns None if the task is not in Redis (completed/not started).
        """
        try:
            state_repo = await self._get_state_repo()
            return await state_repo.get(task_id)
        except Exception as e:
            log_error(f"Failed to get runtime state for task {task_id}: {e}")
            return None

    async def get_user_tasks(
        self, user_id: str, include_completed: bool = True
    ) -> list[SyncTask]:
        """Get all tasks for a user."""
        return await self.repository.get_by_user(
            user_id, include_completed=include_completed
        )

    async def get_active_tasks(self, user_id: str) -> list[SyncTask]:
        """Get all active (non-terminal) tasks for a user."""
        return await self.repository.get_active_tasks(user_id)

    async def cancel_task(self, task_id: int, reason: Optional[str] = None) -> bool:
        """Cancel a task."""
        task = await self.repository.get_by_id(task_id)
        if task is None:
            return False
        if task.status.is_terminal():
            return False

        # Update database
        task.mark_cancelled(reason)
        await self.repository.update(task)
        
        # Update Redis state (if exists)
        try:
            state_repo = await self._get_state_repo()
            state = await state_repo.get(task_id)
            if state:
                state.mark_cancelled(reason)
                await state_repo.set_terminal(state)
        except Exception as e:
            log_error(f"Failed to update Redis state for cancelled task {task_id}: {e}")

        return True
