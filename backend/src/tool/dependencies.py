from __future__ import annotations

from src.infra.supabase.dependencies import get_supabase_repository
from src.tool.repository import ToolRepositorySupabase
from src.tool.service import ToolService
from src.mut_engine.dependencies import create_tree_reader
from src.platform.project.dependencies import get_project_service


_tool_service: ToolService | None = None


def get_tool_service() -> ToolService:
    global _tool_service
    if _tool_service is None:
        repo = ToolRepositorySupabase(get_supabase_repository())
        tree_reader = create_tree_reader()
        project_service = get_project_service()
        _tool_service = ToolService(
            repo=repo,
            tree_reader=tree_reader,
            project_service=project_service,
        )
    return _tool_service
