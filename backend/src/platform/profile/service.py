"""
Profile Service

Handles user Profile business logic
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.platform.profile.models import Profile, ProfileUpdate
from src.platform.profile.repository import ProfileRepositorySupabase
from src.platform.project.service import ProjectService
from src.utils.logger import log_error, log_info

if TYPE_CHECKING:
    from src.platform.auth.initialization import UserInitializationService


class ProfileService:
    """Profile business service"""

    def __init__(
        self,
        profile_repository: ProfileRepositorySupabase,
        initialization_service: UserInitializationService | None = None,
        project_service: ProjectService | None = None,
    ):
        self._profile_repo = profile_repository
        self._init_service = initialization_service
        self._project_service = project_service

    def get_profile(self, user_id: str) -> Profile | None:
        return self._profile_repo.get_by_user_id(user_id)

    def update_profile(self, user_id: str, data: ProfileUpdate) -> Profile | None:
        return self._profile_repo.update(user_id, data)

    def _resolve_profile(self, user_id: str, email: str | None = None) -> Profile | None:
        if email:
            return self._profile_repo.get_or_create(user_id, email)
        return self._profile_repo.get_by_user_id(user_id)

    def _try_ensure_initialized(self, user_id: str, email: str, display_name: str | None) -> None:
        if not self._init_service:
            return
        try:
            self._init_service.ensure_initialized(
                user_id=user_id, email=email, display_name=display_name,
            )
        except Exception as e:
            log_error(f"User initialization failed for {user_id}: {e}")
