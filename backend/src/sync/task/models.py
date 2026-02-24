"""
Import Task Model - Unified task model for all import types.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class ImportTaskStatus(str, Enum):
    """Status of an import task. Values match uploads.status column."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    def is_terminal(self) -> bool:
        return self in {self.COMPLETED, self.FAILED, self.CANCELLED}


class ImportTaskType(str, Enum):
    """Type of import task - stored in uploads.config.task_type."""
    GITHUB = "github_repo"
    NOTION = "notion_page"  # Default to page, handler can detect database
    NOTION_DATABASE = "notion_database"
    AIRTABLE = "airtable_base"
    GOOGLE_SHEETS = "google_sheet"
    LINEAR = "linear_project"
    URL = "url"  # Generic URL
    FILE = "file"  # File ETL
    # OAuth-based imports
    GMAIL = "gmail"
    GOOGLE_DRIVE = "google_drive"
    GOOGLE_CALENDAR = "google_calendar"
    GOOGLE_DOCS = "google_docs"


class ImportTask(BaseModel):
    """Unified import task model."""
    
    id: Optional[str] = Field(None, description="Task ID (UUID)")
    user_id: str = Field(..., description="User who created the task")
    project_id: str = Field(..., description="Target project ID")
    
    # Type and source
    task_type: ImportTaskType = Field(..., description="Type of import")
    source_url: Optional[str] = Field(None, description="Source URL")
    source_file_key: Optional[str] = Field(None, description="Source file S3 key")
    
    # Config
    config: dict[str, Any] = Field(default_factory=dict, description="Task config")
    
    # Status
    status: ImportTaskStatus = Field(default=ImportTaskStatus.PENDING)
    progress: int = Field(0, ge=0, le=100)
    message: Optional[str] = None
    error: Optional[str] = None
    
    # Node references
    node_id: Optional[str] = None
    result_node_id: Optional[str] = None

    # Result
    items_count: int = 0
    result: dict[str, Any] = Field(default_factory=dict)
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    def update_progress(self, progress: int, message: Optional[str] = None) -> None:
        """Update progress."""
        self.progress = max(0, min(100, progress))
        if message:
            self.message = message
        self.updated_at = datetime.utcnow()

    def mark_processing(self, message: str = "Processing...") -> None:
        """Mark as running."""
        self.status = ImportTaskStatus.RUNNING
        self.message = message
        self.started_at = self.started_at or datetime.utcnow()
        self.updated_at = datetime.utcnow()

    def mark_completed(self, result_node_id: str, items_count: int = 0) -> None:
        """Mark as completed."""
        self.status = ImportTaskStatus.COMPLETED
        self.result_node_id = result_node_id
        self.items_count = items_count
        self.progress = 100
        self.message = "Completed"
        self.completed_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()

    def mark_failed(self, error: str) -> None:
        """Mark as failed."""
        self.status = ImportTaskStatus.FAILED
        self.error = error
        self.message = f"Failed: {error[:100]}"
        self.updated_at = datetime.utcnow()

    def mark_cancelled(self, reason: Optional[str] = None) -> None:
        """Mark as cancelled."""
        self.status = ImportTaskStatus.CANCELLED
        self.error = reason
        self.message = f"Cancelled: {reason}" if reason else "Cancelled"
        self.updated_at = datetime.utcnow()

    def to_db_dict(self) -> dict[str, Any]:
        """Convert to dict for uploads table."""
        config = {
            **self.config,
            "task_type": self.task_type.value,
            "source_url": self.source_url,
            "source_file_key": self.source_file_key,
            "items_count": self.items_count,
        }
        return {
            "id": self.id,
            "user_id": self.user_id,
            "project_id": self.project_id,
            "node_id": self.node_id,
            "type": "import",
            "config": config,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
            "result_node_id": self.result_node_id,
            "result": self.result or {},
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }

    @classmethod
    def from_db_dict(cls, data: dict[str, Any]) -> "ImportTask":
        """Create from uploads table record."""
        config = dict(data.get("config") or {})
        task_type_val = config.pop("task_type", "url")
        source_url = config.pop("source_url", None)
        source_file_key = config.pop("source_file_key", None)
        items_count = config.pop("items_count", 0)

        def parse_dt(val: Any) -> Optional[datetime]:
            if val is None:
                return None
            if isinstance(val, datetime):
                return val
            if isinstance(val, str):
                return datetime.fromisoformat(val.replace("Z", "+00:00"))
            return None

        return cls(
            id=data.get("id"),
            user_id=data["user_id"],
            project_id=data["project_id"],
            task_type=ImportTaskType(task_type_val),
            source_url=source_url,
            source_file_key=source_file_key,
            config=config,
            status=ImportTaskStatus(data.get("status", "pending")),
            progress=data.get("progress", 0),
            message=data.get("message"),
            error=data.get("error"),
            node_id=data.get("node_id"),
            result_node_id=data.get("result_node_id"),
            items_count=items_count or 0,
            result=data.get("result") or {},
            created_at=parse_dt(data.get("created_at")) or datetime.utcnow(),
            updated_at=parse_dt(data.get("updated_at")) or datetime.utcnow(),
            started_at=parse_dt(data.get("started_at")),
            completed_at=parse_dt(data.get("completed_at")),
        )

