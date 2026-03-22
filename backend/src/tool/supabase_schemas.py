"""
Tool data models

Defines Pydantic models corresponding to the public.tool table for type checking and data validation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional, Literal

from pydantic import BaseModel, ConfigDict


ToolCategory = Literal["builtin", "custom"]


class ToolBase(BaseModel):
    """Tool base model"""

    created_by: Optional[str] = None
    org_id: Optional[str] = None
    project_id: Optional[str] = None  # Associated project ID
    path: Optional[str] = None  # MUT path
    json_path: Optional[str] = None  # JSON internal path

    type: Optional[str] = None
    name: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None

    # Additional fields
    category: Optional[ToolCategory] = None
    script_type: Optional[str] = None
    script_content: Optional[str] = None


class ToolCreate(ToolBase):
    """Create Tool model"""



class ToolUpdate(BaseModel):
    """Update Tool model"""

    project_id: Optional[str] = None  # Associated project ID
    path: Optional[str] = None  # MUT path
    json_path: Optional[str] = None

    type: Optional[str] = None
    name: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None

    # Additional fields
    category: Optional[ToolCategory] = None
    script_type: Optional[str] = None
    script_content: Optional[str] = None


class ToolResponse(ToolBase):
    """Tool response model"""

    id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
