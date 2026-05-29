"""FastAPI dependencies for import jobs."""

from __future__ import annotations

from fastapi import Depends

from src.platform.imports.arq_client import ImportArqClient
from src.platform.imports.repository import ImportJobRepository
from src.platform.imports.service import ImportJobService
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

_import_repo: ImportJobRepository | None = None
_import_arq_client: ImportArqClient | None = None
_import_service: ImportJobService | None = None


def get_import_job_repository() -> ImportJobRepository:
    global _import_repo
    if _import_repo is None:
        _import_repo = ImportJobRepository()
    return _import_repo


def get_import_arq_client() -> ImportArqClient:
    global _import_arq_client
    if _import_arq_client is None:
        _import_arq_client = ImportArqClient()
    return _import_arq_client


def get_import_job_service(
    project_service: ProjectService = Depends(get_project_service),
) -> ImportJobService:
    global _import_service
    if _import_service is None:
        _import_service = ImportJobService(
            repo=get_import_job_repository(),
            project_service=project_service,
            arq_client=get_import_arq_client(),
        )
    return _import_service
