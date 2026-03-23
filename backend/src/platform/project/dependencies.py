"""
Project Dependency Injection
"""

from fastapi import Depends, Path
from src.platform.project.repository import ProjectRepositorySupabase
from src.platform.project.service import ProjectService
from src.platform.project.models import Project
from src.platform.auth.models import CurrentUser
from src.platform.auth.dependencies import get_current_user


# Use global variables for singletons instead of creating new instances each time
# This avoids redundant initialization and improves performance
_project_repository = None
_project_service = None


def get_project_repository() -> ProjectRepositorySupabase:
    """
    Get project repository singleton

    Returns:
        ProjectRepositorySupabase instance
    """
    global _project_repository
    if _project_repository is None:
        _project_repository = ProjectRepositorySupabase()
    return _project_repository


def get_project_service() -> ProjectService:
    """
    Dependency injection factory for project_service. Uses Supabase as the storage backend

    Returns:
        ProjectService singleton
    """
    global _project_service
    if _project_service is None:
        _project_service = ProjectService(get_project_repository())
    return _project_service


def get_verified_project(
    project_id: str = Path(..., description="Project ID (UUID)"),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> Project:
    """
    Dependency injection function: get and verify user access to the project

    Verifies whether the user belongs to the project's organization via the org_members table.

    Args:
        project_id: Project ID (from path parameter)
        project_service: ProjectService instance (via dependency injection)
        current_user: Current user (via dependency injection)

    Returns:
        Verified Project object

    Raises:
        NotFoundException: If project does not exist or user has no access
    """
    return project_service.get_by_id_with_access_check(project_id, current_user.user_id)
