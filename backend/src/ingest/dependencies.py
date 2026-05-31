"""
Ingest Module Dependencies - FastAPI dependency injection.
"""

from typing import Annotated

from fastapi import Depends

from src.ingest.file.dependencies import get_etl_service
from src.ingest.service import IngestService
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService


def get_ingest_service(
    file_service=Depends(get_etl_service),
    project_service: ProjectService = Depends(get_project_service),
) -> IngestService:
    """Get IngestService instance (file-only)."""
    return IngestService(file_service=file_service, project_service=project_service)


IngestServiceDep = Annotated[IngestService, Depends(get_ingest_service)]
