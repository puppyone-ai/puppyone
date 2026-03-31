"""
Project Data Models

Defines Pydantic models corresponding to the project table, used for type checking and data validation.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ProjectBase(BaseModel):
    """Project base model"""

    name: str
    description: Optional[str] = None
    org_id: Optional[str] = None
    visibility: str = "org"
    created_by: Optional[str] = None


class ProjectCreate(ProjectBase):
    """Create project model"""

    id: Optional[str] = None


class ProjectUpdate(BaseModel):
    """Update project model"""

    name: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[str] = None


class ProjectResponse(ProjectBase):
    """Project response model"""

    id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
