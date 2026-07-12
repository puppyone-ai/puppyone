"""
Project Data Access Layer

Provides CRUD operations for the project table.
"""


from supabase import Client

from src.infra.supabase.exceptions import handle_supabase_error
from src.platform.project.supabase_schemas import (
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
)


class ProjectRepository:
    """Project data access repository"""

    def __init__(self, client: Client):
        self._client = client

    def create(self, project_data: ProjectCreate) -> ProjectResponse:
        try:
            data = project_data.model_dump(exclude_none=True)
            data.pop("created_at", None)
            response = self._client.table("projects").insert(data).execute()
            return ProjectResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "create project")

    def create_with_admin(self, project_data: ProjectCreate) -> ProjectResponse:
        """Atomically create a Project and the creator's Admin membership."""
        try:
            response = self._client.rpc(
                "create_project_with_admin",
                {
                    "p_id": project_data.id,
                    "p_name": project_data.name,
                    "p_description": project_data.description,
                    "p_org_id": project_data.org_id,
                    "p_created_by": project_data.created_by,
                    "p_share_token": project_data.share_token,
                },
            ).execute()
            rows = response.data or []
            row = rows[0] if isinstance(rows, list) else rows
            if not row:
                raise RuntimeError("create_project_with_admin returned no Project")
            return ProjectResponse(**row)
        except Exception as e:
            raise handle_supabase_error(e, "create project with admin")

    def get_by_id(self, project_id: str) -> ProjectResponse | None:
        response = (
            self._client.table("projects")
            .select("*")
            .eq("id", project_id)
            .execute()
        )
        if response.data:
            return ProjectResponse(**response.data[0])
        return None

    def get_list(
        self,
        skip: int = 0,
        limit: int = 100,
        org_id: str | None = None,
        name: str | None = None,
    ) -> list[ProjectResponse]:
        query = self._client.table("projects").select("*")

        if org_id is not None:
            query = query.eq("org_id", org_id)

        if name:
            query = query.eq("name", name)

        response = query.range(skip, skip + limit - 1).execute()
        return [ProjectResponse(**item) for item in response.data]

    def update(
        self, project_id: str, project_data: ProjectUpdate
    ) -> ProjectResponse | None:
        try:
            data = project_data.model_dump(exclude_none=True)
            if not data:
                return self.get_by_id(project_id)

            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table("projects")
                .update(data)
                .eq("id", project_id)
                .execute()
            )
            if response.data:
                return ProjectResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "update project")

    def delete(self, project_id: str) -> bool:
        try:
            response = self._client.table("projects").delete().eq("id", project_id).execute()
            return len(response.data) > 0
        except Exception as e:
            raise handle_supabase_error(e, "delete project")
