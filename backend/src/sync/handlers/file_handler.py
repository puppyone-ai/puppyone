"""
File Handler - Process file ETL (PDF/images → Markdown → JSON).
"""

from src.content_node.service import ContentNodeService
from src.s3.service import S3Service
from src.sync.handlers.base import BaseHandler, ImportResult, ProgressCallback
from src.sync.task.models import ImportTask, ImportTaskType
from src.utils.logger import log_info


class FileHandler(BaseHandler):
    """Handler for file ETL imports."""

    def __init__(
        self,
        node_service: ContentNodeService,
        s3_service: S3Service,
        # mineru_client and rule_engine will be added
    ):
        self.node_service = node_service
        self.s3_service = s3_service

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.FILE

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process file ETL."""
        # TODO: Implement ETL logic
        # 1. Download file from S3 (task.source_file_key)
        # 2. Send to MineRU for OCR → Markdown
        # 3. Apply ETL rule (LLM) → JSON
        # 4. Create content node
        
        raise ValueError(
            "ImportTaskType.FILE is not supported in SaaS import handler. "
            "Use /api/v1/ingest/submit/file for file ingestion."
        )


