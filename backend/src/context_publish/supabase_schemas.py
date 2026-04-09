"""
Context Publish Data Models

Defines Pydantic models corresponding to the public.context_publish table.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ContextPublishBase(BaseModel):
    created_by: str | None = None
    table_id: str | None = None
    json_path: str | None = None
    publish_key: str | None = None
    status: bool | None = None
    expires_at: datetime | None = None


class ContextPublishCreate(ContextPublishBase):
    pass


class ContextPublishUpdate(BaseModel):
    status: bool | None = None
    expires_at: datetime | None = None


class ContextPublishResponse(ContextPublishBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
