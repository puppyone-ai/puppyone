"""
ETL Service

ETL control-plane service (API-side).

Execution happens in ARQ workers; API process is responsible for:
- creating task records (Supabase)
- maintaining runtime state (Redis)
- enqueueing jobs (ARQ)
- aggregating status (Redis first, fallback Supabase)
"""

from __future__ import annotations

import logging
from datetime import datetime, UTC
from typing import Optional, Any

from src.etl.arq_client import ETLArqClient
from src.etl.config import etl_config
from src.etl.exceptions import RuleNotFoundError
from src.etl.rules.default_rules import get_default_rule_id
from src.exceptions import NotFoundException, ErrorCode
from src.etl.rules.repository_supabase import RuleRepositorySupabase
from src.etl.state.models import ETLPhase, ETLRuntimeState
from src.etl.state.repository import ETLStateRepositoryRedis
from src.etl.tasks.models import ETLTask, ETLTaskStatus
from src.etl.tasks.repository import ETLTaskRepositoryBase
from src.supabase.dependencies import get_supabase_client

logger = logging.getLogger(__name__)


class ETLService:
    """Core ETL service for document processing."""

    def __init__(
        self,
        task_repository: ETLTaskRepositoryBase,
        arq_client: ETLArqClient,
        state_repo: ETLStateRepositoryRedis,
    ):
        """
        Initialize ETL service.

        Args:
            task_repository: Repository for ETL tasks (Supabase)
            arq_client: ARQ client for enqueueing jobs
            state_repo: Redis runtime state repository
        """
        self.task_repository = task_repository
        self.arq_client = arq_client
        self.state_repo = state_repo

        logger.info("ETLService initialized")

    def _get_rule_repository(self, user_id: str) -> RuleRepositorySupabase:
        """
        获取规则仓库实例（按用户）。

        Args:
            user_id: 用户 ID

        Returns:
            RuleRepositorySupabase 实例
        """
        supabase_client = get_supabase_client()
        return RuleRepositorySupabase(supabase_client=supabase_client, user_id=user_id)

    async def start(self):
        """Warm up control-plane dependencies."""
        await self.arq_client.get_pool()
        logger.info("ETL service started (control-plane)")

    async def stop(self):
        """No-op in API process (worker is separate)."""
        logger.info("ETL service stopped (control-plane)")

    async def submit_etl_task(
        self,
        user_id: str,
        project_id: str,
        filename: str,
        rule_id: int | None,
        s3_key: str | None = None,
    ) -> ETLTask:
        """
        Submit an ETL task to the queue.

        Args:
            user_id: User ID (string type)
            project_id: Project ID
            filename: Source filename
            rule_id: Rule ID to apply

        Returns:
            Created ETL task

        Raises:
            RuleNotFoundError: If rule doesn't exist
        """
        # Determine rule: use global default if omitted
        if rule_id is None:
            rule_repository = self._get_rule_repository(user_id)
            rule_id = get_default_rule_id(rule_repository)

        # Validate rule exists (using user's rule repository)
        rule_repository = self._get_rule_repository(user_id)
        rule = rule_repository.get_rule(str(rule_id))
        if not rule:
            logger.error(f"Rule not found: {rule_id}")
            raise RuleNotFoundError(str(rule_id))

        # Create task (task_id will be assigned by repository)
        task = ETLTask(
            task_id=None,  # Will be assigned by database
            user_id=user_id,
            project_id=project_id,
            filename=filename,
            rule_id=int(rule_id),
        )

        if s3_key:
            task.metadata["s3_key"] = s3_key

        # Create in DB to assign task_id
        task_with_id = self.task_repository.create_task(task)

        # Init runtime state and enqueue OCR job
        job_id = await self.arq_client.enqueue_ocr(task_with_id.task_id)
        state = ETLRuntimeState(
            task_id=task_with_id.task_id,
            user_id=task_with_id.user_id,
            project_id=task_with_id.project_id,
            filename=task_with_id.filename,
            rule_id=task_with_id.rule_id,
            status=ETLTaskStatus.PENDING,
            phase=ETLPhase.OCR,
            progress=0,
            arq_job_id_ocr=job_id,
            metadata=task_with_id.metadata,
        )
        await self.state_repo.set(state)

        logger.info(
            f"ETL task submitted: task_id={task_with_id.task_id}, "
            f"user_id={user_id}, filename={filename}, rule_id={rule_id}"
        )

        return task_with_id

    async def create_failed_task(
        self,
        *,
        user_id: str,
        project_id: int,
        filename: str,
        rule_id: int | None,
        error: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> ETLTask:
        """
        Create a failed ETL task record for cases where we want a pollable task_id
        but the pipeline cannot be started (e.g. upload failed).
        """
        # Determine rule: use global default if omitted
        if rule_id is None:
            rule_repository = self._get_rule_repository(user_id)
            rule_id = get_default_rule_id(rule_repository)

        # Validate rule exists (using user's rule repository)
        rule_repository = self._get_rule_repository(user_id)
        rule = rule_repository.get_rule(str(rule_id))
        if not rule:
            logger.error(f"Rule not found: {rule_id}")
            raise RuleNotFoundError(str(rule_id))

        task = ETLTask(
            task_id=None,
            user_id=user_id,
            project_id=project_id,
            filename=filename,
            rule_id=int(rule_id),
            status=ETLTaskStatus.FAILED,
            progress=0,
            error=error,
            metadata=metadata or {},
        )

        task_with_id = self.task_repository.create_task(task)
        logger.info(
            f"Created failed ETL task: task_id={task_with_id.task_id}, user_id={user_id}, error={error}"
        )
        return task_with_id

    async def get_task_status(self, task_id: int) -> Optional[ETLTask]:
        """
        Get ETL task status.

        Args:
            task_id: Task ID

        Returns:
            ETLTask if found, None otherwise
        """
        state = await self.state_repo.get(task_id)
        if state is not None:
            # Reconcile "stuck running" tasks (e.g. worker crash/timeout before state could be finalized).
            # If the runtime state hasn't been updated for longer than job_timeout + buffer, mark it failed.
            if state.status in (
                ETLTaskStatus.MINERU_PARSING,
                ETLTaskStatus.LLM_PROCESSING,
            ):
                age_s = (datetime.now(UTC) - state.updated_at).total_seconds()
                if age_s > (etl_config.etl_task_timeout + 30):
                    err = f"Runtime state stale for {int(age_s)}s (timeout={etl_config.etl_task_timeout}s)"
                    try:
                        # Best-effort: mark Redis terminal state
                        state.status = ETLTaskStatus.FAILED
                        state.phase = ETLPhase.FINALIZE
                        state.progress = 0
                        state.error_stage = "stale"
                        state.error_message = err
                        await self.state_repo.set_terminal(state)
                    except Exception:
                        logger.warning(
                            f"Failed to set stale terminal state for task_id={task_id}",
                            exc_info=True,
                        )

                    try:
                        # Best-effort: mark DB terminal state
                        task = self.task_repository.get_task(task_id)
                        if task:
                            task.status = ETLTaskStatus.FAILED
                            task.error = err
                            task.metadata["error_stage"] = "stale"
                            self.task_repository.update_task(task)
                            return task
                    except Exception:
                        logger.warning(
                            f"Failed to persist stale failure for task_id={task_id}",
                            exc_info=True,
                        )

            # Terminal state details should come from DB for result payload stability
            if state.status in (
                ETLTaskStatus.COMPLETED,
                ETLTaskStatus.FAILED,
                ETLTaskStatus.CANCELLED,
            ):
                return self.task_repository.get_task(task_id)

            return ETLTask(
                task_id=state.task_id,
                user_id=state.user_id,
                project_id=state.project_id,
                filename=state.filename,
                rule_id=state.rule_id,
                status=state.status,
                progress=state.progress,
                created_at=state.created_at.replace(tzinfo=None),
                updated_at=state.updated_at.replace(tzinfo=None),
                error=state.error_message,
                metadata=state.metadata,
            )

        return self.task_repository.get_task(task_id)

    async def get_task_status_with_access_check(
        self, task_id: int, user_id: str
    ) -> ETLTask:
        """
        获取任务状态并验证用户权限

        Args:
            task_id: 任务ID
            user_id: 用户ID（字符串类型）

        Returns:
            已验证的 ETLTask 对象

        Raises:
            NotFoundException: 如果任务不存在或用户无权限
        """
        task = await self.get_task_status(task_id)
        if not task:
            raise NotFoundException(
                f"ETL task not found: {task_id}", code=ErrorCode.NOT_FOUND
            )

        # 检查用户权限
        if task.user_id != user_id:
            raise NotFoundException(
                f"ETL task not found: {task_id}", code=ErrorCode.NOT_FOUND
            )

        return task

    async def list_tasks(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[int] = None,
        status: Optional[ETLTaskStatus] = None,
    ) -> list[ETLTask]:
        """
        List ETL tasks with optional filters.

        Args:
            user_id: Filter by user ID (string type)
            project_id: Filter by project ID
            status: Filter by status

        Returns:
            List of matching tasks
        """
        tasks = self.task_repository.list_tasks(
            user_id=user_id, project_id=project_id, status=status, limit=100, offset=0
        )

        for t in tasks:
            if t.task_id is None:
                continue
            st = await self.state_repo.get(t.task_id)
            if not st:
                continue
            if st.status in (
                ETLTaskStatus.PENDING,
                ETLTaskStatus.MINERU_PARSING,
                ETLTaskStatus.LLM_PROCESSING,
            ):
                t.status = st.status
                t.progress = st.progress
                t.error = st.error_message or t.error
                merged = dict(t.metadata or {})
                merged.update(st.metadata or {})
                t.metadata = merged

        return tasks

    async def cancel_task(
        self, task_id: int, user_id: str, *, force: bool = False
    ) -> ETLTask:
        """
        Cancel a queued/pending task.

        By default, only allowed when Redis runtime state is still `pending` (i.e. not started).
        When force=True, allow cancelling running tasks by marking terminal CANCELLED state.
        Note: this cannot interrupt external providers immediately; it is a control-plane cancellation.
        """
        task = self.task_repository.get_task(task_id)
        if not task or task.user_id != user_id:
            raise NotFoundException(
                f"ETL task not found: {task_id}", code=ErrorCode.NOT_FOUND
            )

        if not force:
            # Only allow cancelling pending in DB as well
            if task.status != ETLTaskStatus.PENDING:
                raise ValueError(f"Task not cancellable in status={task.status.value}")
        else:
            if task.status in (
                ETLTaskStatus.COMPLETED,
                ETLTaskStatus.FAILED,
                ETLTaskStatus.CANCELLED,
            ):
                raise ValueError(f"Task not cancellable in status={task.status.value}")

        state = await self.state_repo.get(task_id)
        if state is None:
            # Redis state may have expired; create a minimal terminal state so worker jobs can honor cancellation
            state = ETLRuntimeState(
                task_id=task_id,
                user_id=task.user_id,
                project_id=task.project_id,
                filename=task.filename,
                rule_id=task.rule_id,
                status=ETLTaskStatus.CANCELLED,
                phase=ETLPhase.FINALIZE,
                progress=0,
                error_message="Cancelled by user",
                metadata=task.metadata,
            )
        else:
            if state.user_id != user_id:
                raise NotFoundException(
                    f"ETL task not found: {task_id}", code=ErrorCode.NOT_FOUND
                )
            if not force and state.status != ETLTaskStatus.PENDING:
                raise ValueError(f"Task not cancellable in status={state.status.value}")
            if state.status in (
                ETLTaskStatus.COMPLETED,
                ETLTaskStatus.FAILED,
                ETLTaskStatus.CANCELLED,
            ):
                raise ValueError(f"Task not cancellable in status={state.status.value}")
            state.status = ETLTaskStatus.CANCELLED
            state.phase = ETLPhase.FINALIZE
            state.progress = 0
            state.error_message = "Cancelled by user"

        await self.state_repo.set_terminal(state)

        task.mark_cancelled("Cancelled by user")
        self.task_repository.update_task(task)
        return task

    async def retry_task(self, task_id: int, user_id: str, from_stage: str) -> ETLTask:
        """
        Retry from a given stage: "mineru" or "postprocess".
        """
        task = self.task_repository.get_task(task_id)
        if not task or task.user_id != user_id:
            raise NotFoundException(
                f"ETL task not found: {task_id}", code=ErrorCode.NOT_FOUND
            )

        state = await self.state_repo.get(task_id)
        if state is None:
            state = ETLRuntimeState(
                task_id=task_id,
                user_id=task.user_id,
                project_id=task.project_id,
                filename=task.filename,
                rule_id=task.rule_id,
                status=ETLTaskStatus.PENDING,
                phase=ETLPhase.OCR,
                progress=0,
                metadata=task.metadata,
            )

        if state.status in (ETLTaskStatus.MINERU_PARSING, ETLTaskStatus.LLM_PROCESSING):
            raise ValueError(f"Task is running (status={state.status.value})")

        if from_stage == "postprocess":
            md_key = state.artifact_mineru_markdown_key or task.metadata.get(
                "artifact_mineru_markdown_key"
            )
            if not md_key:
                raise ValueError(
                    "Cannot retry postprocess: missing markdown artifact pointer"
                )
            job_id = await self.arq_client.enqueue_postprocess(task_id)
            state.phase = ETLPhase.POSTPROCESS
            state.status = ETLTaskStatus.LLM_PROCESSING
            state.progress = 60
            state.arq_job_id_postprocess = job_id
            state.error_message = None
            state.error_stage = None
            state.artifact_mineru_markdown_key = md_key
            await self.state_repo.set(state)
        elif from_stage == "mineru":
            job_id = await self.arq_client.enqueue_ocr(task_id)
            state.phase = ETLPhase.OCR
            state.status = ETLTaskStatus.PENDING
            state.progress = 0
            state.arq_job_id_ocr = job_id
            state.arq_job_id_postprocess = None
            state.artifact_mineru_markdown_key = None
            state.provider_task_id = None
            state.error_message = None
            state.error_stage = None
            await self.state_repo.set(state)
        else:
            raise ValueError("from_stage must be 'mineru' or 'postprocess'")

        # Mark DB status back to pending for visibility (best effort)
        task.status = ETLTaskStatus.PENDING
        task.error = None
        self.task_repository.update_task(task)
        return task

    def get_queue_size(self) -> int:
        """Queue is managed by ARQ; API does not track it."""
        return 0

    def get_task_count(self) -> int:
        """Task count is stored in DB; API does not track it."""
        return 0
