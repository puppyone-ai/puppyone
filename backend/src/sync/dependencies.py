"""
Sync Module — Dependency injection for folder sync and SaaS import.
"""

from fastapi import Depends
from src.supabase.client import SupabaseClient
from src.sync.repository import SyncSourceRepository, NodeSyncRepository
from src.sync.service import SyncService
from src.sync.handlers.folder_source import FolderSourceService
from src.sync.import_service import ImportService
from src.sync.task.manager import ImportTaskManager
from src.sync.task.repository import ImportTaskRepository
from src.sync.arq_client import get_import_arq_client
from src.collaboration.dependencies import get_collaboration_service
from src.collaboration.service import CollaborationService
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


def get_sync_service(
    collab_service: CollaborationService = Depends(get_collaboration_service),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> SyncService:
    svc = SyncService(
        collab_service=collab_service,
        source_repo=SyncSourceRepository(supabase),
        node_sync_repo=NodeSyncRepository(supabase),
    )
    return svc


def get_folder_source_service(
    node_service: ContentNodeService = Depends(get_content_node_service),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> FolderSourceService:
    """Get FolderSourceService for local folder collection."""
    return FolderSourceService(
        node_service=node_service,
        source_repo=SyncSourceRepository(supabase),
        node_sync_repo=NodeSyncRepository(supabase),
    )


async def get_import_service() -> ImportService:
    """Get ImportService instance for SaaS/URL imports."""
    task_repository = ImportTaskRepository()
    task_manager = ImportTaskManager(task_repository)
    arq_client = await get_import_arq_client()
    arq_pool = await arq_client.get_pool()

    return ImportService(
        task_manager=task_manager,
        arq_pool=arq_pool,
    )
