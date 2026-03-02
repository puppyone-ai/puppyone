"""
Ingest Gateway Service - Routes to file ETL service.

SaaS imports now go through Bootstrap + SyncEngine (sync module).
This service only handles file-related task queries.
"""

import asyncio
import logging
from typing import Optional

from fastapi import UploadFile

from src.upload.schemas import (
    SourceType,
    IngestType,
    IngestStatus,
    IngestMode,
    IngestSubmitItem,
    IngestTaskResponse,
)
from src.upload.shared.task.normalizers import (
    normalize_file_task,
    detect_file_ingest_type,
)

logger = logging.getLogger(__name__)


class IngestService:
    """File ingest service — routes to underlying ETL service."""

    def __init__(self, file_service):
        self.file_service = file_service

    async def get_task(
        self,
        task_id: str,
        source_type: SourceType,
        user_id: str,
    ) -> Optional[IngestTaskResponse]:
        """Get file task status."""
        if source_type != SourceType.FILE:
            return None

        task = await self.file_service.get_task_status_with_access_check(
            task_id=int(task_id),
            user_id=user_id,
        )
        return normalize_file_task(task) if task else None

    async def batch_get_tasks(
        self,
        tasks: list[dict],
        user_id: str,
    ) -> list[IngestTaskResponse]:
        """Batch query file tasks."""
        file_tasks = [t for t in tasks if t.get("source_type") == SourceType.FILE.value]

        results = []
        if file_tasks:
            file_results = await asyncio.gather(*[
                self.get_task(t["task_id"], SourceType.FILE, user_id)
                for t in file_tasks
            ], return_exceptions=True)
            results.extend([r for r in file_results if r and not isinstance(r, Exception)])

        return results

    async def cancel_task(
        self,
        task_id: str,
        source_type: SourceType,
        user_id: str,
    ) -> bool:
        """Cancel a file task."""
        if source_type != SourceType.FILE:
            return False
        try:
            task = await self.file_service.cancel_task(
                task_id=int(task_id),
                user_id=user_id,
            )
            return task is not None
        except Exception as e:
            logger.error(f"Failed to cancel task {task_id}: {e}")
            return False
