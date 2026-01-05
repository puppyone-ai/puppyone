from __future__ import annotations

from src.context_publish.repository import ContextPublishRepositorySupabase
from src.context_publish.service import ContextPublishService
from src.supabase.dependencies import get_supabase_repository
from src.table.dependencies import get_table_service


_publish_service: ContextPublishService | None = None


def get_context_publish_service() -> ContextPublishService:
    global _publish_service
    if _publish_service is None:
        repo = ContextPublishRepositorySupabase(get_supabase_repository())
        table_service = get_table_service()
        _publish_service = ContextPublishService(repo=repo, table_service=table_service)
    return _publish_service
