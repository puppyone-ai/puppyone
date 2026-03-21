"""DB Connector 依赖注入"""

from fastapi import Depends
from src.infra.supabase.client import SupabaseClient
from src.connectors.database.repository import DBConnectionRepository
from src.connectors.database.service import DBConnectorService
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


def get_db_connection_repository(
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> DBConnectionRepository:
    return DBConnectionRepository(supabase)


def get_db_connector_service(
    repo: DBConnectionRepository = Depends(get_db_connection_repository),
    project_service: ProjectService = Depends(get_project_service),
) -> DBConnectorService:
    return DBConnectorService(repo, project_service)
