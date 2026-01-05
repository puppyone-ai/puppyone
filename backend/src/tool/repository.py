from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional, List

from src.supabase.repository import SupabaseRepository
from src.supabase.tools.schemas import (
    ToolCreate as SbToolCreate,
    ToolUpdate as SbToolUpdate,
)
from src.tool.models import Tool


class ToolRepositoryBase(ABC):
    @abstractmethod
    def create(self, tool: SbToolCreate) -> Tool:
        pass

    @abstractmethod
    def get_by_id(self, tool_id: int) -> Optional[Tool]:
        pass

    @abstractmethod
    def get_by_user_id(
        self,
        user_id: str,
        *,
        skip: int = 0,
        limit: int = 100,
        table_id: Optional[int] = None,
    ) -> List[Tool]:
        pass

    @abstractmethod
    def update(self, tool_id: int, tool: SbToolUpdate) -> Optional[Tool]:
        pass

    @abstractmethod
    def delete(self, tool_id: int) -> bool:
        pass


class ToolRepositorySupabase(ToolRepositoryBase):
    def __init__(self, supabase_repo: SupabaseRepository):
        self._repo = supabase_repo

    def _to_model(self, resp) -> Tool:
        return Tool(
            id=resp.id,
            created_at=resp.created_at,
            user_id=str(resp.user_id) if resp.user_id else "",
            table_id=resp.table_id,
            json_path=resp.json_path or "",
            type=resp.type or "",
            name=resp.name or "",
            alias=resp.alias,
            description=resp.description,
            input_schema=resp.input_schema,
            output_schema=resp.output_schema,
            metadata=resp.metadata,
        )

    def create(self, tool: SbToolCreate) -> Tool:
        resp = self._repo.create_tool(tool)
        return self._to_model(resp)

    def get_by_id(self, tool_id: int) -> Optional[Tool]:
        resp = self._repo.get_tool(tool_id)
        if not resp:
            return None
        return self._to_model(resp)

    def get_by_user_id(
        self,
        user_id: str,
        *,
        skip: int = 0,
        limit: int = 100,
        table_id: Optional[int] = None,
    ) -> List[Tool]:
        resps = self._repo.get_tools(
            skip=skip, limit=limit, user_id=user_id, table_id=table_id
        )
        return [self._to_model(r) for r in resps]

    def update(self, tool_id: int, tool: SbToolUpdate) -> Optional[Tool]:
        resp = self._repo.update_tool(tool_id, tool)
        if not resp:
            return None
        return self._to_model(resp)

    def delete(self, tool_id: int) -> bool:
        return self._repo.delete_tool(tool_id)
