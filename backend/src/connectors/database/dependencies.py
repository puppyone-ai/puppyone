"""DB Connector 依赖注入"""

from fastapi import Depends
from src.infra.supabase.client import SupabaseClient
from src.content.dependencies import get_content_node_service
from src.content.service import ContentNodeService
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
    node_service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
) -> DBConnectorService:
    return DBConnectorService(repo, node_service, project_service)
