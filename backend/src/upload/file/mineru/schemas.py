"""
MineRU Client Schemas

Pydantic models for MineRU API requests and responses.
"""

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class MineRUModelVersion(str, Enum):
    """MineRU model versions."""

    VLM = "vlm"
    DOCUMENT = "document"
    OCR = "ocr"


class MineRUTaskState(str, Enum):
    """MineRU task states."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "done"  # MineRU API 使用 "done" 表示完成状态
    FAILED = "failed"
    CONVERTING = "converting"  # 格式转换中
    WAITING_FILE = "waiting-file"  # 等待文件上传


class CreateTaskRequest(BaseModel):
    """Request to create a MineRU parsing task."""

    url: str = Field(..., description="Presigned URL of the file to parse")
    model_version: MineRUModelVersion = Field(
        default=MineRUModelVersion.VLM, description="Model version to use for parsing"
    )
    data_id: Optional[str] = Field(
        None, description="Optional data identifier for tracking"
    )


class CreateTaskData(BaseModel):
    """Data field in create task response."""

    task_id: str = Field(..., description="Task ID for tracking")


class CreateTaskResponse(BaseModel):
    """Response from creating a MineRU task."""

    code: int = Field(..., description="API status code, 0 for success")
    msg: str = Field(..., description="API message")
    trace_id: Optional[str] = Field(None, description="Trace ID for debugging")
    data: Optional[CreateTaskData] = Field(None, description="Task data")

    @property
    def task_id(self) -> str:
        """Get task_id from data field for backward compatibility."""
        if not self.data:
            raise ValueError("No data field in response")
        return self.data.task_id


class ExtractProgress(BaseModel):
    """Extract progress information."""

    extracted_pages: Optional[int] = Field(None, description="已解析页数")
    total_pages: Optional[int] = Field(None, description="总页数")
    start_time: Optional[str] = Field(None, description="开始时间")


class TaskStatusData(BaseModel):
    """Data field in task status response."""

    task_id: str = Field(..., description="Task ID")
    state: MineRUTaskState = Field(..., description="Current task state")
    data_id: Optional[str] = Field(None, description="Data ID")
    extract_progress: Optional[ExtractProgress] = Field(
        None, description="Extraction progress (when state=running)"
    )
    full_zip_url: Optional[str] = Field(
        None, description="URL to download the result ZIP file"
    )
    err_msg: Optional[str] = Field(None, description="Error message if task failed")


class TaskStatusResponse(BaseModel):
    """Response from querying task status."""

    code: int = Field(..., description="API status code, 0 for success")
    msg: str = Field(..., description="API message")
    trace_id: Optional[str] = Field(None, description="Trace ID for debugging")
    data: Optional[TaskStatusData] = Field(None, description="Task status data")

    @property
    def task_id(self) -> str:
        """Get task_id from data field for backward compatibility."""
        if not self.data:
            raise ValueError("No data field in response")
        return self.data.task_id

    @property
    def state(self) -> MineRUTaskState:
        """Get state from data field for backward compatibility."""
        if not self.data:
            raise ValueError("No data field in response")
        return self.data.state

    @property
    def full_zip_url(self) -> Optional[str]:
        """Get full_zip_url from data field for backward compatibility."""
        if not self.data:
            return None
        return self.data.full_zip_url

    @property
    def err_msg(self) -> Optional[str]:
        """Get err_msg from data field for backward compatibility."""
        if not self.data:
            return None
        return self.data.err_msg

    @property
    def extract_progress(self) -> Optional[int]:
        """Get extract progress as percentage for backward compatibility."""
        if (
            not self.data
            or not self.data.extract_progress
            or not self.data.extract_progress.total_pages
        ):
            return None
        extracted = self.data.extract_progress.extracted_pages or 0
        total = self.data.extract_progress.total_pages
        return int((extracted / total) * 100) if total > 0 else 0


class ParsedResult(BaseModel):
    """Parsed result from MineRU."""

    task_id: str = Field(..., description="Task ID")
    cache_dir: str = Field(..., description="Local cache directory path")
    markdown_path: str = Field(..., description="Path to extracted Markdown file")
    markdown_content: str = Field(..., description="Content of the Markdown file")
