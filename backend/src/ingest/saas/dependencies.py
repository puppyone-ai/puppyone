"""
Import Module Dependencies - FastAPI dependency injection.
"""

from src.ingest.saas.service import ImportService
from src.ingest.saas.task.manager import ImportTaskManager
from src.ingest.saas.task.repository import ImportTaskRepository
from src.ingest.saas.arq_client import get_import_arq_client


async def get_import_service() -> ImportService:
    """Get ImportService instance."""
    task_repository = ImportTaskRepository()
    task_manager = ImportTaskManager(task_repository)
    arq_client = await get_import_arq_client()
    arq_pool = await arq_client.get_pool()
    
    return ImportService(
        task_manager=task_manager,
        arq_pool=arq_pool,
    )
