from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TableCreate(BaseModel):
    """Request to create a Table"""

    project_id: str = Field(..., description="Project ID (required, all Tables must belong to a Project)")
    name: str = Field(..., description="Table name")
    description: str = Field(default="", description="Table description")
    data: Any = Field(
        default_factory=dict, description="Table data (can be Dict, List, or other JSON types)"
    )


class TableUpdate(BaseModel):
    """Request to update a Table"""

    name: str | None = Field(None, description="Table name")
    description: str | None = Field(None, description="Table description")
    data: Any | None = Field(
        None, description="Table data (optional, can be Dict, List, or other JSON types)"
    )


class TableOut(BaseModel):
    """Table response model"""

    id: str = Field(..., description="Table ID (UUID)")
    name: str | None = Field(None, description="Table name")
    project_id: str | None = Field(None, description="Project ID (UUID)")
    created_by: str | None = Field(None, description="Creator user ID")
    description: str | None = Field(None, description="Table description")
    data: Any | None = Field(
        None, description="Table data (JSON data, can be Dict, List, or other JSON types)"
    )
    created_at: datetime = Field(..., description="Creation time")

    model_config = ConfigDict(from_attributes=True)


# Context Data related schemas (naming preserved for API compatibility)
class ContextDataElement(BaseModel):
    """Element for data field operations"""

    key: str = Field(..., description="Key name of the data item")
    content: Any = Field(
        ...,
        description="Content of the data item, can be any JSON object structure (dict, list, str, int, float, bool, etc.)",
    )


class ContextDataCreate(BaseModel):
    """Request to create data in the data field"""

    mounted_json_pointer_path: str = Field(
        ...,
        description='JSON pointer path where data will be mounted. Uses RFC 6901 format (e.g., "/users", "/users/123"). Use empty string "" to add keys at the root of data',
    )
    elements: list[ContextDataElement] = Field(..., description="Array of elements to create")


class ContextDataUpdate(BaseModel):
    """Request to update data in the data field"""

    json_pointer_path: str = Field(
        ...,
        description='JSON pointer path. Uses RFC 6901 format (e.g., "/users", "/users/123"). Use empty string "" to update keys at the root of data',
    )
    elements: list[ContextDataElement] = Field(..., description="Array of elements to update")


class ContextDataDelete(BaseModel):
    """Request to delete data in the data field"""

    json_pointer_path: str = Field(
        ...,
        description='JSON pointer path. Uses RFC 6901 format (e.g., "/users", "/users/123"). Use empty string "" to delete keys at the root of data',
    )
    keys: list[str] = Field(..., description="List of keys to delete")


class ContextDataGet(BaseModel):
    """Response for getting data field data"""

    data: Any = Field(
        ...,
        description="Retrieved JSON data, can be any type (dict, list, str, int, float, bool, etc.)",
    )


class ProjectWithTables(BaseModel):
    """Response model containing project info and all its tables"""

    id: str = Field(..., description="Project ID (UUID)")
    name: str | None = Field(None, description="Project name")
    description: str | None = Field(None, description="Project description")
    org_id: str | None = Field(None, description="Organization ID")
    created_by: str | None = Field(None, description="Creator user ID")
    created_at: datetime = Field(..., description="Creation time")
    tables: list[TableOut] = Field(
        default_factory=list, description="List of all tables under this project"
    )

    model_config = ConfigDict(from_attributes=True)
