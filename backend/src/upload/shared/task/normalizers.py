"""
Normalizers - Convert ETL/Import tasks to unified format.
"""

from typing import Optional

from src.upload.schemas import (
    SourceType,
    IngestType,
    IngestStatus,
    IngestTaskResponse,
)
from src.upload.file.tasks.models import ETLTask, ETLTaskStatus
from src.sync.task.models import ImportTask, ImportTaskStatus


def normalize_file_status(status: ETLTaskStatus) -> IngestStatus:
    """ETL status → Unified status."""
    mapping = {
        ETLTaskStatus.PENDING: IngestStatus.PENDING,
        ETLTaskStatus.MINERU_PARSING: IngestStatus.PROCESSING,
        ETLTaskStatus.LLM_PROCESSING: IngestStatus.PROCESSING,
        ETLTaskStatus.COMPLETED: IngestStatus.COMPLETED,
        ETLTaskStatus.FAILED: IngestStatus.FAILED,
        ETLTaskStatus.CANCELLED: IngestStatus.CANCELLED,
    }
    return mapping.get(status, IngestStatus.PENDING)


def normalize_saas_status(status: ImportTaskStatus) -> IngestStatus:
    """Import status → Unified status."""
    return IngestStatus(status.value)


def detect_file_ingest_type(filename: str) -> IngestType:
    """Detect file type from filename."""
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    
    if ext == "pdf":
        return IngestType.PDF
    elif ext in {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"}:
        return IngestType.IMAGE
    elif ext in {"txt", "md", "json", "py", "js", "ts", "jsx", "tsx", "html", "css", "yaml", "yml", "xml", "csv", "sql", "sh"}:
        return IngestType.TEXT
    else:
        return IngestType.DOCUMENT


def normalize_file_task(task: ETLTask) -> IngestTaskResponse:
    """ETL task → Unified response."""
    ingest_type = detect_file_ingest_type(task.filename)
    
    # Extract content_node_id from result or metadata
    content_node_id = None
    if task.result and hasattr(task.result, "content_node_id"):
        content_node_id = task.result.content_node_id
    elif task.metadata.get("content_node_id"):
        content_node_id = task.metadata.get("content_node_id")
    elif task.metadata.get("mount_node_id"):
        content_node_id = task.metadata.get("mount_node_id")
    
    return IngestTaskResponse(
        task_id=str(task.task_id),
        source_type=SourceType.FILE,
        ingest_type=ingest_type,
        status=normalize_file_status(task.status),
        progress=task.progress,
        message=task.metadata.get("message"),
        content_node_id=content_node_id,
        error=task.error,
        created_at=task.created_at,
        updated_at=task.updated_at,
        completed_at=task.updated_at if task.status == ETLTaskStatus.COMPLETED else None,
        filename=task.filename,
        metadata=task.metadata,
    )


def normalize_saas_task(task: ImportTask) -> IngestTaskResponse:
    """Import task → Unified response."""
    # Map task type to ingest type
    type_mapping = {
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
        "file": IngestType.DOCUMENT,
    }
    ingest_type = type_mapping.get(task.task_type.value, IngestType.WEB_PAGE)
    
    # Detect source_type
    source_type = SourceType.SAAS
    if task.task_type.value == "url":
        source_type = SourceType.URL
    
    return IngestTaskResponse(
        task_id=task.id or "",
        source_type=source_type,
        ingest_type=ingest_type,
        status=normalize_saas_status(task.status),
        progress=task.progress,
        message=task.message,
        content_node_id=task.content_node_id,
        items_count=task.items_count,
        error=task.error,
        created_at=task.created_at,
        updated_at=task.updated_at,
        completed_at=task.completed_at,
        metadata=task.config,
    )



