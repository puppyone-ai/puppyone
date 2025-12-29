from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class McpV2Instance(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime

    user_id: str
    name: Optional[str] = None
    api_key: str
    status: bool = Field(default=False, description="是否启用")


