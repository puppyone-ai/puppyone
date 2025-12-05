"""
ETL Service

Core ETL service for processing documents through MineRU and LLM transformation.
"""

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Optional

from src.etl.config import etl_config
from src.etl.exceptions import (
    ETLTaskTimeoutError,
    ETLTransformationError,
    FileNotFoundError,
    RuleNotFoundError,
)
from src.etl.mineru.client import MineRUClient
from src.etl.mineru.schemas import MineRUModelVersion
from src.etl.rules.engine import RuleEngine
from src.etl.rules.repository import RuleRepository
from src.etl.tasks.models import ETLTask, ETLTaskResult, ETLTaskStatus
from src.etl.tasks.queue import ETLQueue
from src.llm.service import LLMService
from src.s3.service import S3Service

logger = logging.getLogger(__name__)


class ETLService:
    """Core ETL service for document processing."""

    def __init__(
        self,
        s3_service: S3Service,
        llm_service: LLMService,
        mineru_client: MineRUClient,
        rule_repository: RuleRepository,
    ):
        """
        Initialize ETL service.

        Args:
            s3_service: S3 service for file operations
            llm_service: LLM service for transformations
            mineru_client: MineRU client for document parsing
            rule_repository: Repository for ETL rules
        """
        self.s3_service = s3_service
        self.llm_service = llm_service
        self.mineru_client = mineru_client
        self.rule_repository = rule_repository
        self.rule_engine = RuleEngine(llm_service)

        # Initialize task queue
        self.queue = ETLQueue(
            max_size=etl_config.etl_queue_size,
            worker_count=etl_config.etl_worker_count,
        )

        # Set executor for task processing
        self.queue.set_executor(self._execute_etl_task)

        logger.info("ETLService initialized")

    async def start(self):
        """Start ETL service workers."""
        await self.queue.start_workers()
        logger.info("ETL service started")

    async def stop(self):
        """Stop ETL service workers gracefully."""
        await self.queue.stop_workers()
        logger.info("ETL service stopped")

    async def submit_etl_task(
        self,
        user_id: str,
        project_id: str,
        filename: str,
        rule_id: str,
    ) -> ETLTask:
        """
        Submit an ETL task to the queue.

        Args:
            user_id: User ID
            project_id: Project ID
            filename: Source filename
            rule_id: Rule ID to apply

        Returns:
            Created ETL task

        Raises:
            RuleNotFoundError: If rule doesn't exist
        """
        # Validate rule exists
        rule = self.rule_repository.get_rule(rule_id)
        if not rule:
            logger.error(f"Rule not found: {rule_id}")
            raise RuleNotFoundError(rule_id)

        # Create task
        task_id = str(uuid.uuid4())
        task = ETLTask(
            task_id=task_id,
            user_id=user_id,
            project_id=project_id,
            filename=filename,
            rule_id=rule_id,
        )

        # Submit to queue
        await self.queue.submit(task)

        logger.info(
            f"ETL task submitted: task_id={task_id}, "
            f"user_id={user_id}, filename={filename}, rule_id={rule_id}"
        )

        return task

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
            source_key = f"users/{task.user_id}/raw/{task.project_id}/{task.filename}"

            presigned_url = await self.s3_service.generate_presigned_download_url(
                key=source_key,
                expires_in=3600,  # 1 hour
            )
            logger.info(f"Task {task.task_id}: Generated presigned URL for {source_key}")

            # Step 2: Submit to MineRU for parsing
            task.update_status(ETLTaskStatus.MINERU_PARSING, progress=20)
            parsed_result = await self.mineru_client.parse_document(
                file_url=presigned_url,
                model_version=MineRUModelVersion.VLM,
                data_id=task.task_id,
            )

            logger.info(
                f"Task {task.task_id}: MineRU parsing completed, "
                f"task_id={parsed_result.task_id}"
            )
            task.metadata["mineru_task_id"] = parsed_result.task_id

            # Step 3: Load ETL rule
            task.update_status(ETLTaskStatus.LLM_PROCESSING, progress=60)
            rule = self.rule_repository.get_rule(task.rule_id)
            if not rule:
                raise RuleNotFoundError(task.rule_id)

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
            output_key = f"users/{task.user_id}/processed/{task.project_id}/{task.filename}.json"
            output_json = json.dumps(
                transformation_result.output,
                indent=2,
                ensure_ascii=False,
            )
            output_bytes = output_json.encode("utf-8")

            upload_response = await self.s3_service.upload_file(
                key=output_key,
                content=output_bytes,
                content_type="application/json",
                metadata={
                    "task_id": task.task_id,
                    "rule_id": task.rule_id,
                    "source_filename": task.filename,
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

        except Exception as e:
            logger.error(
                f"Task {task.task_id} failed: {e}",
                exc_info=True,
            )
            task.mark_failed(str(e))

    async def get_task_status(self, task_id: str) -> Optional[ETLTask]:
        """
        Get ETL task status.

        Args:
            task_id: Task ID

        Returns:
            ETLTask if found, None otherwise
        """
        return self.queue.get_task(task_id)

    async def list_tasks(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[ETLTask]:
        """
        List ETL tasks with optional filters.

        Args:
            user_id: Filter by user ID
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

