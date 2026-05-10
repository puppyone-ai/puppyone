"""
Project Repository

Defines the data access interface and implementation for Project
"""

from abc import ABC, abstractmethod

from src.platform.project.models import Project


class ProjectRepositoryBase(ABC):
    """Abstract Project repository interface"""

    @abstractmethod
    def get_by_id(self, project_id: str) -> Project | None:
        """Get project by ID"""

    @abstractmethod
    def get_by_org_id(self, org_id: str) -> list[Project]:
        """Get project list by organization ID"""

    @abstractmethod
    def create(
        self,
        name: str,
        description: str | None,
        org_id: str,
        created_by: str,
    ) -> Project:
        """Create a project"""

    @abstractmethod
    def update(
        self,
        project_id: str,
        name: str | None,
        description: str | None,
    ) -> Project | None:
        """Update a project"""

    @abstractmethod
    def delete(self, project_id: str) -> bool:
        """Delete a project"""

    @abstractmethod
    def verify_project_access(self, project_id: str, user_id: str) -> str | None:
        """Verify whether user has access to the specified project; returns role string or None"""


class ProjectRepositorySupabase(ProjectRepositoryBase):
    """Supabase-based Project repository implementation"""

    def __init__(self, supabase_repo=None):
        """
        Initialize the repository

        Args:
            supabase_repo: Optional SupabaseRepository instance; creates a new one if not provided
        """
        if supabase_repo is None:
            from src.infra.supabase.dependencies import get_supabase_repository

            self._supabase_repo = get_supabase_repository()
        else:
            self._supabase_repo = supabase_repo

    def get_by_id(self, project_id: str) -> Project | None:
        """
        Get project by ID

        Args:
            project_id: Project ID

        Returns:
            Project object, or None if not found
        """
        project_response = self._supabase_repo.get_project(project_id)
        if project_response:
            return self._project_response_to_project(project_response)
        return None

    def get_by_org_id(self, org_id: str) -> list[Project]:
        """
        Get project list by organization ID

        Args:
            org_id: Organization ID

        Returns:
            List of Projects
        """
        projects_response = self._supabase_repo.get_projects(org_id=org_id)
        return [self._project_response_to_project(p) for p in projects_response]

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
        from src.platform.project.supabase_schemas import ProjectCreate
        from src.utils.id_generator import generate_uuid_v7

        project_data = ProjectCreate(
            id=generate_uuid_v7(),
            name=name,
            description=description,
            org_id=org_id,
            created_by=created_by,
        )
        project_response = self._supabase_repo.create_project(project_data)
        return self._project_response_to_project(project_response)

    def update(
        self,
        project_id: str,
        name: str | None,
        description: str | None,
        visibility: str | None = None,
        bound_git_branch: str | None = None,
    ) -> Project | None:
        """
        Update a project

        Args:
            project_id: Project ID
            name: Project name (optional, not updated if None)
            description: Project description (optional, not updated if None)
            visibility: Visibility (optional)
            bound_git_branch: Default git branch for new bindings (optional)

        Returns:
            Updated Project object, or None if not found
        """
        from src.platform.project.supabase_schemas import ProjectUpdate

        update_data = ProjectUpdate(
            name=name,
            description=description,
        )
        if visibility is not None:
            update_data.visibility = visibility
        if bound_git_branch is not None:
            update_data.bound_git_branch = bound_git_branch
        project_response = self._supabase_repo.update_project(project_id, update_data)
        if project_response:
            return self._project_response_to_project(project_response)
        return None

    def delete(self, project_id: str) -> bool:
        """
        Delete a project

        Args:
            project_id: Project ID

        Returns:
            Whether deletion was successful
        """
        return self._supabase_repo.delete_project(project_id)

    def verify_project_access(self, project_id: str, user_id: str) -> str | None:
        """
        Verify whether user has access to the specified project

        Access logic:
        1. visibility='org' -> any member of the org can access
        2. visibility='private' -> only org owner or members in project_members can access

        Uses per-request contextvar cache to avoid redundant DB lookups
        when the same project+user pair is checked multiple times.

        Returns:
            Role string (org role or project role), or None if no access
        """
        from src.utils.request_context import project_access_cache_var

        cache_key = f"{project_id}:{user_id}"
        cache = project_access_cache_var.get()
        if cache is not None and cache_key in cache:
            return cache[cache_key]

        result = self._verify_project_access_uncached(project_id, user_id)

        if cache is not None:
            cache[cache_key] = result

        return result

    def _verify_project_access_uncached(self, project_id: str, user_id: str) -> str | None:
        project = self.get_by_id(project_id)
        if not project:
            return None

        from src.platform.organization.repository import OrganizationRepository
        org_repo = OrganizationRepository()
        member = org_repo.get_member(project.org_id, user_id)

        if project.visibility == "org":
            return member.role if member else None

        if member and member.role == "owner":
            return "owner"

        from src.infra.supabase.dependencies import get_supabase_client
        client = get_supabase_client()
        resp = (
            client.table("project_members")
            .select("role")
            .eq("project_id", project_id)
            .eq("user_id", user_id)
            .execute()
        )
        if resp.data:
            return resp.data[0]["role"]

        return None

    def _project_response_to_project(self, project_response) -> Project:
        """
        Convert ProjectResponse to Project model

        Args:
            project_response: ProjectResponse object

        Returns:
            Project object
        """
        return Project(
            id=project_response.id,
            name=project_response.name,
            description=project_response.description,
            org_id=project_response.org_id,
            visibility=getattr(project_response, 'visibility', 'org'),
            bound_git_branch=getattr(project_response, 'bound_git_branch', 'main'),
            created_by=project_response.created_by,
            created_at=project_response.created_at,
            updated_at=getattr(project_response, 'updated_at', None),
        )
