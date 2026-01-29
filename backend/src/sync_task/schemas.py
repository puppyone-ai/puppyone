"""
Sync Task Schemas

Pydantic schemas for API request/response.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from .models import SyncTaskStatus, SyncTaskType


class StartSyncRequest(BaseModel):
    """Request to start a sync task."""

    url: str = Field(..., description="Source URL to sync from")
    project_id: str = Field(..., description="Project ID")
    task_type: Optional[SyncTaskType] = Field(
        None, description="Task type (auto-detected if not provided)"
    )


class SyncTaskResponse(BaseModel):
    """Response for a sync task."""

    id: int
    user_id: str
    project_id: str
    task_type: str
    source_url: str
    status: str
    progress: int
    progress_message: Optional[str]
    root_node_id: Optional[str]
    files_total: int
    files_processed: int
    bytes_total: int
    bytes_downloaded: int
    error: Optional[str]
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime]


class SyncTaskStatusResponse(BaseModel):
    """Lightweight status response for polling."""

    id: int
    status: str
    progress: int
    progress_message: Optional[str]
    root_node_id: Optional[str]
    files_total: int
    files_processed: int
    bytes_total: int
    bytes_downloaded: int
    error: Optional[str]
    is_terminal: bool


class BatchStatusRequest(BaseModel):
    """Request to get status for multiple tasks."""

    task_ids: list[int] = Field(..., description="List of task IDs")


class BatchStatusResponse(BaseModel):
    """Response with status for multiple tasks."""

    tasks: dict[int, SyncTaskStatusResponse]


def task_to_response(task: Any) -> SyncTaskResponse:
    """Convert SyncTask model to response schema."""
    return SyncTaskResponse(
        id=task.id,
        user_id=task.user_id,
        project_id=task.project_id,
        task_type=task.task_type.value if hasattr(task.task_type, 'value') else task.task_type,
        source_url=task.source_url,
        status=task.status.value if hasattr(task.status, 'value') else task.status,
        progress=task.progress,
        progress_message=task.progress_message,
        root_node_id=task.root_node_id,
        files_total=task.files_total,
        files_processed=task.files_processed,
        bytes_total=task.bytes_total,
        bytes_downloaded=task.bytes_downloaded,
        error=task.error,
        created_at=task.created_at,
        updated_at=task.updated_at,
        completed_at=task.completed_at,
    )


def task_to_status_response(task: Any) -> SyncTaskStatusResponse:
    """Convert SyncTask model to status response schema."""
    status = task.status.value if hasattr(task.status, 'value') else task.status
    is_terminal = status in ['completed', 'failed', 'cancelled']

    return SyncTaskStatusResponse(
        id=task.id,
        status=status,
        progress=task.progress,
        progress_message=task.progress_message,
        root_node_id=task.root_node_id,
        files_total=task.files_total,
        files_processed=task.files_processed,
        bytes_total=task.bytes_total,
        bytes_downloaded=task.bytes_downloaded,
        error=task.error,
        is_terminal=is_terminal,
    )

