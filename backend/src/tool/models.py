from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class Tool(BaseModel):
    id: int
    created_at: datetime

    user_id: str
    table_id: Optional[int] = None
    json_path: str = ""

    type: str
    name: str
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = Field(default=None, description="JSON Schema (input)")
    output_schema: Optional[Any] = Field(default=None, description="JSON Schema (output)")
    metadata: Optional[Any] = Field(default=None, description="扩展配置")


