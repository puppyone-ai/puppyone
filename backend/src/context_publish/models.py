from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ContextPublish(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None = None
    table_id: str
    json_path: str
    publish_key: str
    status: bool
    expires_at: datetime
