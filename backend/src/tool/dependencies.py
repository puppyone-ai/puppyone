from __future__ import annotations

from src.infra.supabase.dependencies import get_supabase_repository
from src.version_engine.bootstrap.dependencies import build_worker_version_engine_container
from src.platform.project.dependencies import get_project_service
from src.tool.repository import ToolRepositorySupabase
from src.tool.service import ToolService

_tool_service: ToolService | None = None


def get_tool_service() -> ToolService:
    global _tool_service
    if _tool_service is None:
        repo = ToolRepositorySupabase(get_supabase_repository())
        ops = build_worker_version_engine_container().product_operations()
        project_service = get_project_service()
        _tool_service = ToolService(
            repo=repo,
            ops=ops,
            project_service=project_service,
        )
    return _tool_service
