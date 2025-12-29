from __future__ import annotations

from src.supabase.dependencies import get_supabase_repository
from src.tool.repository import ToolRepositorySupabase
from src.tool.service import ToolService
from src.table.dependencies import get_table_service


_tool_service: ToolService | None = None


def get_tool_service() -> ToolService:
    global _tool_service
    if _tool_service is None:
        repo = ToolRepositorySupabase(get_supabase_repository())
        table_service = get_table_service()
        _tool_service = ToolService(repo=repo, table_service=table_service)
    return _tool_service


