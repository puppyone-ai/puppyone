from __future__ import annotations

from fastapi import Depends

from src.platform.authorization.dependencies import get_authorization_service
from src.platform.authorization.service import AuthorizationService
from src.platform.project.dependencies import get_project_repository
from src.platform.project.repository import ProjectRepositoryBase
from src.platform.workspace_binding.repository import WorkspaceBindingRepository
from src.platform.workspace_binding.service import WorkspaceBindingService


def get_workspace_binding_repository() -> WorkspaceBindingRepository:
    return WorkspaceBindingRepository()


def get_workspace_binding_service(
    repository: WorkspaceBindingRepository = Depends(get_workspace_binding_repository),
    authorization: AuthorizationService = Depends(get_authorization_service),
    project_repository: ProjectRepositoryBase = Depends(get_project_repository),
) -> WorkspaceBindingService:
    return WorkspaceBindingService(repository, authorization, project_repository)
