"""
Import Jobs - ARQ job functions for all import types.

Routes tasks to the appropriate connector based on task type.
"""

from typing import Any

from src.sync.task.manager import ImportTaskManager
from src.sync.task.models import ImportTask, ImportTaskType
from src.sync.connectors._base import ProgressCallback

# Connectors
from src.sync.connectors.github.connector import GithubConnector
from src.sync.connectors.notion.connector import NotionConnector
from src.sync.connectors.url.connector import UrlConnector
from src.sync.connectors.gmail.connector import GmailConnector
from src.sync.connectors.google_drive.connector import GoogleDriveConnector
from src.sync.connectors.google_calendar.connector import GoogleCalendarConnector
from src.sync.connectors.google_sheets.connector import GoogleSheetsConnector
from src.sync.connectors.google_docs.connector import GoogleDocsConnector
from src.sync.connectors.airtable.connector import AirtableConnector
from src.sync.connectors.linear.connector import LinearConnector

# OAuth services
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
    Unified import job - routes to appropriate connector based on task type.
    """
    task_manager: ImportTaskManager = ctx["task_manager"]
    node_service: ContentNodeService = ctx["node_service"]
    s3_service: S3Service = ctx["s3_service"]

    github_service: GithubOAuthService = ctx["github_service"]
    notion_service: NotionOAuthService = ctx["notion_service"]
    gmail_service: GmailOAuthService = ctx["gmail_service"]
    drive_service: GoogleDriveOAuthService = ctx["drive_service"]
    calendar_service: GoogleCalendarOAuthService = ctx["calendar_service"]
    sheets_service: GoogleSheetsOAuthService = ctx["sheets_service"]
    docs_service: GoogleDocsOAuthService = ctx["docs_service"]
    airtable_service: AirtableOAuthService = ctx["airtable_service"]
    linear_service: LinearOAuthService = ctx["linear_service"]

    task = await task_manager.get_task(task_id)
    if not task:
        log_error(f"Import job: task not found: {task_id}")
        return {"ok": False, "error": "task_not_found"}

    if task.status.is_terminal():
        log_info(f"Import job: task already terminal: {task_id} ({task.status})")
        return {"ok": True, "skipped": task.status.value}

    if task.task_type == ImportTaskType.FILE:
        error_msg = (
            "ImportTaskType.FILE is not supported in SaaS import worker. "
            "Use /api/v1/ingest/submit/file for file ingestion."
        )
        log_error(f"Import job failed: {task_id} - {error_msg}")
        await task_manager.mark_failed(task_id, error_msg)
        return {
            "ok": False,
            "task_id": task_id,
            "error": error_msg,
            "error_code": "unsupported_task_type",
        }

    await task_manager.mark_processing(task_id, "Starting import...")

    async def on_progress(progress: int, message: str) -> None:
        await task_manager.update_progress(task_id, progress, message)

    try:
        connector = _get_connector(
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

        if not connector:
            raise ValueError(f"No connector for task type: {task.task_type}")

        result = await connector.import_data(task, on_progress)

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


def _get_connector(
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
    """Get the appropriate connector for a task type."""

    if task_type == ImportTaskType.GITHUB:
        return GithubConnector(
            node_service=node_service,
            github_service=github_service,
            s3_service=s3_service,
        )

    if task_type in (ImportTaskType.NOTION, ImportTaskType.NOTION_DATABASE):
        return NotionConnector(
            node_service=node_service,
            s3_service=s3_service,
            notion_service=notion_service,
        )

    if task_type == ImportTaskType.GMAIL:
        return GmailConnector(
            node_service=node_service,
            gmail_service=gmail_service,
            s3_service=s3_service,
        )

    if task_type == ImportTaskType.GOOGLE_DRIVE:
        return GoogleDriveConnector(
            node_service=node_service,
            drive_service=drive_service,
            s3_service=s3_service,
        )

    if task_type == ImportTaskType.GOOGLE_CALENDAR:
        return GoogleCalendarConnector(
            node_service=node_service,
            calendar_service=calendar_service,
            s3_service=s3_service,
        )

    if task_type == ImportTaskType.GOOGLE_SHEETS:
        return GoogleSheetsConnector(
            node_service=node_service,
            sheets_service=sheets_service,
            s3_service=s3_service,
        )

    if task_type == ImportTaskType.GOOGLE_DOCS:
        return GoogleDocsConnector(
            node_service=node_service,
            docs_service=docs_service,
            s3_service=s3_service,
        )

    if task_type == ImportTaskType.AIRTABLE:
        return AirtableConnector(
            node_service=node_service,
            airtable_service=airtable_service,
            s3_service=s3_service,
        )

    if task_type == ImportTaskType.LINEAR:
        return LinearConnector(
            node_service=node_service,
            linear_service=linear_service,
            s3_service=s3_service,
        )

    if task_type == ImportTaskType.URL:
        return UrlConnector(
            node_service=node_service,
        )

    return None
