"""
Tool data access layer

Provides CRUD operations for the public.tool table.
"""

from __future__ import annotations

from typing import List, Optional

from supabase import Client

from src.infra.supabase.exceptions import handle_supabase_error
from src.tool.supabase_schemas import ToolCreate, ToolUpdate, ToolResponse
from src.utils.id_generator import generate_uuid_v7


class ToolRepository:
    """Tool data access repository"""

    def __init__(self, client: Client):
        self._client = client

    def create(self, tool_data: ToolCreate) -> ToolResponse:
        try:
            data = tool_data.model_dump(exclude_none=True)
            data.pop("id", None)
            data.pop("created_at", None)
            # Generate UUID v7 as primary key
            data["id"] = generate_uuid_v7()
            response = self._client.table("tools").insert(data).execute()
            return ToolResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "create Tool")

    def get_by_id(self, tool_id: str) -> Optional[ToolResponse]:
        response = self._client.table("tools").select("*").eq("id", tool_id).execute()
        if response.data:
            return ToolResponse(**response.data[0])
        return None

    def get_list(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        org_id: Optional[str] = None,
        path: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> List[ToolResponse]:
        query = self._client.table("tools").select("*")
        if org_id is not None:
            query = query.eq("org_id", org_id)
        if path is not None:
            query = query.eq("path", path)
        if project_id is not None:
            query = query.eq("project_id", project_id)
        response = query.range(skip, skip + limit - 1).execute()
        return [ToolResponse(**item) for item in response.data]

    def update(self, tool_id: str, tool_data: ToolUpdate) -> Optional[ToolResponse]:
        try:
            data = tool_data.model_dump(exclude_none=True)
            if not data:
                return self.get_by_id(tool_id)
            data.pop("id", None)
            data.pop("created_at", None)
            response = (
                self._client.table("tools").update(data).eq("id", tool_id).execute()
            )
            if response.data:
                return ToolResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "update Tool")

    def delete(self, tool_id: str) -> bool:
        response = self._client.table("tools").delete().eq("id", tool_id).execute()
        return len(response.data) > 0
