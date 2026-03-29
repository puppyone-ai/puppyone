"""
Unified Ingest Schemas - Gateway layer unified interface definitions.
"""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SourceType(str, Enum):
    """Data source type."""
    FILE = "file"      # → File Worker (ETL)
    SAAS = "saas"      # → SyncEngine (synchronous execution)
    URL = "url"        # → SyncEngine (synchronous execution)


class IngestType(str, Enum):
    """Specific import type."""
    # File types (FILE source → File Worker)
    PDF = "pdf"
    IMAGE = "image"
    DOCUMENT = "document"  # docx, xlsx, etc.
    TEXT = "text"          # txt, md, json, code files

    # SaaS types (SAAS source → SyncEngine)
    GITHUB = "github"
    NOTION = "notion"
    GMAIL = "gmail"
    GOOGLE_DRIVE = "google_drive"
    GOOGLE_SHEETS = "google_sheets"
    GOOGLE_DOCS = "google_docs"
    GOOGLE_CALENDAR = "google_calendar"
    AIRTABLE = "airtable"
    LINEAR = "linear"

    # URL types
    WEB_PAGE = "web_page"


class IngestStatus(str, Enum):
    """Unified status - maps underlying ETL/Import statuses."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class IngestMode(str, Enum):
    """Processing mode (only applicable for FILE type)."""
    SMART = "smart"           # Smart: text files direct save, PDF/images OCR
    RAW = "raw"               # Raw: all files direct save
    STRUCTURED = "structured"  # Structured: all files go through ETL + rules


# === Request Schemas ===

class IngestSubmitRequest(BaseModel):
    """Unified submit request (JSON body, excluding files)."""
    project_id: str = Field(..., description="Target project ID")
    source_type: SourceType = Field(..., description="Source type")

    # SaaS/URL source (source_type = saas | url)
    url: str | None = Field(None, description="SaaS or Web URL")

    # Optional configuration
    name: str | None = Field(None, description="Custom name")
    mode: IngestMode = Field(IngestMode.SMART, description="Processing mode")
    rule_id: int | None = Field(None, description="ETL rule ID")
    path: str | None = Field(None, description="Target MUT path")
    crawl_options: dict | None = Field(None, description="URL crawl options")
    sync_config: dict | None = Field(None, description="Sync configuration")


class BatchTaskQuery(BaseModel):
    """Single item for batch query."""
    task_id: str
    source_type: SourceType


class BatchQueryRequest(BaseModel):
    """Batch query request."""
    tasks: list[BatchTaskQuery]


# === Response Schemas ===

class IngestSubmitItem(BaseModel):
    """Single submit result."""
    task_id: str
    source_type: SourceType
    ingest_type: IngestType
    status: IngestStatus
    filename: str | None = None
    s3_key: str | None = None
    path: str | None = None
    error: str | None = None


class IngestSubmitResponse(BaseModel):
    """Submit response."""
    items: list[IngestSubmitItem]
    total: int


class IngestTaskResponse(BaseModel):
    """Task status response."""
    task_id: str
    source_type: SourceType
    ingest_type: IngestType
    status: IngestStatus
    progress: int = Field(0, ge=0, le=100)
    message: str | None = None

    # Result
    content_path: str | None = None
    items_count: int | None = None

    # Error
    error: str | None = None

    # Timestamps
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None

    # Original filename (FILE type)
    filename: str | None = None

    # Metadata
    metadata: dict[str, Any] = Field(default_factory=dict)


class BatchTaskResponse(BaseModel):
    """Batch query response."""
    tasks: list[IngestTaskResponse]
    total: int

