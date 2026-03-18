from __future__ import annotations

import datetime as dt
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


SearchIndexStatus = Literal["pending", "indexing", "ready", "error"]


class SearchIndexTask(BaseModel):
    id: int
    created_at: dt.datetime
    updated_at: dt.datetime

    tool_id: str
    user_id: Optional[str] = None
    project_id: Optional[str] = None
    node_id: str  # 绑定的 content_nodes 节点 ID
    json_path: str = ""

    status: SearchIndexStatus = "pending"
    started_at: Optional[dt.datetime] = None
    finished_at: Optional[dt.datetime] = None

    nodes_count: Optional[int] = None
    chunks_count: Optional[int] = None
    indexed_chunks_count: Optional[int] = None

    last_error: Optional[str] = None

    # Folder search specific fields
    folder_node_id: Optional[str] = None  # The folder node_id when this is a folder search
    total_files: Optional[int] = None  # Total indexable files in folder
    indexed_files: Optional[int] = None  # Number of files indexed so far


class SearchIndexTaskUpsert(BaseModel):
    tool_id: str
    user_id: Optional[str] = None
    project_id: Optional[str] = None
    node_id: str  # 绑定的 content_nodes 节点 ID
    json_path: str = ""

    status: SearchIndexStatus = "pending"
    started_at: Optional[dt.datetime] = None
    finished_at: Optional[dt.datetime] = None

    nodes_count: Optional[int] = None
    chunks_count: Optional[int] = None
    indexed_chunks_count: Optional[int] = None

    last_error: Optional[str] = None

    # Folder search specific fields
    folder_node_id: Optional[str] = None  # The folder node_id when this is a folder search
    total_files: Optional[int] = None  # Total indexable files in folder
    indexed_files: Optional[int] = None  # Number of files indexed so far

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
    tool_id: str = Field(..., description="Search Tool ID (UUID)")
    status: SearchIndexStatus
    started_at: Optional[dt.datetime] = None
    finished_at: Optional[dt.datetime] = None
    nodes_count: Optional[int] = None
    chunks_count: Optional[int] = None
    indexed_chunks_count: Optional[int] = None
    last_error: Optional[str] = None
    # Folder search specific fields
    folder_node_id: Optional[str] = Field(None, description="Folder node_id if this is a folder search")
    total_files: Optional[int] = Field(None, description="Total indexable files in folder")
    indexed_files: Optional[int] = Field(None, description="Number of files indexed so far")
