"""
Project 数据访问层

提供针对 project 表的增删改查操作。
"""

from typing import List, Optional
from supabase import Client

from src.supabase.exceptions import handle_supabase_error
from src.supabase.projects.schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
)


class ProjectRepository:
    """Project 数据访问仓库"""

    def __init__(self, client: Client):
        """
        初始化仓库

        Args:
            client: Supabase 客户端实例
        """
        self._client = client

    def create(self, project_data: ProjectCreate) -> ProjectResponse:
        """
        创建项目

        Args:
            project_data: 项目创建数据

        Returns:
            创建的项目数据

        Raises:
            SupabaseException: 当创建失败时
        """
        try:
            data = project_data.model_dump(exclude_none=True)
            # 确保不包含 id 和 created_at（这些由数据库自动生成）
            data.pop("id", None)
            data.pop("created_at", None)
            response = self._client.table("project").insert(data).execute()
            return ProjectResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建项目")

    def get_by_id(self, project_id: int) -> Optional[ProjectResponse]:
        """
        根据 ID 获取项目

        Args:
            project_id: 项目 ID

        Returns:
            项目数据，如果不存在则返回 None
        """
        response = (
            self._client.table("project")
            .select("*")
            .eq("id", str(project_id))
            .execute()
        )
        if response.data:
            return ProjectResponse(**response.data[0])
        return None

    def get_list(
        self,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[str] = None,
        name: Optional[str] = None,
    ) -> List[ProjectResponse]:
        """
        获取项目列表

        Args:
            skip: 跳过记录数
            limit: 返回记录数
            user_id: 可选，按用户 ID 过滤
            name: 可选，按名称过滤

        Returns:
            项目列表
        """
        query = self._client.table("project").select("*")

        if user_id is not None:
            query = query.eq("user_id", user_id)

        if name:
            query = query.eq("name", name)

        response = query.range(skip, skip + limit - 1).execute()
        return [ProjectResponse(**item) for item in response.data]

    def update(
        self, project_id: int, project_data: ProjectUpdate
    ) -> Optional[ProjectResponse]:
        """
        更新项目

        Args:
            project_id: 项目 ID
            project_data: 项目更新数据

        Returns:
            更新后的项目数据，如果不存在则返回 None

        Raises:
            SupabaseException: 当更新失败时
        """
        try:
            data = project_data.model_dump(exclude_none=True)
            if not data:
                return self.get_by_id(project_id)

            # 确保不包含 id 和 created_at
            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table("project")
                .update(data)
                .eq("id", str(project_id))
                .execute()
            )
            if response.data:
                return ProjectResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新项目")

    def delete(self, project_id: int) -> bool:
        """
        删除项目

        Args:
            project_id: 项目 ID

        Returns:
            是否删除成功
        """
        response = self._client.table("project").delete().eq("id", project_id).execute()
        return len(response.data) > 0
