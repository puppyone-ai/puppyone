from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ContextPublish(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime
    user_id: str
    table_id: int
    json_path: str
    publish_key: str
    status: bool
    expires_at: datetime


