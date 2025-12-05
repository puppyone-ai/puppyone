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


class ETLTaskResult(BaseModel):
    """Result of an ETL task."""

    output_path: str = Field(..., description="Path to output JSON file in S3")
    output_size: int = Field(..., description="Size of output file in bytes")
    processing_time: float = Field(..., description="Total processing time in seconds")
    mineru_task_id: Optional[str] = Field(None, description="MineRU task ID")


class ETLTask(BaseModel):
    """ETL task model."""

    task_id: str = Field(..., description="Unique task identifier")
    user_id: str = Field(..., description="User ID who created the task")
    project_id: str = Field(..., description="Project ID")
    filename: str = Field(..., description="Original filename")
    rule_id: str = Field(..., description="Rule ID to apply")
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

    def mark_completed(self, result: ETLTaskResult):
        """Mark task as completed with result."""
        self.status = ETLTaskStatus.COMPLETED
        self.result = result
        self.progress = 100
        self.updated_at = datetime.utcnow()

