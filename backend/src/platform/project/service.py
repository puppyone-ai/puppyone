"""
Project Service Layer

Handles business logic for Project
"""

import logging
from dataclasses import dataclass

from src.exceptions import ErrorCode, NotFoundException
from src.platform.project.models import Project
from src.platform.project.repository import ProjectRepositoryBase

logger = logging.getLogger(__name__)


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
        return self.repo.create(
            name=name,
            description=description,
            org_id=org_id,
            created_by=created_by,
        )

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
            return resp.data or []
        except Exception:
            # Fallback: query without join if profiles table has issues
            resp = (
                client.table("project_members")
                .select("*")
                .eq("project_id", project_id)
                .order("created_at")
                .execute()
            )
            return resp.data or []

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
