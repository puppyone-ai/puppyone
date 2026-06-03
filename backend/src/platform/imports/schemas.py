"""Schemas for durable one-time import jobs."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ImportJobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ImportJobPhase(str, Enum):
    QUEUED = "queued"
    VALIDATING = "validating"
    FETCHING = "fetching"
    WRITING = "writing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ImportJobCreateRequest(BaseModel):
    project_id: str = Field(..., description="Target project ID")
    source_url: str = Field(..., min_length=1, description="External source URL")
    provider: str | None = Field(None, description="Optional provider override")
    source_kind: str | None = Field(None, description="Structured source kind")
    source_ref: dict[str, Any] = Field(default_factory=dict, description="Structured provider source identity")
    idempotency_key: str | None = Field(None, description="Optional client idempotency key")
    name: str | None = Field(None, description="Optional import display/folder name")
    target_path: str | None = Field("", description="Optional target folder path")
    crawl_options: dict[str, Any] | None = Field(None, description="Web crawl options")
    config: dict[str, Any] = Field(default_factory=dict, description="Provider config")


class ImportJobResponse(BaseModel):
    id: str
    org_id: str | None = None
    project_id: str
    created_by: str
    provider: str
    source_url: str
    source_kind: str | None = None
    source_ref: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None
    name: str | None = None
    target_path: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    status: ImportJobStatus
    phase: str = "queued"
    progress: int = Field(0, ge=0, le=100)
    message: str | None = None
    result_path: str | None = None
    result_commit_id: str | None = None
    error_message: str | None = None
    worker_job_id: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ImportJobListResponse(BaseModel):
    jobs: list[ImportJobResponse]
    total: int
