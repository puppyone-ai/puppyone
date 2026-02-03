"""
Import Jobs - ARQ job functions for all import types.
"""

from typing import Any

from src.import_.task.manager import ImportTaskManager
from src.import_.task.models import ImportTask, ImportTaskType
from src.import_.handlers.base import ProgressCallback
from src.import_.handlers.github_handler import GithubHandler
from src.import_.handlers.notion_handler import NotionHandler
from src.import_.handlers.url_handler import UrlHandler
from src.import_.handlers.file_handler import FileHandler
from src.import_.handlers.gmail_handler import GmailHandler
from src.import_.handlers.google_drive_handler import GoogleDriveHandler
from src.import_.handlers.google_calendar_handler import GoogleCalendarHandler
from src.import_.handlers.google_sheets_handler import GoogleSheetsHandler
from src.import_.handlers.google_docs_handler import GoogleDocsHandler
from src.import_.handlers.airtable_handler import AirtableHandler
from src.import_.handlers.linear_handler import LinearHandler
from src.content_node.service import ContentNodeService
from src.oauth.github_service import GithubOAuthService
from src.oauth.notion_service import NotionOAuthService
from src.oauth.gmail_service import GmailOAuthService
from src.oauth.google_drive_service import GoogleDriveOAuthService
from src.oauth.google_calendar_service import GoogleCalendarOAuthService
from src.oauth.google_sheets_service import GoogleSheetsOAuthService
from src.oauth.google_docs_service import GoogleDocsOAuthService
from src.oauth.airtable_service import AirtableOAuthService
from src.oauth.linear_service import LinearOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_info, log_error


async def import_job(ctx: dict[str, Any], task_id: str) -> dict[str, Any]:
    """
    Unified import job - routes to appropriate handler based on task type.
    
    Args:
        ctx: ARQ context with initialized services
        task_id: Import task ID
        
    Returns:
        Result dict with status and details
    """
    # Get services from context
    task_manager: ImportTaskManager = ctx["task_manager"]
    node_service: ContentNodeService = ctx["node_service"]
    s3_service: S3Service = ctx["s3_service"]
    
    # OAuth services
    github_service: GithubOAuthService = ctx["github_service"]
    notion_service: NotionOAuthService = ctx["notion_service"]
    gmail_service: GmailOAuthService = ctx["gmail_service"]
    drive_service: GoogleDriveOAuthService = ctx["drive_service"]
    calendar_service: GoogleCalendarOAuthService = ctx["calendar_service"]
    sheets_service: GoogleSheetsOAuthService = ctx["sheets_service"]
    docs_service: GoogleDocsOAuthService = ctx["docs_service"]
    airtable_service: AirtableOAuthService = ctx["airtable_service"]
    linear_service: LinearOAuthService = ctx["linear_service"]

    # Load task
    task = await task_manager.get_task(task_id)
    if not task:
        log_error(f"Import job: task not found: {task_id}")
        return {"ok": False, "error": "task_not_found"}

    # Check if already cancelled
    if task.status.is_terminal():
        log_info(f"Import job: task already terminal: {task_id} ({task.status})")
        return {"ok": True, "skipped": task.status.value}

    # Mark as processing
    await task_manager.mark_processing(task_id, "Starting import...")

    # Create progress callback
    async def on_progress(progress: int, message: str) -> None:
        await task_manager.update_progress(task_id, progress, message)

    try:
        # Get handler based on task type
        handler = _get_handler(
            task.task_type,
            node_service=node_service,
            s3_service=s3_service,
            github_service=github_service,
            notion_service=notion_service,
            gmail_service=gmail_service,
            drive_service=drive_service,
            calendar_service=calendar_service,
            sheets_service=sheets_service,
            docs_service=docs_service,
            airtable_service=airtable_service,
            linear_service=linear_service,
        )

        if not handler:
            raise ValueError(f"No handler for task type: {task.task_type}")

        # Process
        result = await handler.process(task, on_progress)

        # Mark completed
        await task_manager.mark_completed(
            task_id,
            content_node_id=result.content_node_id,
            items_count=result.items_count,
        )

        log_info(f"Import job completed: {task_id}, node={result.content_node_id}")

        return {
            "ok": True,
            "task_id": task_id,
            "content_node_id": result.content_node_id,
            "items_count": result.items_count,
        }

    except Exception as e:
        error_msg = str(e)
        log_error(f"Import job failed: {task_id} - {error_msg}")

        await task_manager.mark_failed(task_id, error_msg)

        return {"ok": False, "task_id": task_id, "error": error_msg}


def _get_handler(
    task_type: ImportTaskType,
    node_service: ContentNodeService,
    s3_service: S3Service,
    github_service: GithubOAuthService,
    notion_service: NotionOAuthService,
    gmail_service: GmailOAuthService,
    drive_service: GoogleDriveOAuthService,
    calendar_service: GoogleCalendarOAuthService,
    sheets_service: GoogleSheetsOAuthService,
    docs_service: GoogleDocsOAuthService,
    airtable_service: AirtableOAuthService,
    linear_service: LinearOAuthService,
):
    """Get the appropriate handler for a task type."""
    
    if task_type == ImportTaskType.GITHUB:
        return GithubHandler(
            node_service=node_service,
            github_service=github_service,
            s3_service=s3_service,
        )
    
    if task_type in (ImportTaskType.NOTION, ImportTaskType.NOTION_DATABASE):
        return NotionHandler(
            node_service=node_service,
            s3_service=s3_service,
            notion_service=notion_service,
        )
    
    if task_type == ImportTaskType.GMAIL:
        return GmailHandler(
            node_service=node_service,
            gmail_service=gmail_service,
            s3_service=s3_service,
        )
    
    if task_type == ImportTaskType.GOOGLE_DRIVE:
        return GoogleDriveHandler(
            node_service=node_service,
            drive_service=drive_service,
            s3_service=s3_service,
        )
    
    if task_type == ImportTaskType.GOOGLE_CALENDAR:
        return GoogleCalendarHandler(
            node_service=node_service,
            calendar_service=calendar_service,
            s3_service=s3_service,
        )
    
    if task_type == ImportTaskType.GOOGLE_SHEETS:
        return GoogleSheetsHandler(
            node_service=node_service,
            sheets_service=sheets_service,
            s3_service=s3_service,
        )
    
    if task_type == ImportTaskType.GOOGLE_DOCS:
        return GoogleDocsHandler(
            node_service=node_service,
            docs_service=docs_service,
            s3_service=s3_service,
        )
    
    if task_type == ImportTaskType.AIRTABLE:
        return AirtableHandler(
            node_service=node_service,
            airtable_service=airtable_service,
            s3_service=s3_service,
        )
    
    if task_type == ImportTaskType.LINEAR:
        return LinearHandler(
            node_service=node_service,
            linear_service=linear_service,
            s3_service=s3_service,
        )
    
    if task_type == ImportTaskType.URL:
        return UrlHandler(
            node_service=node_service,
        )
    
    if task_type == ImportTaskType.FILE:
        return FileHandler(
            node_service=node_service,
            s3_service=s3_service,
        )
    
    return None
