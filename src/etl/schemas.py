"""
ETL API Schemas

Pydantic models for ETL API requests and responses.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from src.etl.tasks.models import ETLTaskStatus


class ETLSubmitRequest(BaseModel):
    """Request to submit an ETL task."""

    user_id: int = Field(..., description="User ID")
    project_id: int = Field(..., description="Project ID")
    filename: str = Field(..., description="Source filename")
    rule_id: int = Field(..., description="Rule ID to apply")


class ETLSubmitResponse(BaseModel):
    """Response for ETL task submission."""

    task_id: int = Field(..., description="Created task ID")
    status: ETLTaskStatus = Field(..., description="Initial task status")
    message: str = Field(..., description="Status message")


class ETLTaskResponse(BaseModel):
    """Response for ETL task status query."""

    task_id: int
    user_id: int
    project_id: int
    filename: str
    rule_id: int
    status: ETLTaskStatus
    progress: int
    created_at: datetime
    updated_at: datetime
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ETLTaskListResponse(BaseModel):
    """Response for ETL task list query."""

    tasks: list[ETLTaskResponse]
    total: int
    limit: int
    offset: int


class ETLRuleCreateRequest(BaseModel):
    """Request to create an ETL rule."""

    name: str = Field(..., description="Rule name")
    description: str = Field(..., description="Rule description")
    json_schema: dict[str, Any] = Field(..., description="JSON Schema for output")
    system_prompt: Optional[str] = Field(None, description="Optional system prompt")


class ETLRuleResponse(BaseModel):
    """Response for ETL rule query."""

    rule_id: int
    name: str
    description: str
    json_schema: dict[str, Any]
    system_prompt: Optional[str]
    created_at: datetime
    updated_at: datetime


class ETLRuleListResponse(BaseModel):
    """Response for ETL rule list query."""

    rules: list[ETLRuleResponse]
    total: int
    limit: int
    offset: int


class ETLHealthResponse(BaseModel):
    """Health check response for ETL service."""

    status: str
    queue_size: int
    task_count: int
    worker_count: int


class ETLMountRequest(BaseModel):
    """Request to mount ETL result to table."""

    table_id: int = Field(..., description="Table ID to mount to")
    json_path: str = Field(..., description="JSON path in table data structure")


class ETLMountResponse(BaseModel):
    """Response for ETL result mount."""

    success: bool = Field(..., description="Whether mount was successful")
    message: str = Field(..., description="Status message")
    mounted_path: str = Field(..., description="Path where result was mounted")

