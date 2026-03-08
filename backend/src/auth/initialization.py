"""
User Initialization Service

幂等地确保新用户拥有完整的 profile + organization + membership。
触发器只创建 profile，其余由本服务在应用层完成。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from src.utils.logger import log_info, log_error

if TYPE_CHECKING:
    from src.organization.repository import OrganizationRepository
    from src.profile.repository import ProfileRepositorySupabase


class UserInitializationService:
    """幂等用户初始化：无论调用多少次，结果一致。"""

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
        display_name: Optional[str] = None,
    ) -> dict:
        """
        确保用户拥有 profile + default org + membership。

        Returns:
            {"org_id": str, "is_new_org": bool}
        """
        name = display_name or (email.split("@")[0] if email else "User")

        # 1. 确保 profile 存在（触发器通常已创建，这是兜底）
        profile = self._profile_repo.get_or_create(user_id, email)
        if not profile:
            log_error(f"Failed to get/create profile for user {user_id}")
            raise RuntimeError(f"Cannot initialize user {user_id}: profile creation failed")

        # 2. 确保有至少一个 organization
        orgs = self._org_repo.list_by_user(user_id)
        is_new_org = False

        if not orgs:
            org = self._create_default_org(user_id, name)
            is_new_org = True
            log_info(f"Created default org {org.id} for user {user_id}")
        else:
            org = orgs[0]

        # 3. 确保 profile.default_org_id 已设置
        if not profile.default_org_id:
            from src.profile.models import ProfileUpdate
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
