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
from src.content_node.service import ContentNodeService
from src.oauth.github_service import GithubOAuthService
from src.oauth.notion_service import NotionOAuthService
from src.oauth.gmail_service import GmailOAuthService
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
    github_service: GithubOAuthService = ctx["github_service"]
    notion_service: NotionOAuthService = ctx["notion_service"]
    gmail_service: GmailOAuthService = ctx["gmail_service"]

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
    
    if task_type == ImportTaskType.URL:
        return UrlHandler(
            node_service=node_service,
        )
    
    if task_type == ImportTaskType.FILE:
        return FileHandler(
            node_service=node_service,
            s3_service=s3_service,
        )
    
    # TODO: Add more handlers as implemented
    # ImportTaskType.AIRTABLE
    # ImportTaskType.GOOGLE_SHEETS
    # ImportTaskType.LINEAR
    # ImportTaskType.GOOGLE_DRIVE
    # ImportTaskType.GOOGLE_CALENDAR
    
    return None
