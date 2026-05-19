from fastapi import Depends, Path

from src.content.table.models import Table
from src.content.table.repository import TableRepositorySupabase
from src.content.table.service import TableService
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser

_table_repository = None
_table_service = None


def get_table_repository() -> TableRepositorySupabase:
    global _table_repository
    if _table_repository is None:
        _table_repository = TableRepositorySupabase()
    return _table_repository


def get_table_service() -> TableService:
    global _table_service
    if _table_service is None:
        from src.version_engine.bootstrap.dependencies import build_worker_version_engine_container

        repo = get_table_repository()
        repo_manager = build_worker_version_engine_container().repo_manager

        _table_service = TableService(
            repo=repo,
            repo_manager=repo_manager,
        )
    return _table_service


def get_verified_table(
    table_id: str = Path(..., description="Table ID (UUID)"),
    table_service: TableService = Depends(get_table_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> Table:
    return table_service.get_by_id_with_access_check(table_id, current_user.user_id)
