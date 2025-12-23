"""
ETL Task Models

Data models for ETL tasks.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class ETLTaskStatus(str, Enum):
    """Status of an ETL task."""
    PENDING = "pending"
    MINERU_PARSING = "mineru_parsing"
    LLM_PROCESSING = "llm_processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ETLTaskResult(BaseModel):
    """Result of an ETL task."""

    output_path: str = Field(..., description="Path to output JSON file in S3")
    output_size: int = Field(..., description="Size of output file in bytes")
    processing_time: float = Field(..., description="Total processing time in seconds")
    mineru_task_id: Optional[str] = Field(None, description="MineRU task ID")


class ETLTask(BaseModel):
    """ETL task model."""

    task_id: Optional[int] = Field(None, description="Unique task identifier (None for new tasks)")
    user_id: str = Field(..., description="User ID who created the task")
    project_id: int = Field(..., description="Project ID")
    filename: str = Field(..., description="Original filename")
    rule_id: int = Field(..., description="Rule ID to apply")
    status: ETLTaskStatus = Field(default=ETLTaskStatus.PENDING, description="Task status")
    progress: int = Field(default=0, description="Progress percentage (0-100)")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    result: Optional[ETLTaskResult] = Field(None, description="Task result if completed")
    error: Optional[str] = Field(None, description="Error message if failed")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

    def update_status(self, status: ETLTaskStatus, progress: Optional[int] = None):
        """Update task status and timestamp."""
        self.status = status
        if progress is not None:
            self.progress = progress
        self.updated_at = datetime.utcnow()

    def mark_failed(self, error: str):
        """Mark task as failed with error message."""
        self.status = ETLTaskStatus.FAILED
        self.error = error
        self.progress = 0
        self.updated_at = datetime.utcnow()

    def mark_cancelled(self, reason: str | None = None):
        """Mark task as cancelled."""
        self.status = ETLTaskStatus.CANCELLED
        if reason:
            self.error = reason
        self.updated_at = datetime.utcnow()

    def mark_completed(self, result: ETLTaskResult):
        """Mark task as completed with result."""
        self.status = ETLTaskStatus.COMPLETED
        self.result = result
        self.progress = 100
        self.updated_at = datetime.utcnow()

    def to_dict(self) -> dict[str, Any]:
        """Convert task to dictionary for database storage."""
        data = {
            "user_id": self.user_id,
            "project_id": self.project_id,
            "rule_id": self.rule_id,
            "filename": self.filename,
            "status": self.status.value,
            "progress": self.progress,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "error": self.error,
            "metadata": self.metadata,
        }
        
        if self.task_id is not None:
            data["id"] = self.task_id
        
        if self.result:
            data["result"] = self.result.model_dump()
        
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ETLTask":
        """Create task from database record."""
        # Parse result if present
        result = None
        if data.get("result"):
            result = ETLTaskResult(**data["result"])
        
        # Parse timestamps
        created_at = data.get("created_at")
        if isinstance(created_at, str):
            created_at = created_at.replace("Z", "+00:00")
            created_at = datetime.fromisoformat(created_at)
        
        updated_at = data.get("updated_at")
        if isinstance(updated_at, str):
            updated_at = updated_at.replace("Z", "+00:00")
            updated_at = datetime.fromisoformat(updated_at)
        
        return cls(
            task_id=data.get("id"),
            user_id=data["user_id"],
            project_id=data["project_id"],
            rule_id=data["rule_id"],
            filename=data["filename"],
            status=ETLTaskStatus(data["status"]),
            progress=data.get("progress", 0),
            created_at=created_at or datetime.utcnow(),
            updated_at=updated_at or datetime.utcnow(),
            result=result,
            error=data.get("error"),
            metadata=data.get("metadata", {}),
        )

