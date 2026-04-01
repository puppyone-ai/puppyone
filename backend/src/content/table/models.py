from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Project(BaseModel):
    """
    Project represents a project, corresponding to the project table in Supabase database.
    """

    id: str = Field(..., description="Primary key, project ID (UUID)")
    org_id: str = Field(..., description="Organization ID")
    created_by: str | None = Field(None, description="Creator user ID")
    name: str | None = Field(None, description="Project name")
    description: str | None = Field(None, description="Project description")
    created_at: datetime = Field(..., description="Creation time")

    model_config = ConfigDict(from_attributes=True)


class Table(BaseModel):
    """
    Table represents a knowledge base, corresponding to the table table in Supabase database.
    """

    id: str = Field(..., description="Primary key, knowledge base ID (UUID)")
    name: str | None = Field(
        None, description="Knowledge base name, can be provided to Agent in MCP service"
    )
    project_id: str | None = Field(
        None, description="Foreign key to project table, project ID (UUID) the knowledge base belongs to. Required when creating."
    )
    created_by: str | None = Field(
        None, description="Creator user ID"
    )
    description: str | None = Field(
        None, description="Knowledge base description, can be provided to Agent in MCP service"
    )
    data: Any | None = Field(
        None,
        description="Key data storage field, essentially stores a JSON object (jsonb type), can be Dict, List, or other JSON types",
    )
    created_at: datetime = Field(..., description="Creation time")

    model_config = ConfigDict(from_attributes=True)
