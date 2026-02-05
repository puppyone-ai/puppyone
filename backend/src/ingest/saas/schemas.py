"""
Import Module - Unified Request/Response Schemas
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class ImportType(str, Enum):
    """Type of import source."""
    GITHUB = "github"
    NOTION = "notion"
    AIRTABLE = "airtable"
    GOOGLE_SHEETS = "google_sheets"
    LINEAR = "linear"
    URL = "url"
    FILE = "file"


class ImportStatus(str, Enum):
    """Status of import task."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    def is_terminal(self) -> bool:
        return self in {self.COMPLETED, self.FAILED, self.CANCELLED}


# === Request Schemas ===

class ImportSubmitRequest(BaseModel):
    """Unified import submit request."""
    project_id: str = Field(..., description="Target project ID")
    name: Optional[str] = Field(None, description="Name for the imported content")
    
    # Source (one of these)
    url: Optional[str] = Field(None, description="URL to import (SaaS or generic)")
    file_key: Optional[str] = Field(None, description="S3 key of uploaded file for ETL")
    
    # Optional configs
    etl_rule_id: Optional[int] = Field(None, description="ETL rule ID (for file import)")
    crawl_options: Optional[dict] = Field(None, description="Firecrawl options (for URL)")
    
    # Sync config (stored in content_node.sync_config for re-sync)
    sync_config: Optional[dict] = Field(None, description="Sync settings (e.g. recursive, max_depth)")


class ImportParseRequest(BaseModel):
    """Request to parse/preview a URL."""
    url: str = Field(..., description="URL to parse")
    crawl_options: Optional[dict] = Field(None, description="Firecrawl crawl options")


# === Response Schemas ===

class ImportSubmitResponse(BaseModel):
    """Response after submitting import task."""
    task_id: str = Field(..., description="Task ID for tracking")
    status: ImportStatus = Field(..., description="Initial status")
    import_type: ImportType = Field(..., description="Detected import type")


class ImportTaskResponse(BaseModel):
    """Response for task status query."""
    task_id: str
    status: ImportStatus
    import_type: ImportType
    progress: int = Field(0, ge=0, le=100)
    message: Optional[str] = None
    
    # Result (when completed)
    content_node_id: Optional[str] = None
    items_count: Optional[int] = None
    
    # Error (when failed)
    error: Optional[str] = None
    
    # Timestamps
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class ImportParseResponse(BaseModel):
    """Response for URL parsing/preview."""
    url: str
    import_type: ImportType
    title: Optional[str] = None
    description: Optional[str] = None
    fields: list[dict[str, Any]] = Field(default_factory=list)
    sample_data: list[dict[str, Any]] = Field(default_factory=list)
    total_items: int = 0

