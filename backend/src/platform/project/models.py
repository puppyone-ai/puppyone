"""
Project Data Models

Defines business domain models for Project
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Project(BaseModel):
    """Project domain model"""

    id: str = Field(..., description="Project ID (UUID)")
    name: str = Field(..., description="Project name")
    description: str | None = Field(None, description="Project description")
    org_id: str = Field(..., description="Owning organization ID")
    visibility: str = Field(default="org", description="Visibility: org (visible within organization) / private (authorized members only)")
    bound_git_branch: str = Field(
        default="main",
        description=(
            "Default git branch this project binds to. Used as the "
            "starting branch for new GitHub bindings and as the default "
            "ref for clients cloning the project. Doesn't affect existing "
            "bindings (each binding stores its own branch)."
        ),
    )
    created_by: str | None = Field(None, description="Creator user ID")
    created_at: datetime = Field(..., description="Creation time")
    updated_at: datetime | None = Field(None, description="Last update time")

    model_config = ConfigDict(from_attributes=True)
