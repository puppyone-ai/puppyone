"""
User Initialization Service

Idempotently ensures new users have a complete profile + organization + membership.
The trigger only creates the profile; the rest is handled by this service at the application layer.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.utils.logger import log_error, log_info

if TYPE_CHECKING:
    from src.platform.organization.repository import OrganizationRepository
    from src.platform.profile.repository import ProfileRepositorySupabase


class UserInitializationService:
    """Idempotent user initialization: produces the same result regardless of how many times it is called."""

    def __init__(
        self,
        profile_repo: ProfileRepositorySupabase,
        org_repo: OrganizationRepository,
    ):
        self._profile_repo = profile_repo
        self._org_repo = org_repo

    def ensure_initialized(
        self,
        user_id: str,
        email: str,
        display_name: str | None = None,
    ) -> dict:
        """
        Ensure user has profile + default org + membership.

        Returns:
            {"org_id": str, "is_new_org": bool}
        """
        name = display_name or (email.split("@")[0] if email else "User")

        # 1. Ensure profile exists (trigger usually creates it; this is a safety net)
        profile = self._profile_repo.get_or_create(user_id, email)
        if not profile:
            log_error(f"Failed to get/create profile for user {user_id}")
            raise RuntimeError(f"Cannot initialize user {user_id}: profile creation failed")

        # 2. Ensure at least one organization exists
        orgs = self._org_repo.list_by_user(user_id)
        is_new_org = False

        if not orgs:
            org = self._create_default_org(user_id, name)
            is_new_org = True
            log_info(f"Created default org {org.id} for user {user_id}")
        else:
            org = orgs[0]

        # 3. Ensure profile.default_org_id is set
        if not profile.default_org_id:
            from src.platform.profile.models import ProfileUpdate
            self._profile_repo.update(
                user_id,
                ProfileUpdate(default_org_id=org.id),
            )
            log_info(f"Set default_org_id={org.id} for user {user_id}")

        return {"org_id": org.id, "is_new_org": is_new_org}

    def _create_default_org(self, user_id: str, name: str):
        slug = f"personal-{user_id}"

        org = self._org_repo.create(
            name=f"{name}'s Workspace",
            slug=slug,
            created_by=user_id,
        )

        self._org_repo.add_member(
            org_id=org.id,
            user_id=user_id,
            role="owner",
        )

        return org
