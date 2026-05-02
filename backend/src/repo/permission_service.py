"""Per-user-per-repo permission resolution + CRUD.

Resolution rule (the heart of this module):
  1. If repo_user_permissions row exists for (project_id, user_id):
       - role='denied'  → ResolvedPermission(role='denied', source='explicit')
       - else           → ResolvedPermission(role=<that>,  source='explicit')
  2. Else if user is an org_member of the project's org:
       - ResolvedPermission(role='editor',
                             source='inherited_org',
                             allowed_scope_ids=None)
  3. Else:
       - ResolvedPermission(role='denied',
                             source='no_org_member',
                             allowed_scope_ids=None)

This is the single function that all other code paths call to ask "can
user X do Y on project Z scope W". It's the replacement for the
ad-hoc verify_project_access calls scattered today.
"""

from __future__ import annotations

from typing import Optional

from src.exceptions import AppException
from src.platform.organization.repository import OrganizationRepository
from src.platform.project.repository import ProjectRepositorySupabase
from src.repo.models import RepoUserPermission, ResolvedPermission
from src.repo.permission_repository import RepoUserPermissionRepository


class PermissionService:
    def __init__(
        self,
        permission_repo: Optional[RepoUserPermissionRepository] = None,
        project_repo: Optional[ProjectRepositorySupabase] = None,
        org_repo: Optional[OrganizationRepository] = None,
    ):
        self._perm = permission_repo or RepoUserPermissionRepository()
        self._proj = project_repo or ProjectRepositorySupabase()
        self._org = org_repo or OrganizationRepository()

    # ── Resolution ───────────────────────────────────────────────────────

    def resolve(self, project_id: str, user_id: str) -> ResolvedPermission:
        explicit = self._perm.get(project_id, user_id)
        if explicit is not None:
            return ResolvedPermission(
                role=explicit.role,
                source="explicit",
                allowed_scope_ids=explicit.allowed_scope_ids,
            )

        # Fallback: org_members.
        # ProjectRepositorySupabase.verify_project_access already does the
        # "user is in this project's org" lookup. Reuse it.
        role = self._proj.verify_project_access(project_id, user_id)
        if role is not None:
            # Org membership maps to 'editor' as the implicit role.
            return ResolvedPermission(
                role="editor",
                source="inherited_org",
                allowed_scope_ids=None,
            )

        return ResolvedPermission(
            role="denied",
            source="no_org_member",
            allowed_scope_ids=None,
        )

    def check(
        self, project_id: str, user_id: str, action: str,
        *, scope_id: Optional[str] = None,
    ) -> tuple[bool, str]:
        """Convenience check used by the router-level /check endpoint."""
        resolved = self.resolve(project_id, user_id)

        if resolved.role == "denied":
            return False, f"User has no access ({resolved.source})"

        if scope_id is not None and not resolved.covers_scope(scope_id):
            return False, "User does not have access to this specific scope"

        if action == "read" and resolved.can_read:
            return True, "Read allowed"
        if action == "write" and resolved.can_write:
            return True, "Write allowed"
        if action == "admin" and resolved.can_admin:
            return True, "Admin allowed"

        return False, f"Action '{action}' requires a higher role than '{resolved.role}'"

    # ── CRUD ─────────────────────────────────────────────────────────────

    def list_for_project(self, project_id: str) -> list[RepoUserPermission]:
        return self._perm.list_by_project(project_id)

    def upsert(
        self,
        *,
        project_id: str,
        user_id: str,
        role: str,
        allowed_scope_ids: Optional[list[str]],
        granted_by: Optional[str],
    ) -> RepoUserPermission:
        if role not in ("admin", "editor", "reader", "denied"):
            raise AppException(status_code=400, message=f"Invalid role: {role}")
        return self._perm.upsert(
            project_id=project_id,
            user_id=user_id,
            role=role,
            allowed_scope_ids=allowed_scope_ids,
            granted_by=granted_by,
        )

    def revoke(self, project_id: str, user_id: str) -> None:
        """Remove the explicit grant — reverts to org_member fallback."""
        self._perm.delete(project_id, user_id)
