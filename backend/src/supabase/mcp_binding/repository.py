"""
MCP Binding 数据访问层

提供针对 public.mcp_binding 表的增删改查操作。
"""

from __future__ import annotations

from typing import List, Optional

from supabase import Client

from src.supabase.exceptions import handle_supabase_error
from src.supabase.mcp_binding.schemas import (
    McpBindingCreate,
    McpBindingUpdate,
    McpBindingResponse,
)


class McpBindingRepository:
    def __init__(self, client: Client):
        self._client = client

    def create(self, data: McpBindingCreate) -> McpBindingResponse:
        try:
            payload = data.model_dump(exclude_none=True)
            payload.pop("id", None)
            payload.pop("created_at", None)
            response = self._client.table("mcp_binding").insert(payload).execute()
            return McpBindingResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建 MCP Binding")

    def get_by_id(self, binding_id: int) -> Optional[McpBindingResponse]:
        response = (
            self._client.table("mcp_binding").select("*").eq("id", binding_id).execute()
        )
        if response.data:
            return McpBindingResponse(**response.data[0])
        return None

    def get_by_mcp_and_tool(
        self, mcp_id: int, tool_id: int
    ) -> Optional[McpBindingResponse]:
        response = (
            self._client.table("mcp_binding")
            .select("*")
            .eq("mcp_id", mcp_id)
            .eq("tool_id", tool_id)
            .execute()
        )
        if response.data:
            return McpBindingResponse(**response.data[0])
        return None

    def get_list_by_mcp_id(
        self,
        mcp_id: int,
        *,
        skip: int = 0,
        limit: int = 1000,
    ) -> List[McpBindingResponse]:
        response = (
            self._client.table("mcp_binding")
            .select("*")
            .eq("mcp_id", mcp_id)
            .range(skip, skip + limit - 1)
            .execute()
        )
        return [McpBindingResponse(**item) for item in response.data]

    def get_list_by_tool_id(
        self,
        tool_id: int,
        *,
        skip: int = 0,
        limit: int = 1000,
    ) -> List[McpBindingResponse]:
        response = (
            self._client.table("mcp_binding")
            .select("*")
            .eq("tool_id", tool_id)
            .range(skip, skip + limit - 1)
            .execute()
        )
        return [McpBindingResponse(**item) for item in response.data]

    def update(
        self, binding_id: int, data: McpBindingUpdate
    ) -> Optional[McpBindingResponse]:
        try:
            payload = data.model_dump(exclude_none=True)
            if not payload:
                return self.get_by_id(binding_id)
            response = (
                self._client.table("mcp_binding")
                .update(payload)
                .eq("id", binding_id)
                .execute()
            )
            if response.data:
                return McpBindingResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新 MCP Binding")

    def delete(self, binding_id: int) -> bool:
        response = (
            self._client.table("mcp_binding").delete().eq("id", binding_id).execute()
        )
        return len(response.data) > 0
