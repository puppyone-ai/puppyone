"""
Sync Task Models

Data models for sync tasks.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class SyncTaskStatus(str, Enum):
    """Status of a sync task."""

    PENDING = "pending"
    DOWNLOADING = "downloading"
    EXTRACTING = "extracting"
    UPLOADING = "uploading"
    CREATING_NODES = "creating_nodes"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @classmethod
    def terminal_statuses(cls) -> set["SyncTaskStatus"]:
        """Return set of terminal statuses."""
        return {cls.COMPLETED, cls.FAILED, cls.CANCELLED}

    def is_terminal(self) -> bool:
        """Check if this status is terminal."""
        return self in self.terminal_statuses()


class SyncTaskType(str, Enum):
    """Type of sync task."""

    GITHUB_REPO = "github_repo"
    NOTION_DATABASE = "notion_database"
    NOTION_PAGE = "notion_page"
    AIRTABLE_BASE = "airtable_base"
    GOOGLE_SHEET = "google_sheet"
    LINEAR_PROJECT = "linear_project"


class SyncTask(BaseModel):
    """Sync task model."""

    id: Optional[int] = Field(None, description="Unique task identifier")
    user_id: str = Field(..., description="User ID who created the task")
    project_id: str = Field(..., description="Project ID (UUID)")

    # Task type and source
    task_type: SyncTaskType = Field(..., description="Type of sync task")
    source_url: str = Field(..., description="Source URL to sync from")

    # Status and progress
    status: SyncTaskStatus = Field(
        default=SyncTaskStatus.PENDING, description="Task status"
    )
    progress: int = Field(default=0, description="Progress percentage (0-100)")
    progress_message: Optional[str] = Field(
        None, description="Human-readable progress message"
    )

    # Result
    root_node_id: Optional[str] = Field(
        None, description="Root content_node created by this task"
    )
    files_total: int = Field(default=0, description="Total number of files to process")
    files_processed: int = Field(
        default=0, description="Number of files already processed"
    )
    bytes_total: int = Field(default=0, description="Total bytes to download")
    bytes_downloaded: int = Field(default=0, description="Bytes already downloaded")

    # Metadata and error
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata"
    )
    error: Optional[str] = Field(None, description="Error message if failed")

    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = Field(None)

    def update_progress(
        self,
        progress: int,
        message: Optional[str] = None,
        status: Optional[SyncTaskStatus] = None,
    ):
        """Update task progress."""
        self.progress = max(0, min(100, progress))
        if message is not None:
            self.progress_message = message
        if status is not None:
            self.status = status
        self.updated_at = datetime.utcnow()

    def update_download_progress(self, bytes_downloaded: int, bytes_total: int):
        """Update download progress."""
        self.bytes_downloaded = bytes_downloaded
        self.bytes_total = bytes_total
        if bytes_total > 0:
            # Download is 0-30% of total progress
            self.progress = int((bytes_downloaded / bytes_total) * 30)
        self.progress_message = (
            f"Downloading... {bytes_downloaded / 1024 / 1024:.1f}MB "
            f"/ {bytes_total / 1024 / 1024:.1f}MB"
        )
        self.updated_at = datetime.utcnow()

    def update_file_progress(self, files_processed: int, files_total: int):
        """Update file processing progress."""
        self.files_processed = files_processed
        self.files_total = files_total
        if files_total > 0:
            # File processing is 40-90% of total progress
            self.progress = 40 + int((files_processed / files_total) * 50)
        self.progress_message = f"Uploading... {files_processed}/{files_total} files"
        self.updated_at = datetime.utcnow()

    def mark_downloading(self):
        """Mark task as downloading."""
        self.status = SyncTaskStatus.DOWNLOADING
        self.progress = 0
        self.progress_message = "Starting download..."
        self.updated_at = datetime.utcnow()

    def mark_extracting(self):
        """Mark task as extracting."""
        self.status = SyncTaskStatus.EXTRACTING
        self.progress = 32
        self.progress_message = "Extracting files..."
        self.updated_at = datetime.utcnow()

    def mark_uploading(self):
        """Mark task as uploading."""
        self.status = SyncTaskStatus.UPLOADING
        self.progress = 40
        self.progress_message = "Starting upload..."
        self.updated_at = datetime.utcnow()

    def mark_creating_nodes(self):
        """Mark task as creating nodes."""
        self.status = SyncTaskStatus.CREATING_NODES
        self.progress = 92
        self.progress_message = "Creating file tree..."
        self.updated_at = datetime.utcnow()

    def mark_completed(self, root_node_id: str):
        """Mark task as completed."""
        self.status = SyncTaskStatus.COMPLETED
        self.root_node_id = root_node_id
        self.progress = 100
        self.progress_message = "Completed"
        self.completed_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()

    def mark_failed(self, error: str):
        """Mark task as failed."""
        self.status = SyncTaskStatus.FAILED
        self.error = error
        self.progress_message = f"Failed: {error[:100]}"
        self.updated_at = datetime.utcnow()

    def mark_cancelled(self, reason: Optional[str] = None):
        """Mark task as cancelled."""
        self.status = SyncTaskStatus.CANCELLED
        if reason:
            self.error = reason
            self.progress_message = f"Cancelled: {reason}"
        else:
            self.progress_message = "Cancelled"
        self.updated_at = datetime.utcnow()

    def to_dict(self) -> dict[str, Any]:
        """Convert task to dictionary for database storage."""
        data = {
            "user_id": self.user_id,
            "project_id": self.project_id,
            "task_type": self.task_type.value,
            "source_url": self.source_url,
            "status": self.status.value,
            "progress": self.progress,
            "progress_message": self.progress_message,
            "root_node_id": self.root_node_id,
            "files_total": self.files_total,
            "files_processed": self.files_processed,
            "bytes_total": self.bytes_total,
            "bytes_downloaded": self.bytes_downloaded,
            "metadata": self.metadata,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }

        if self.id is not None:
            data["id"] = self.id

        if self.completed_at:
            data["completed_at"] = self.completed_at.isoformat()

        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SyncTask":
        """Create task from database record."""

        def parse_datetime(value: Any) -> Optional[datetime]:
            if value is None:
                return None
            if isinstance(value, datetime):
                return value
            if isinstance(value, str):
                value = value.replace("Z", "+00:00")
                return datetime.fromisoformat(value)
            return None

        return cls(
            id=data.get("id"),
            user_id=data["user_id"],
            project_id=data["project_id"],
            task_type=SyncTaskType(data["task_type"]),
            source_url=data["source_url"],
            status=SyncTaskStatus(data["status"]),
            progress=data.get("progress", 0),
            progress_message=data.get("progress_message"),
            root_node_id=data.get("root_node_id"),
            files_total=data.get("files_total", 0),
            files_processed=data.get("files_processed", 0),
            bytes_total=data.get("bytes_total", 0),
            bytes_downloaded=data.get("bytes_downloaded", 0),
            metadata=data.get("metadata", {}),
            error=data.get("error"),
            created_at=parse_datetime(data.get("created_at")) or datetime.utcnow(),
            updated_at=parse_datetime(data.get("updated_at")) or datetime.utcnow(),
            completed_at=parse_datetime(data.get("completed_at")),
        )

