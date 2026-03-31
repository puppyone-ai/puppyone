"""
Project Data Models

Defines business domain models for Project
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class Project(BaseModel):
    """Project domain model"""

    id: str = Field(..., description="Project ID (UUID)")
    name: str = Field(..., description="Project name")
    description: Optional[str] = Field(None, description="Project description")
    org_id: str = Field(..., description="Owning organization ID")
    visibility: str = Field(default="org", description="Visibility: org (visible within organization) / private (authorized members only)")
    created_by: Optional[str] = Field(None, description="Creator user ID")
    created_at: datetime = Field(..., description="Creation time")
    updated_at: Optional[datetime] = Field(None, description="Last update time")

    model_config = ConfigDict(from_attributes=True)
