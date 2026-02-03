"""
Import Service - Business logic for import operations.

This is the API orchestration layer:
- Creates tasks and enqueues ARQ jobs
- Queries task status
- Provides preview functionality (without creating tasks)

Note: Core business logic lives in handlers/, not here.
"""

from typing import Optional
from urllib.parse import urlparse

from arq import ArqRedis

from src.import_.schemas import ImportType, ImportStatus
from src.import_.task.manager import ImportTaskManager
from src.import_.task.models import ImportTask, ImportTaskType
from src.import_.handlers.base import PreviewResult
from src.import_.utils.url_parser import detect_import_type
from src.utils.logger import log_info, log_error


class ImportService:
    """
    Unified import service.
    
    Handles task creation and enqueuing to ARQ.
    """

    QUEUE_NAME = "import:queue"

    def __init__(
        self,
        task_manager: ImportTaskManager,
        arq_pool: ArqRedis,
    ):
        self.task_manager = task_manager
        self.arq = arq_pool

    async def submit(
        self,
        user_id: str,
        project_id: str,
        url: Optional[str] = None,
        file_key: Optional[str] = None,
        name: Optional[str] = None,
        etl_rule_id: Optional[int] = None,
        crawl_options: Optional[dict] = None,
        sync_config: Optional[dict] = None,
    ) -> ImportTask:
        """
        Submit a new import task.
        
        Args:
            user_id: User ID
            project_id: Target project ID
            url: Source URL (for URL/SaaS imports)
            file_key: S3 key (for file ETL)
            name: Optional name for the content
            etl_rule_id: ETL rule ID (for file imports)
            crawl_options: Firecrawl options (for URL imports)
            sync_config: Sync settings to store in content_node.sync_config
            
        Returns:
            Created ImportTask
        """
        # Detect import type
        task_type = self._detect_type(url, file_key)
        
        # Build config (includes sync_config for handlers to use)
        config = {}
        if name:
            config["name"] = name
        if etl_rule_id:
            config["etl_rule_id"] = etl_rule_id
        if crawl_options:
            config["crawl_options"] = crawl_options
        if sync_config:
            config.update(sync_config)  # Flatten sync_config into config

        # Create task
        task = await self.task_manager.create_task(
            user_id=user_id,
            project_id=project_id,
            task_type=task_type,
            source_url=url,
            source_file_key=file_key,
            config=config,
        )

        log_info(f"Created import task: {task.id} ({task_type.value})")

        # Enqueue to ARQ
        job = await self.arq.enqueue_job(
            "import_job",
            task.id,
            _queue_name=self.QUEUE_NAME,
        )

        log_info(f"Enqueued import job: {job.job_id} for task {task.id}")

        return task

    async def get_task(self, task_id: str) -> Optional[ImportTask]:
        """Get task by ID."""
        return await self.task_manager.get_task(task_id)

    async def get_user_tasks(
        self,
        user_id: str,
        project_id: Optional[str] = None,
        limit: int = 50,
    ) -> list[ImportTask]:
        """Get tasks for a user."""
        return await self.task_manager.get_user_tasks(user_id, project_id, limit)

    async def cancel_task(self, task_id: str, reason: Optional[str] = None) -> bool:
        """Cancel a task."""
        task = await self.task_manager.get_task(task_id)
        if not task:
            return False
        
        if task.status.is_terminal():
            return False
        
        await self.task_manager.mark_cancelled(task_id, reason)
        return True

    def _detect_type(
        self,
        url: Optional[str],
        file_key: Optional[str],
    ) -> ImportTaskType:
        """Detect import type from inputs."""
        
        if file_key:
            return ImportTaskType.FILE
        
        if not url:
            raise ValueError("Either url or file_key is required")
        
        parsed = urlparse(url)
        scheme = parsed.scheme.lower()
        host = parsed.netloc.lower()
        
        # OAuth-based imports (oauth://gmail, oauth://drive, oauth://calendar)
        if scheme == "oauth":
            oauth_type = host or parsed.path.strip("/")
            if oauth_type == "gmail":
                return ImportTaskType.GMAIL
            elif oauth_type in ("drive", "google-drive"):
                return ImportTaskType.GOOGLE_DRIVE
            elif oauth_type in ("calendar", "google-calendar"):
                return ImportTaskType.GOOGLE_CALENDAR
        
        # GitHub
        if host in ("github.com", "www.github.com"):
            return ImportTaskType.GITHUB
        
        # Notion
        if host in ("notion.so", "www.notion.so") or "notion.site" in host:
            return ImportTaskType.NOTION
        
        # Airtable
        if "airtable.com" in host:
            return ImportTaskType.AIRTABLE
        
        # Google Sheets
        if "docs.google.com" in host and "/spreadsheets/" in url:
            return ImportTaskType.GOOGLE_SHEETS
        
        # Google Docs
        if "docs.google.com" in host and "/document/" in url:
            return ImportTaskType.GOOGLE_DOCS
        
        # Linear
        if "linear.app" in host:
            return ImportTaskType.LINEAR
        
        # Default: generic URL
        return ImportTaskType.URL

    async def preview_url(
        self,
        url: str,
        user_id: str,
        crawl_options: Optional[dict] = None,
    ) -> tuple[PreviewResult, ImportType]:
        """
        Preview a URL without creating a task.
        
        This allows users to see what will be imported before submitting.
        
        Args:
            url: URL to preview
            user_id: User ID (needed for OAuth-based sources)
            crawl_options: Optional Firecrawl options for URL crawling
            
        Returns:
            Tuple of (PreviewResult, ImportType)
        """
        task_type = detect_import_type(url)
        import_type = self.task_type_to_import_type(task_type)
        
        handler = self._get_preview_handler(task_type)
        
        # Call preview with appropriate signature
        if task_type == ImportTaskType.URL:
            result = await handler.preview(url, user_id, crawl_options)
        else:
            result = await handler.preview(url, user_id)
        
        # Cleanup if needed
        if hasattr(handler, 'close'):
            await handler.close()
        
        return result, import_type

    def _get_preview_handler(self, task_type: ImportTaskType):
        """
        Get handler instance for preview.
        
        Note: For preview, we don't need node_service or s3_service,
        so we pass None for those dependencies.
        """
        from src.import_.handlers.github_handler import GithubHandler
        from src.import_.handlers.notion_handler import NotionHandler
        from src.import_.handlers.url_handler import UrlHandler
        from src.oauth.github_service import GithubOAuthService
        
        if task_type == ImportTaskType.GITHUB:
            return GithubHandler(
                node_service=None,
                github_service=GithubOAuthService(),
                s3_service=None,
            )
        
        if task_type in (ImportTaskType.NOTION, ImportTaskType.NOTION_DATABASE):
            return NotionHandler(
                node_service=None,
                s3_service=None,
            )
        
        # Default: URL handler (Firecrawl)
        return UrlHandler(node_service=None)

    @staticmethod
    def task_type_to_import_type(task_type: ImportTaskType) -> ImportType:
        """Convert task type to API import type."""
        mapping = {
            ImportTaskType.GITHUB: ImportType.GITHUB,
            ImportTaskType.NOTION: ImportType.NOTION,
            ImportTaskType.NOTION_DATABASE: ImportType.NOTION,
            ImportTaskType.AIRTABLE: ImportType.AIRTABLE,
            ImportTaskType.GOOGLE_SHEETS: ImportType.GOOGLE_SHEETS,
            ImportTaskType.LINEAR: ImportType.LINEAR,
            ImportTaskType.URL: ImportType.URL,
            ImportTaskType.FILE: ImportType.FILE,
        }
        return mapping.get(task_type, ImportType.URL)

