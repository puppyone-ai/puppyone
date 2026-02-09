"""
Ingest Gateway Service - Unified entry point, routes to file or SaaS services.
"""

import asyncio
import logging
from typing import Optional

from fastapi import UploadFile

from src.ingest.schemas import (
    SourceType,
    IngestType,
    IngestStatus,
    IngestMode,
    IngestSubmitItem,
    IngestTaskResponse,
)
from src.ingest.shared.task.normalizers import (
    normalize_file_task,
    normalize_saas_task,
    detect_file_ingest_type,
)

logger = logging.getLogger(__name__)


class IngestService:
    """Unified data ingest service - routes to underlying services based on source_type."""
    
    def __init__(
        self,
        file_service,  # FileIngestService (ETLService)
        saas_service,  # SaaSIngestService (ImportService)
    ):
        self.file_service = file_service
        self.saas_service = saas_service
    
    async def submit_file(
        self,
        *,
        user_id: str,
        project_id: str,
        files: list[UploadFile],
        mode: IngestMode = IngestMode.SMART,
        rule_id: Optional[int] = None,
        node_id: Optional[str] = None,
        json_path: Optional[str] = None,
        s3_service=None,
        node_service=None,
        project_service=None,
    ) -> list[IngestSubmitItem]:
        """
        Submit file ingest tasks → File Worker.
        
        This delegates to the underlying ETL service.
        """
        # Import here to avoid circular imports
        from src.ingest.file.service import ETLService
        
        if not isinstance(self.file_service, ETLService):
            raise ValueError("file_service must be ETLService")
        
        items = []
        
        # For now, we delegate directly to the ETL router logic
        # The actual file upload and task creation is complex,
        # so we'll call the existing service methods
        
        for f in files:
            try:
                filename = f.filename or "file"
                ingest_type = detect_file_ingest_type(filename)
                
                # Note: The actual S3 upload and task submission 
                # should be handled by the router layer for now,
                # as it involves FormData processing
                
                items.append(IngestSubmitItem(
                    task_id="",  # Will be set by router
                    source_type=SourceType.FILE,
                    ingest_type=ingest_type,
                    status=IngestStatus.PENDING,
                    filename=filename,
                ))
                
            except Exception as e:
                logger.error(f"Failed to prepare file {f.filename}: {e}")
                items.append(IngestSubmitItem(
                    task_id="",
                    source_type=SourceType.FILE,
                    ingest_type=IngestType.DOCUMENT,
                    status=IngestStatus.FAILED,
                    filename=f.filename,
                    error=str(e),
                ))
        
        return items
    
    async def submit_saas(
        self,
        *,
        user_id: str,
        project_id: str,
        url: str,
        name: Optional[str] = None,
        crawl_options: Optional[dict] = None,
        sync_config: Optional[dict] = None,
    ) -> IngestSubmitItem:
        """
        Submit SaaS/URL ingest task → SaaS Worker.
        """
        try:
            task = await self.saas_service.submit(
                user_id=user_id,
                project_id=project_id,
                url=url,
                name=name,
                crawl_options=crawl_options,
                sync_config=sync_config,
            )
            
            # Detect source and ingest type
            source_type = self._detect_source_type(url)
            ingest_type = self._detect_saas_type(task.task_type)
            
            return IngestSubmitItem(
                task_id=task.id or "",
                source_type=source_type,
                ingest_type=ingest_type,
                status=IngestStatus(task.status.value),
            )
            
        except Exception as e:
            logger.error(f"Failed to submit SaaS import: {e}")
            raise
    
    async def get_task(
        self,
        task_id: str,
        source_type: SourceType,
        user_id: str,
    ) -> Optional[IngestTaskResponse]:
        """
        Get task status - routes to appropriate service based on source_type.
        """
        if source_type == SourceType.FILE:
            task = await self.file_service.get_task_status_with_access_check(
                task_id=int(task_id),
                user_id=user_id,
            )
            return normalize_file_task(task) if task else None
        else:
            task = await self.saas_service.get_task(task_id)
            if task and task.user_id == user_id:
                return normalize_saas_task(task)
            return None
    
    async def batch_get_tasks(
        self,
        tasks: list[dict],  # [{"task_id": "...", "source_type": "..."}]
        user_id: str,
    ) -> list[IngestTaskResponse]:
        """
        Batch query - groups by source_type and queries in parallel.
        """
        file_tasks = [t for t in tasks if t["source_type"] == SourceType.FILE.value]
        saas_tasks = [t for t in tasks if t["source_type"] != SourceType.FILE.value]
        
        results = []
        
        # Parallel query
        if file_tasks:
            file_results = await asyncio.gather(*[
                self.get_task(t["task_id"], SourceType.FILE, user_id)
                for t in file_tasks
            ], return_exceptions=True)
            results.extend([r for r in file_results if r and not isinstance(r, Exception)])
        
        if saas_tasks:
            saas_results = await asyncio.gather(*[
                self.get_task(t["task_id"], SourceType(t["source_type"]), user_id)
                for t in saas_tasks
            ], return_exceptions=True)
            results.extend([r for r in saas_results if r and not isinstance(r, Exception)])
        
        return results
    
    async def cancel_task(
        self,
        task_id: str,
        source_type: SourceType,
        user_id: str,
    ) -> bool:
        """Cancel a task."""
        try:
            if source_type == SourceType.FILE:
                task = await self.file_service.cancel_task(
                    task_id=int(task_id),
                    user_id=user_id,
                )
                return task is not None
            else:
                return await self.saas_service.cancel_task(task_id, "Cancelled by user")
        except Exception as e:
            logger.error(f"Failed to cancel task {task_id}: {e}")
            return False
    
    # === Helper Methods ===
    
    def _detect_source_type(self, url: str) -> SourceType:
        """Detect source type from URL."""
        url_lower = url.lower()
        saas_domains = [
            "github.com", "notion.so", "airtable.com",
            "docs.google.com", "drive.google.com", "sheets.google.com",
            "calendar.google.com", "mail.google.com",
            "linear.app",
        ]
        for domain in saas_domains:
            if domain in url_lower:
                return SourceType.SAAS
        return SourceType.URL
    
    def _detect_saas_type(self, task_type) -> IngestType:
        """Map ImportTaskType → IngestType."""
        mapping = {
            "github_repo": IngestType.GITHUB,
            "notion_page": IngestType.NOTION,
            "notion_database": IngestType.NOTION,
            "gmail": IngestType.GMAIL,
            "google_drive": IngestType.GOOGLE_DRIVE,
            "google_sheet": IngestType.GOOGLE_SHEETS,
            "google_docs": IngestType.GOOGLE_DOCS,
            "google_calendar": IngestType.GOOGLE_CALENDAR,
            "airtable_base": IngestType.AIRTABLE,
            "linear_project": IngestType.LINEAR,
            "url": IngestType.WEB_PAGE,
        }
        return mapping.get(task_type.value, IngestType.WEB_PAGE)



