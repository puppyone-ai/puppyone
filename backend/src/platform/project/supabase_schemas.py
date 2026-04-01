"""
Project Data Models

Defines Pydantic models corresponding to the project table, used for type checking and data validation.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProjectBase(BaseModel):
    """Project base model"""

    name: str
    description: str | None = None
    org_id: str | None = None
    visibility: str = "org"
    created_by: str | None = None


class ProjectCreate(ProjectBase):
    """Create project model"""

    id: str | None = None


class ProjectUpdate(BaseModel):
    """Update project model"""

    name: str | None = None
    description: str | None = None
    visibility: str | None = None


class ProjectResponse(ProjectBase):
    """Project response model"""

    id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
