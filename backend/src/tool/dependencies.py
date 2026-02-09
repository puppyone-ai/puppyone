from __future__ import annotations

from src.supabase.dependencies import get_supabase_repository
from src.supabase.client import SupabaseClient
from src.tool.repository import ToolRepositorySupabase
from src.tool.service import ToolService
from src.content_node.repository import ContentNodeRepository
from src.content_node.service import ContentNodeService
from src.s3.dependencies import get_s3_service
from src.project.dependencies import get_project_service


_tool_service: ToolService | None = None


def get_tool_service() -> ToolService:
    global _tool_service
    if _tool_service is None:
        repo = ToolRepositorySupabase(get_supabase_repository())
        # 创建 ContentNodeService
        sb_client = SupabaseClient()
        node_repo = ContentNodeRepository(sb_client)
        s3_service = get_s3_service()
        node_service = ContentNodeService(node_repo, s3_service)
        project_service = get_project_service()
        _tool_service = ToolService(
            repo=repo,
            node_service=node_service,
            project_service=project_service,
        )
    return _tool_service
