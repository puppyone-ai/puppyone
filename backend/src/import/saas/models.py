"""
SaaS Import Runtime State Models

Redis runtime state is the source of truth for in-flight sync tasks.
Follows the same pattern as ETL runtime state for consistency.
"""

from __future__ import annotations

from datetime import datetime, UTC
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

from src.sync_task.models import SyncTaskStatus, SyncTaskType


class SyncPhase(str, Enum):
    """Phases of a sync task."""
    INIT = "init"
    DOWNLOADING = "downloading"
    EXTRACTING = "extracting"
    UPLOADING = "uploading"
    CREATING_NODES = "creating_nodes"
    FINALIZE = "finalize"


class SyncRuntimeState(BaseModel):
    """
    Runtime state stored in Redis for sync tasks.
    
    This is the authoritative state during task execution.
    Database state is updated at key checkpoints and terminal states.
    """

    task_id: int

    # Identifiers needed for access-check without DB round-trip
    user_id: str
    project_id: str
    task_type: SyncTaskType
    source_url: str

    # Status and phase
    status: SyncTaskStatus = Field(default=SyncTaskStatus.PENDING)
    phase: SyncPhase = Field(default=SyncPhase.INIT)
    progress: int = Field(default=0, ge=0, le=100)
    progress_message: Optional[str] = None

    # Attempt tracking (for retry logic)
    attempt_count: int = 0

    # ARQ job tracking
    arq_job_id: Optional[str] = None

    # Download progress
    bytes_downloaded: int = 0
    bytes_total: int = 0

    # File processing progress
    files_processed: int = 0
    files_total: int = 0

    # Result
    root_node_id: Optional[str] = None

    # Error tracking
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    error_stage: Optional[str] = None  # "download" | "extract" | "upload" | "create_nodes"

    # Additional metadata
    metadata: dict[str, Any] = Field(default_factory=dict)

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.now(UTC)

    def update_download_progress(
        self, bytes_downloaded: int, bytes_total: int
    ) -> None:
        """Update download progress (0-30% of total)."""
        self.bytes_downloaded = bytes_downloaded
        self.bytes_total = bytes_total
        if bytes_total > 0:
            self.progress = int((bytes_downloaded / bytes_total) * 30)
        self.progress_message = (
            f"Downloading... {bytes_downloaded / 1024 / 1024:.1f}MB "
            f"/ {bytes_total / 1024 / 1024:.1f}MB"
        )
        self.touch()

    def update_file_progress(self, files_processed: int, files_total: int) -> None:
        """Update file processing progress (40-90% of total)."""
        self.files_processed = files_processed
        self.files_total = files_total
        if files_total > 0:
            self.progress = 40 + int((files_processed / files_total) * 50)
        self.progress_message = f"Uploading... {files_processed}/{files_total} files"
        self.touch()

    def mark_downloading(self) -> None:
        """Mark task as downloading."""
        self.phase = SyncPhase.DOWNLOADING
        self.status = SyncTaskStatus.DOWNLOADING
        self.progress = 0
        self.progress_message = "Starting download..."
        self.touch()

    def mark_extracting(self) -> None:
        """Mark task as extracting."""
        self.phase = SyncPhase.EXTRACTING
        self.status = SyncTaskStatus.EXTRACTING
        self.progress = 32
        self.progress_message = "Extracting files..."
        self.touch()

    def mark_uploading(self) -> None:
        """Mark task as uploading files."""
        self.phase = SyncPhase.UPLOADING
        self.status = SyncTaskStatus.UPLOADING
        self.progress = 40
        self.progress_message = "Starting upload..."
        self.touch()

    def mark_creating_nodes(self) -> None:
        """Mark task as creating content nodes."""
        self.phase = SyncPhase.CREATING_NODES
        self.status = SyncTaskStatus.CREATING_NODES
        self.progress = 92
        self.progress_message = "Creating file tree..."
        self.touch()

    def mark_completed(self, root_node_id: str) -> None:
        """Mark task as completed."""
        self.phase = SyncPhase.FINALIZE
        self.status = SyncTaskStatus.COMPLETED
        self.root_node_id = root_node_id
        self.progress = 100
        self.progress_message = "Completed"
        self.error_message = None
        self.error_stage = None
        self.touch()

    def mark_failed(self, error: str, stage: Optional[str] = None) -> None:
        """Mark task as failed."""
        self.status = SyncTaskStatus.FAILED
        self.error_message = error
        self.error_stage = stage
        self.progress_message = f"Failed: {error[:100]}"
        self.touch()

    def mark_cancelled(self, reason: Optional[str] = None) -> None:
        """Mark task as cancelled."""
        self.status = SyncTaskStatus.CANCELLED
        if reason:
            self.error_message = reason
            self.progress_message = f"Cancelled: {reason}"
        else:
            self.progress_message = "Cancelled"
        self.touch()

