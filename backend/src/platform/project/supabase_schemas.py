"""
Project Data Models

Defines Pydantic models corresponding to the project table, used for type checking and data validation.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class ProjectBase(BaseModel):
    """Project base model"""

    name: str
    description: str | None = None
    org_id: str | None = None
    visibility: str = "org"
    bound_git_branch: str = "main"
    protocol_mode: Literal["git", "mut", "both"] = "git"
    created_by: str | None = None


class ProjectCreate(ProjectBase):
    """Create project model"""

    id: str | None = None


class ProjectUpdate(BaseModel):
    """Update project model"""

    name: str | None = None
    description: str | None = None
    visibility: str | None = None
    bound_git_branch: str | None = None
    protocol_mode: Literal["git", "mut", "both"] | None = None


class ProjectResponse(ProjectBase):
    """Project response model"""

    id: str
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
