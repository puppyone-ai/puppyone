"""
Normalizers - Convert ETL tasks to unified format.

SaaS normalizers removed — SaaS imports now go through Bootstrap + SyncEngine.
"""


from src.ingest.file.tasks.models import ETLTask, ETLTaskStatus
from src.ingest.schemas import (
    IngestStatus,
    IngestTaskResponse,
    IngestType,
    SourceType,
)


def normalize_file_status(status: ETLTaskStatus) -> IngestStatus:
    """ETL status -> Unified status."""
    mapping = {
        ETLTaskStatus.PENDING: IngestStatus.PENDING,
        ETLTaskStatus.MINERU_PARSING: IngestStatus.PROCESSING,
        ETLTaskStatus.LLM_PROCESSING: IngestStatus.PROCESSING,
        ETLTaskStatus.COMPLETED: IngestStatus.COMPLETED,
        ETLTaskStatus.FAILED: IngestStatus.FAILED,
        ETLTaskStatus.CANCELLED: IngestStatus.CANCELLED,
    }
    return mapping.get(status, IngestStatus.PENDING)


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
    """ETL task -> Unified response."""
    ingest_type = detect_file_ingest_type(task.filename)

    content_path = None
    if task.result and hasattr(task.result, "content_path"):
        content_path = task.result.content_path
    elif task.metadata.get("content_path"):
        content_path = task.metadata.get("content_path")
    elif task.metadata.get("mount_path"):
        content_path = task.metadata.get("mount_path")

    return IngestTaskResponse(
        task_id=str(task.task_id),
        source_type=SourceType.FILE,
        ingest_type=ingest_type,
        status=normalize_file_status(task.status),
        progress=task.progress,
        message=task.metadata.get("message"),
        content_path=content_path,
        error=task.error,
        created_at=task.created_at,
        updated_at=task.updated_at,
        completed_at=task.updated_at if task.status == ETLTaskStatus.COMPLETED else None,
        filename=task.filename,
        metadata=task.metadata,
    )
