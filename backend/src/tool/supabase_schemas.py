"""
Tool data models

Defines Pydantic models corresponding to the public.tool table for type checking and data validation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

ToolCategory = Literal["builtin", "custom"]


class ToolBase(BaseModel):
    """Tool base model"""

    created_by: str | None = None
    org_id: str | None = None
    project_id: str | None = None  # Associated project ID
    path: str | None = None  # version path
    json_path: str | None = None  # JSON internal path

    type: str | None = None
    name: str | None = None
    alias: str | None = None
    description: str | None = None

    input_schema: Any | None = None
    output_schema: Any | None = None
    metadata: Any | None = None

    # Additional fields
    category: ToolCategory | None = None
    script_type: str | None = None
    script_content: str | None = None


class ToolCreate(ToolBase):
    """Create Tool model"""



class ToolUpdate(BaseModel):
    """Update Tool model"""

    project_id: str | None = None  # Associated project ID
    path: str | None = None  # version path
    json_path: str | None = None

    type: str | None = None
    name: str | None = None
    alias: str | None = None
    description: str | None = None

    input_schema: Any | None = None
    output_schema: Any | None = None
    metadata: Any | None = None

    # Additional fields
    category: ToolCategory | None = None
    script_type: str | None = None
    script_content: str | None = None


class ToolResponse(ToolBase):
    """Tool response model"""

    id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
