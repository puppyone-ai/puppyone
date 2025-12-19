"""
ETL Service

Core ETL service for processing documents through MineRU and LLM transformation.
"""

import json
import logging
import time
from typing import Optional

from src.etl.config import etl_config
from src.etl.exceptions import (
    ETLTransformationError,
    RuleNotFoundError,
)
from src.exceptions import NotFoundException, ErrorCode
from src.etl.mineru.client import MineRUClient
from src.etl.mineru.schemas import MineRUModelVersion
from src.etl.rules.engine import RuleEngine
from src.etl.rules.repository_supabase import RuleRepositorySupabase
from src.etl.tasks.models import ETLTask, ETLTaskResult, ETLTaskStatus
from src.etl.tasks.queue import ETLQueue
from src.etl.tasks.repository import ETLTaskRepositoryBase
from src.llm.service import LLMService
from src.s3.service import S3Service
from src.supabase.dependencies import get_supabase_client

logger = logging.getLogger(__name__)


class ETLService:
    """Core ETL service for document processing."""

    def __init__(
        self,
        s3_service: S3Service,
        llm_service: LLMService,
        mineru_client: MineRUClient,
        task_repository: ETLTaskRepositoryBase,
    ):
        """
        Initialize ETL service.

        Args:
            s3_service: S3 service for file operations
            llm_service: LLM service for transformations
            mineru_client: MineRU client for document parsing
            task_repository: Repository for ETL tasks
        """
        self.s3_service = s3_service
        self.llm_service = llm_service
        self.mineru_client = mineru_client
        self.task_repository = task_repository
        self.rule_engine = RuleEngine(llm_service)

        # Initialize task queue
        self.queue = ETLQueue(
            task_repository=task_repository,
            max_size=etl_config.etl_queue_size,
            worker_count=etl_config.etl_worker_count,
        )

        # Set executor for task processing
        self.queue.set_executor(self._execute_etl_task)

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
        """Start ETL service workers and resume pending tasks."""
        await self.queue.start_workers()
        
        # Resume pending tasks from database
        try:
            pending_tasks = self.task_repository.list_tasks(status=ETLTaskStatus.PENDING)
            if pending_tasks:
                logger.info(f"Found {len(pending_tasks)} pending tasks, resuming...")
                for task in pending_tasks:
                    try:
                        # Add to memory cache
                        self.queue.tasks[task.task_id] = task
                        # Add to queue (task already exists in DB, so don't call submit())
                        await self.queue.queue.put(task.task_id)
                        logger.info(f"Resumed task {task.task_id}: {task.filename}")
                    except Exception as e:
                        logger.error(f"Failed to resume task {task.task_id}: {e}")
            else:
                logger.info("No pending tasks to resume")
        except Exception as e:
            logger.error(f"Failed to resume pending tasks: {e}")
        
        logger.info("ETL service started")

    async def stop(self):
        """Stop ETL service workers gracefully."""
        await self.queue.stop_workers()
        logger.info("ETL service stopped")

    async def submit_etl_task(
        self,
        user_id: str,
        project_id: int,
        filename: str,
        rule_id: int,
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
            rule_id=rule_id,
        )

        # Submit to queue (this will create in DB and assign ID)
        task_with_id = await self.queue.submit(task)

        logger.info(
            f"ETL task submitted: task_id={task_with_id.task_id}, "
            f"user_id={user_id}, filename={filename}, rule_id={rule_id}"
        )

        return task_with_id

    async def _execute_etl_task(self, task: ETLTask):
        """
        Execute an ETL task (called by queue worker).

        Args:
            task: ETL task to execute
        """
        start_time = time.time()

        try:
            logger.info(f"Starting ETL task {task.task_id}")

            # Step 1: Get S3 presigned URL for source file
            task.update_status(ETLTaskStatus.MINERU_PARSING, progress=10)
            
            # Use s3_key from metadata if available (for files with special characters)
            # Otherwise construct from filename (backward compatibility)
            if "s3_key" in task.metadata:
                source_key = task.metadata["s3_key"]
                logger.info(f"Task {task.task_id}: Using s3_key from metadata: {source_key}")
            else:
                source_key = f"users/{task.user_id}/raw/{task.project_id}/{task.filename}"
                logger.info(f"Task {task.task_id}: Constructed s3_key from filename: {source_key}")

            presigned_url = await self.s3_service.generate_presigned_download_url(
                key=source_key,
                expires_in=3600,  # 1 hour
            )
            logger.info(f"Task {task.task_id}: Generated presigned URL")

            # Step 2: Submit to MineRU for parsing
            task.update_status(ETLTaskStatus.MINERU_PARSING, progress=20)
            parsed_result = await self.mineru_client.parse_document(
                file_url=presigned_url,
                model_version=MineRUModelVersion.VLM,
                data_id=str(task.task_id),
            )

            logger.info(
                f"Task {task.task_id}: MineRU parsing completed, "
                f"task_id={parsed_result.task_id}"
            )
            task.metadata["mineru_task_id"] = parsed_result.task_id

            # Step 3: Load ETL rule
            task.update_status(ETLTaskStatus.LLM_PROCESSING, progress=60)
            rule_repository = self._get_rule_repository(task.user_id)
            rule = rule_repository.get_rule(str(task.rule_id))
            if not rule:
                raise RuleNotFoundError(str(task.rule_id))

            logger.info(f"Task {task.task_id}: Applying rule '{rule.name}'")

            # Step 4: Apply transformation rule
            transformation_result = await self.rule_engine.apply_rule(
                markdown_content=parsed_result.markdown_content,
                rule=rule,
            )

            if not transformation_result.success:
                raise ETLTransformationError(
                    transformation_result.error or "Unknown error",
                    task.rule_id,
                )

            logger.info(f"Task {task.task_id}: Transformation successful")
            task.update_status(ETLTaskStatus.LLM_PROCESSING, progress=80)

            # Step 5: Upload result to S3
            # Extract UUID from source s3_key to use for output filename (avoid non-ASCII chars)
            source_s3_key = task.metadata.get("s3_key", "")
            if source_s3_key:
                # Extract UUID from path like "users/.../raw/2/uuid.pdf"
                import os
                source_basename = os.path.basename(source_s3_key)  # "uuid.pdf"
                uuid_filename = os.path.splitext(source_basename)[0]  # "uuid"
                output_filename = f"{uuid_filename}.json"
            else:
                # Fallback: generate new UUID if s3_key not found
                import uuid
                output_filename = f"{uuid.uuid4()}.json"
            
            output_key = f"users/{task.user_id}/processed/{task.project_id}/{output_filename}"
            output_json = json.dumps(
                transformation_result.output,
                indent=2,
                ensure_ascii=False,
            )
            output_bytes = output_json.encode("utf-8")

            # Base64 encode filename for S3 metadata (only ASCII allowed)
            import base64
            source_filename_b64 = base64.b64encode(task.filename.encode('utf-8')).decode('ascii')
            
            upload_response = await self.s3_service.upload_file(
                key=output_key,
                content=output_bytes,
                content_type="application/json",
                metadata={
                    "task_id": str(task.task_id),
                    "rule_id": str(task.rule_id),
                    "source_filename_b64": source_filename_b64,
                },
            )

            logger.info(
                f"Task {task.task_id}: Uploaded result to {output_key}, "
                f"size={len(output_bytes)} bytes"
            )

            # Step 6: Mark task as completed
            processing_time = time.time() - start_time
            result = ETLTaskResult(
                output_path=output_key,
                output_size=len(output_bytes),
                processing_time=processing_time,
                mineru_task_id=parsed_result.task_id,
            )

            task.mark_completed(result)

            logger.info(
                f"Task {task.task_id} completed successfully in "
                f"{processing_time:.2f}s"
            )
            
            # Step 7: Call completion callback to update table data
            try:
                from src.etl.callbacks import handle_etl_task_completion
                from src.supabase.tables.repository import TableRepository
                from src.supabase.dependencies import get_supabase_client
                
                # Check if this task has table_id in metadata
                if "table_id" in task.metadata:
                    table_id = task.metadata["table_id"]
                    logger.info(f"Task {task.task_id}: Calling completion callback for table {table_id}")
                    
                    # Initialize table repository
                    supabase_client = get_supabase_client()
                    table_repository = TableRepository(client=supabase_client)
                    
                    # Call callback
                    success = await handle_etl_task_completion(
                        task=task,
                        s3_service=self.s3_service,
                        table_repository=table_repository
                    )
                    
                    if success:
                        logger.info(f"Task {task.task_id}: Table {table_id} updated successfully")
                    else:
                        logger.warning(f"Task {task.task_id}: Failed to update table {table_id}")
                else:
                    logger.debug(f"Task {task.task_id}: No table_id in metadata, skipping callback")
            except Exception as callback_error:
                # Don't fail the task if callback fails
                logger.error(
                    f"Task {task.task_id}: Callback failed: {callback_error}",
                    exc_info=True
                )

        except Exception as e:
            logger.error(
                f"Task {task.task_id} failed: {e}",
                exc_info=True,
            )
            task.mark_failed(str(e))

    async def get_task_status(self, task_id: int) -> Optional[ETLTask]:
        """
        Get ETL task status.

        Args:
            task_id: Task ID

        Returns:
            ETLTask if found, None otherwise
        """
        return self.queue.get_task(task_id)

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
        return self.queue.list_tasks(user_id, project_id, status)

    def get_queue_size(self) -> int:
        """Get current queue size."""
        return self.queue.queue_size()

    def get_task_count(self) -> int:
        """Get total number of tasks."""
        return self.queue.task_count()

