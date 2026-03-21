"""
Project 数据访问层

提供针对 project 表的增删改查操作。
"""

from typing import List, Optional
from supabase import Client

from src.infra.supabase.exceptions import handle_supabase_error
from src.platform.project.supabase_schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
)


class ProjectRepository:
    """Project 数据访问仓库"""

    def __init__(self, client: Client):
        self._client = client

    def create(self, project_data: ProjectCreate) -> ProjectResponse:
        try:
            data = project_data.model_dump(exclude_none=True)
            data.pop("created_at", None)
            response = self._client.table("projects").insert(data).execute()
            return ProjectResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建项目")

    def get_by_id(self, project_id: str) -> Optional[ProjectResponse]:
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
        org_id: Optional[str] = None,
        name: Optional[str] = None,
    ) -> List[ProjectResponse]:
        query = self._client.table("projects").select("*")

        if org_id is not None:
            query = query.eq("org_id", org_id)

        if name:
            query = query.eq("name", name)

        response = query.range(skip, skip + limit - 1).execute()
        return [ProjectResponse(**item) for item in response.data]

    def update(
        self, project_id: str, project_data: ProjectUpdate
    ) -> Optional[ProjectResponse]:
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
            raise handle_supabase_error(e, "更新项目")

    def delete(self, project_id: str) -> bool:
        try:
            response = self._client.table("projects").delete().eq("id", project_id).execute()
            return len(response.data) > 0
        except Exception as e:
            raise handle_supabase_error(e, "删除项目")
