"""
Unified Ingest Schemas - Gateway layer unified interface definitions.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class SourceType(str, Enum):
    """Data source type - determines which worker to route to."""
    FILE = "file"      # → File Worker (ETL)
    SAAS = "saas"      # → SaaS Worker (Import)
    URL = "url"        # → SaaS Worker (Import)


class IngestType(str, Enum):
    """Specific import type."""
    # File types (FILE source → File Worker)
    PDF = "pdf"
    IMAGE = "image"
    DOCUMENT = "document"  # docx, xlsx, etc.
    TEXT = "text"          # txt, md, json, code files
    
    # SaaS types (SAAS source → SaaS Worker)
    GITHUB = "github"
    NOTION = "notion"
    GMAIL = "gmail"
    GOOGLE_DRIVE = "google_drive"
    GOOGLE_SHEETS = "google_sheets"
    GOOGLE_DOCS = "google_docs"
    GOOGLE_CALENDAR = "google_calendar"
    AIRTABLE = "airtable"
    LINEAR = "linear"
    
    # URL types (URL source → SaaS Worker)
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
    url: Optional[str] = Field(None, description="SaaS or Web URL")
    
    # Optional configuration
    name: Optional[str] = Field(None, description="Custom name")
    mode: IngestMode = Field(IngestMode.SMART, description="Processing mode")
    rule_id: Optional[int] = Field(None, description="ETL rule ID")
    node_id: Optional[str] = Field(None, description="Target node ID")
    crawl_options: Optional[dict] = Field(None, description="URL crawl options")
    sync_config: Optional[dict] = Field(None, description="Sync configuration")


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
    filename: Optional[str] = None
    s3_key: Optional[str] = None
    error: Optional[str] = None


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
    message: Optional[str] = None
    
    # Result
    content_node_id: Optional[str] = None
    items_count: Optional[int] = None
    
    # Error
    error: Optional[str] = None
    
    # Timestamps
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    
    # Original filename (FILE type)
    filename: Optional[str] = None
    
    # Metadata
    metadata: dict[str, Any] = Field(default_factory=dict)


class BatchTaskResponse(BaseModel):
    """Batch query response."""
    tasks: list[IngestTaskResponse]
    total: int

