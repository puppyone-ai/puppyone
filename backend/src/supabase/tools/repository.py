"""
Tool 数据访问层

提供针对 public.tool 表的增删改查操作。
"""

from __future__ import annotations

from typing import List, Optional

from supabase import Client

from src.supabase.exceptions import handle_supabase_error
from src.supabase.tools.schemas import ToolCreate, ToolUpdate, ToolResponse


class ToolRepository:
    """Tool 数据访问仓库"""

    def __init__(self, client: Client):
        self._client = client

    def create(self, tool_data: ToolCreate) -> ToolResponse:
        try:
            data = tool_data.model_dump(exclude_none=True)
            data.pop("id", None)
            data.pop("created_at", None)
            response = self._client.table("tool").insert(data).execute()
            return ToolResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建 Tool")

    def get_by_id(self, tool_id: int) -> Optional[ToolResponse]:
        response = self._client.table("tool").select("*").eq("id", tool_id).execute()
        if response.data:
            return ToolResponse(**response.data[0])
        return None

    def get_list(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[str] = None,
        table_id: Optional[int] = None,
    ) -> List[ToolResponse]:
        query = self._client.table("tool").select("*")
        if user_id is not None:
            query = query.eq("user_id", user_id)
        if table_id is not None:
            query = query.eq("table_id", table_id)
        response = query.range(skip, skip + limit - 1).execute()
        return [ToolResponse(**item) for item in response.data]

    def update(self, tool_id: int, tool_data: ToolUpdate) -> Optional[ToolResponse]:
        try:
            data = tool_data.model_dump(exclude_none=True)
            if not data:
                return self.get_by_id(tool_id)
            data.pop("id", None)
            data.pop("created_at", None)
            response = (
                self._client.table("tool").update(data).eq("id", tool_id).execute()
            )
            if response.data:
                return ToolResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新 Tool")

    def delete(self, tool_id: int) -> bool:
        response = self._client.table("tool").delete().eq("id", tool_id).execute()
        return len(response.data) > 0


