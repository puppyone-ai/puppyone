"""
Project Service Layer

Handles business logic for Project
"""

import logging
import re
from dataclasses import dataclass

from src.exceptions import ErrorCode, NotFoundException, PermissionException
from src.platform.project.models import Project
from src.platform.project.repository import ProjectRepositoryBase

logger = logging.getLogger(__name__)

DEFAULT_PROJECT_NAME = "Untitled Project"
DEFAULT_PROJECT_NAME_RE = re.compile(
    r"^Untitled Project(?: (?:(\d+)|\((\d+)\)))?$",
    re.IGNORECASE,
)


def _untitled_project_slot(name: str) -> int | None:
    match = DEFAULT_PROJECT_NAME_RE.match(name.strip())
    if not match:
        return None
    raw_index = match.group(1) or match.group(2)
    if raw_index is None:
        return 1
    index = int(raw_index)
    return index if index > 1 else None


def _format_untitled_project_name(index: int) -> str:
    return DEFAULT_PROJECT_NAME if index == 1 else f"{DEFAULT_PROJECT_NAME} {index}"


def resolve_untitled_project_name(
    requested_name: str,
    existing_projects: list[Project],
) -> str:
    """Return a collision-free default project name for Untitled-style names."""
    requested_slot = _untitled_project_slot(requested_name)
    if requested_slot is None:
        return requested_name

    occupied = {
        slot
        for project in existing_projects
        if (slot := _untitled_project_slot(project.name)) is not None
    }
    if requested_slot not in occupied:
        return _format_untitled_project_name(requested_slot)

    next_slot = 1
    while next_slot in occupied:
        next_slot += 1
    return _format_untitled_project_name(next_slot)


@dataclass
class TableInfo:
    """Table information"""

    id: str
    name: str
    rows: int | None = None


