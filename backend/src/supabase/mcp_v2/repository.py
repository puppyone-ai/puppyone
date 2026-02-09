"""
MCP v2 数据访问层

提供针对 public.mcp 表的增删改查操作。
"""

from __future__ import annotations

from typing import List, Optional

from supabase import Client

from src.supabase.exceptions import handle_supabase_error
from src.supabase.mcp_v2.schemas import McpV2Create, McpV2Update, McpV2Response


class McpV2Repository:
    def __init__(self, client: Client):
        self._client = client

    def create(self, data: McpV2Create) -> McpV2Response:
        try:
            payload = data.model_dump(exclude_none=True)
            payload.pop("id", None)
            payload.pop("created_at", None)
            payload.pop("updated_at", None)
            response = self._client.table("mcp").insert(payload).execute()
            return McpV2Response(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建 MCP v2")

    def get_by_id(self, mcp_id: int) -> Optional[McpV2Response]:
        response = self._client.table("mcp").select("*").eq("id", mcp_id).execute()
        if response.data:
            return McpV2Response(**response.data[0])
        return None

    def get_by_api_key(self, api_key: str) -> Optional[McpV2Response]:
        response = (
            self._client.table("mcp").select("*").eq("api_key", api_key).execute()
        )
        if response.data:
            return McpV2Response(**response.data[0])
        return None

    def get_list(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[str] = None,
    ) -> List[McpV2Response]:
        query = self._client.table("mcp").select("*")
        if user_id is not None:
            query = query.eq("user_id", user_id)
        response = query.range(skip, skip + limit - 1).execute()
        return [McpV2Response(**item) for item in response.data]

    def update(self, mcp_id: int, data: McpV2Update) -> Optional[McpV2Response]:
        try:
            payload = data.model_dump(exclude_none=True)
            if not payload:
                return self.get_by_id(mcp_id)
            payload.pop("id", None)
            payload.pop("created_at", None)
            payload.pop("updated_at", None)
            response = (
                self._client.table("mcp").update(payload).eq("id", mcp_id).execute()
            )
            if response.data:
                return McpV2Response(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新 MCP v2")

    def delete(self, mcp_id: int) -> bool:
        response = self._client.table("mcp").delete().eq("id", mcp_id).execute()
        return len(response.data) > 0
