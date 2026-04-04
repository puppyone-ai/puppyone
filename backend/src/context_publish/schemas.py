from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class PublishCreate(BaseModel):
    table_id: str = Field(..., description="Target table_id (UUID)")
    json_path: str = Field(default="", description="JSON Pointer path")
    expires_at: datetime | None = Field(
        default=None, description="Optional expiration time; defaults to 7 days if not provided"
    )


class PublishUpdate(BaseModel):
    status: bool | None = Field(default=None, description="Enable/disable (revoke)")
    expires_at: datetime | None = Field(default=None, description="Update expiration time")


class PublishOut(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None = None
    table_id: str
    json_path: str
    publish_key: str
    status: bool
    expires_at: datetime
    url: str
