from __future__ import annotations

import datetime as dt
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


SearchIndexStatus = Literal["pending", "indexing", "ready", "error"]


class SearchIndexTask(BaseModel):
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime

    tool_id: int
    user_id: Optional[str] = None
    project_id: Optional[int] = None
    table_id: int
    json_path: str = ""

    status: SearchIndexStatus = "pending"
    started_at: Optional[dt.datetime] = None
    finished_at: Optional[dt.datetime] = None

    nodes_count: Optional[int] = None
    chunks_count: Optional[int] = None
    indexed_chunks_count: Optional[int] = None

    last_error: Optional[str] = None


class SearchIndexTaskUpsert(BaseModel):
    tool_id: int
    user_id: Optional[str] = None
    project_id: Optional[int] = None
    table_id: int
    json_path: str = ""

    status: SearchIndexStatus = "pending"
    started_at: Optional[dt.datetime] = None
    finished_at: Optional[dt.datetime] = None

    nodes_count: Optional[int] = None
    chunks_count: Optional[int] = None
    indexed_chunks_count: Optional[int] = None

    last_error: Optional[str] = None

    def to_db(self) -> dict[str, Any]:
        # Supabase expects ISO strings for timestamps
        d = self.model_dump(exclude_none=True)
        for k in ("started_at", "finished_at"):
            if k in d and isinstance(d[k], dt.datetime):
                d[k] = d[k].isoformat()
        # updated_at 由应用层维护（没有触发器时更可靠）
        d["updated_at"] = dt.datetime.now(tz=dt.timezone.utc).isoformat()
        return d


class SearchIndexTaskOut(BaseModel):
    tool_id: int = Field(..., description="Search Tool ID")
    status: SearchIndexStatus
    started_at: Optional[dt.datetime] = None
    finished_at: Optional[dt.datetime] = None
    nodes_count: Optional[int] = None
    chunks_count: Optional[int] = None
    indexed_chunks_count: Optional[int] = None
    last_error: Optional[str] = None