class ProjectService:
    """Encapsulates business logic for projects"""

    def __init__(self, repo: ProjectRepositoryBase):
        self.repo = repo

    def get_by_id(self, project_id: str) -> Project | None:
        """
        Get project by ID

        Args:
            project_id: Project ID (UUID)

        Returns:
            Project object, or None if not found
        """
        return self.repo.get_by_id(project_id)

    def get_by_id_with_access_check(self, project_id: str, user_id: str) -> Project:
        """
        Get project and verify user access

        Checks whether the user belongs to the project's organization via the org_members table

        Args:
            project_id: Project ID
            user_id: User ID

        Returns:
            Verified Project object

        Raises:
            NotFoundException: If project does not exist or user has no access
        """
        project = self.get_by_id(project_id)
        if not project:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

        has_access = self.repo.verify_project_access(project_id, user_id)
        if not has_access:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

        return project

    def get_by_org_id(self, org_id: str) -> list[Project]:
        """
        Get all projects under an organization

        Args:
            org_id: Organization ID

        Returns:
            List of projects
        """
        return self.repo.get_by_org_id(org_id)

    def create(
        self,
        name: str,
        description: str | None,
        org_id: str,
        created_by: str,
    ) -> Project:
        """
        Create a project

        Args:
            name: Project name
            description: Project description
            org_id: Organization ID
            created_by: Creator user ID

        Returns:
            Created Project object
        """
        name = resolve_untitled_project_name(name, self.repo.get_by_org_id(org_id))
        project = self.repo.create(
            name=name,
            description=description,
            org_id=org_id,
            created_by=created_by,
        )
        # Auto-insert the creator into ``project_members`` so the
        # settings UI shows them immediately. Access-wise this is a
        # no-op (the org owner already has access via
        # ``verify_project_access``) — the row is purely for visibility
        # in the membership list. Role ``admin`` because ``owner`` is
        # not in the ``project_members.role`` CHECK constraint
        # (``admin|editor|viewer``).
        try:
            self.add_project_member(project.id, created_by, "admin")
        except Exception as exc:
            # Failure here doesn't roll back the project — the user
            # can still re-add themselves manually. Log and move on
            # rather than failing project creation.
            import logging
            logging.getLogger(__name__).warning(
                "[project.create] failed to auto-add creator %s as member of "
                "project %s: %s",
                created_by, project.id, exc,
            )
        return project

    def update(
        self,
        project_id: str,
        name: str | None,
        description: str | None,
        bound_git_branch: str | None = None,
    ) -> Project:
        """
        Update a project

        Args:
            project_id: Project ID
            name: Project name (optional)
            description: Project description (optional)
            bound_git_branch: Default git branch (optional)

        Returns:
            Updated Project object

        Raises:
            NotFoundException: If project does not exist
        """
        updated = self.repo.update(
            project_id=project_id,
            name=name,
            description=description,
            bound_git_branch=bound_git_branch,
        )
        if not updated:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )
        return updated

    def delete(self, project_id: str) -> None:
        """
        Delete a project

        Args:
            project_id: Project ID (UUID)

        Raises:
            NotFoundException: If project does not exist
        """
        success = self.repo.delete(project_id)
        if not success:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

    def verify_project_access(self, project_id: str, user_id: str) -> str | None:
        """
        Verify whether the user has access to the specified project

        Args:
            project_id: Project ID
            user_id: User ID

        Returns:
            User's role string in the organization, or None if no access
        """
        return self.repo.verify_project_access(project_id, user_id)

    def update_visibility(self, project_id: str, visibility: str, user_id: str) -> Project:
        from src.platform.organization.repository import OrganizationRepository
        project = self.get_by_id(project_id)
        if not project:
            raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)

        org_repo = OrganizationRepository()
        member = org_repo.get_member(project.org_id, user_id)
        if not member or member.role != "owner":
            raise NotFoundException("Only org owner can change project visibility", code=ErrorCode.NOT_FOUND)

        if visibility not in ("org", "private"):
            raise NotFoundException("visibility must be 'org' or 'private'", code=ErrorCode.NOT_FOUND)

        updated = self.repo.update(project_id, name=None, description=None, visibility=visibility)
        return updated

    def list_project_members(self, project_id: str) -> list:
        from src.infra.supabase.dependencies import get_supabase_client

        client = get_supabase_client()
        try:
            resp = (
                client.table("project_members")
                .select("*, profiles(email, display_name, avatar_url)")
                .eq("project_id", project_id)
                .order("created_at")
                .execute()
            )
            rows = resp.data or []
        except Exception:
            # Fallback: query without join if profiles table has issues
            resp = (
                client.table("project_members")
                .select("*")
                .eq("project_id", project_id)
                .order("created_at")
                .execute()
            )
            rows = resp.data or []

        # ── Backfill missing profile data from auth.users ─────────────
        # The PostgREST join returns ``profiles=None`` (or fields all
        # null) when the user has an auth.users row but no profiles
        # row — common for users who signed up before the profile-on-
        # signup hook existed, or whose profile got hidden by RLS.
        # Without this, the frontend falls back to "Unknown member"
        # which is alarming for what's actually a normal user. Pull
        # email straight from ``auth.users`` via the admin SDK so the
        # name resolution chain has something to land on.
        missing_user_ids = []
        for row in rows:
            profile = row.get("profiles")
            if not profile or not profile.get("email"):
                uid = row.get("user_id")
                if uid:
                    missing_user_ids.append(uid)

        if missing_user_ids:
            email_by_user_id = self._lookup_auth_users_email(missing_user_ids)
            for row in rows:
                if email_by_user_id.get(row.get("user_id")):
                    profile = row.get("profiles") or {}
                    if not profile.get("email"):
                        profile["email"] = email_by_user_id[row["user_id"]]
                        row["profiles"] = profile

        return rows

    def _lookup_auth_users_email(self, user_ids: list[str]) -> dict[str, str]:
        """Look up ``{user_id: email}`` from ``auth.users`` for users
        whose ``public.profiles`` row is missing.

        Uses the Supabase service-role client (already injected via
        ``SupabaseClient``). Returns an empty dict on any failure —
        the caller treats missing emails as "fall back to user id
        prefix on the frontend", which is the same path it'd hit
        without this lookup, so we never want to fail loudly here.
        """
        from src.infra.supabase.client import SupabaseClient

        try:
            client = SupabaseClient().client
        except Exception:
            return {}
        out: dict[str, str] = {}
        for uid in user_ids:
            try:
                resp = client.auth.admin.get_user_by_id(uid)
                user = getattr(resp, "user", None) or resp
                email = getattr(user, "email", None)
                if email:
                    out[uid] = email
            except Exception:
                # Continue — one missing user shouldn't break the
                # whole list.
                continue
        return out

    def add_project_member(self, project_id: str, target_user_id: str, role: str) -> dict:
        from src.infra.supabase.dependencies import get_supabase_client
        from src.utils.id_generator import generate_uuid_v7
        client = get_supabase_client()
        data = {
            "id": generate_uuid_v7(),
            "project_id": project_id,
            "user_id": target_user_id,
            "role": role,
        }
        resp = client.table("project_members").insert(data).execute()
        return resp.data[0] if resp.data else data

    def update_project_member_role(self, project_id: str, target_user_id: str, role: str) -> dict:
        from src.infra.supabase.dependencies import get_supabase_client
        client = get_supabase_client()
        resp = (
            client.table("project_members")
            .update({"role": role})
            .eq("project_id", project_id)
            .eq("user_id", target_user_id)
            .execute()
        )
        if not resp.data:
            raise NotFoundException("Project member not found", code=ErrorCode.NOT_FOUND)
        return resp.data[0]

    def remove_project_member(self, project_id: str, target_user_id: str) -> None:
        from src.infra.supabase.dependencies import get_supabase_client
        client = get_supabase_client()
        client.table("project_members").delete().eq("project_id", project_id).eq("user_id", target_user_id).execute()

    # ── Share link MVP ──

    def get_share_info(self, project_id: str, user_id: str) -> dict:
        """Return the current share token for owners/admins.

        Authorization: org owner OR project admin only — sharing a
        link is a sensitive action that effectively widens the
        membership ACL, so we gate it tighter than read access.

        Returns ``{share_token: str, can_share: bool}``. ``can_share``
        is always True when this method succeeds (the auth gate raises
        otherwise); we keep the field so the frontend can branch on a
        single property when there are future role tiers.
        """
        role = self.verify_project_access(project_id, user_id)
        if role not in ("owner", "admin"):
            raise PermissionException(
                "Only org owner or project admin can view the share link",
                code=ErrorCode.FORBIDDEN,
            )
        project = self.get_by_id(project_id)
        if not project:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND,
            )
        return {
            "share_token": project.share_token or "",
            "can_share": True,
        }

    def rotate_share_token(self, project_id: str, user_id: str) -> dict:
        """Generate a new share token; old token stops working.

        Owner/admin only — see ``get_share_info``.
        """
        role = self.verify_project_access(project_id, user_id)
        if role not in ("owner", "admin"):
            raise PermissionException(
                "Only org owner or project admin can rotate the share link",
                code=ErrorCode.FORBIDDEN,
            )
        updated = self.repo.rotate_share_token(project_id)
        if not updated:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND,
            )
        return {
            "share_token": updated.share_token or "",
            "can_share": True,
        }

    def join_via_share_token(self, token: str, user_id: str) -> dict:
        """Join a project by presenting a valid share token.

        Default role is ``viewer`` — share links are low-trust by
        design. Idempotent: if the user is already a project member
        we silently return their existing role rather than 409 (the
        observable goal — "I'm in this project now" — is met).
        """
        project = self.repo.find_by_share_token(token)
        if not project:
            raise NotFoundException(
                "Share link is invalid or has been rotated",
                code=ErrorCode.NOT_FOUND,
            )

        # If the caller is already a project member (or org owner with
        # implicit access), just return the join info without
        # re-inserting. Matches the org-invite accept idempotency.
        existing_role = self.verify_project_access(project.id, user_id)
        if existing_role:
            return {
                "project_id": project.id,
                "project_name": project.name,
                "role": existing_role,
                "newly_joined": False,
            }

        self.add_project_member(project.id, user_id, "viewer")
        return {
            "project_id": project.id,
            "project_name": project.name,
            "role": "viewer",
            "newly_joined": True,
        }
