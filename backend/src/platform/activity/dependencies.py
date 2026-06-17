"""FastAPI dependencies for the context-activity feed."""

from __future__ import annotations

from fastapi import Depends

from src.platform.activity.repository import ActivityRepository
from src.platform.activity.service import ActivityService
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

_activity_repo: ActivityRepository | None = None
_activity_service: ActivityService | None = None


def get_activity_repository() -> ActivityRepository:
    global _activity_repo
    if _activity_repo is None:
        _activity_repo = ActivityRepository()
    return _activity_repo


def get_activity_service(
    project_service: ProjectService = Depends(get_project_service),
) -> ActivityService:
    global _activity_service
    if _activity_service is None:
        _activity_service = ActivityService(
            repo=get_activity_repository(),
            project_service=project_service,
        )
    return _activity_service
