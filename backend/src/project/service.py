"""
Project 服务层

负责 Project 的业务逻辑处理
"""

import logging
from typing import List, Optional
from dataclasses import dataclass

from src.project.models import Project
from src.project.repository import ProjectRepositoryBase
from src.exceptions import NotFoundException, ErrorCode

logger = logging.getLogger(__name__)


@dataclass
class TableInfo:
    """表信息"""

    id: str
    name: str
    rows: Optional[int] = None


class ProjectService:
    """封装项目的业务逻辑层"""

    def __init__(self, repo: ProjectRepositoryBase):
        self.repo = repo

    def get_by_id(self, project_id: str) -> Optional[Project]:
        """
        根据ID获取项目

        Args:
            project_id: 项目ID (UUID)

        Returns:
            Project对象，如果不存在则返回None
        """
        return self.repo.get_by_id(project_id)

    def get_by_id_with_access_check(self, project_id: str, user_id: str) -> Project:
        """
        获取项目并验证用户权限

        通过 org_members 表检查用户是否属于项目所在组织

        Args:
            project_id: 项目ID
            user_id: 用户ID

        Returns:
            已验证的 Project 对象

        Raises:
            NotFoundException: 如果项目不存在或用户无权限
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

    def get_by_org_id(self, org_id: str) -> List[Project]:
        """
        获取组织下的所有项目

        Args:
            org_id: 组织ID

        Returns:
            项目列表
        """
        return self.repo.get_by_org_id(org_id)

    def create(
        self,
        name: str,
        description: Optional[str],
        org_id: str,
        created_by: str,
    ) -> Project:
        """
        创建项目

        Args:
            name: 项目名称
            description: 项目描述
            org_id: 组织ID
            created_by: 创建者用户ID

        Returns:
            创建的Project对象
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
        name: Optional[str],
        description: Optional[str],
    ) -> Project:
        """
        更新项目

        Args:
            project_id: 项目ID
            name: 项目名称（可选）
            description: 项目描述（可选）

        Returns:
            更新后的Project对象

        Raises:
            NotFoundException: 如果项目不存在
        """
        updated = self.repo.update(
            project_id=project_id,
            name=name,
            description=description,
        )
        if not updated:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )
        return updated

    def delete(self, project_id: str) -> None:
        """
        删除项目

        Args:
            project_id: 项目ID (UUID)

        Raises:
            NotFoundException: 如果项目不存在
        """
        success = self.repo.delete(project_id)
        if not success:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

    def verify_project_access(self, project_id: str, user_id: str) -> Optional[str]:
        """
        验证用户是否有权限访问指定的项目

        Args:
            project_id: 项目ID
            user_id: 用户ID

        Returns:
            用户在组织中的角色字符串，无权限则返回 None
        """
        return self.repo.verify_project_access(project_id, user_id)

    def update_visibility(self, project_id: str, visibility: str, user_id: str) -> Project:
        from src.organization.repository import OrganizationRepository
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
        from src.supabase.dependencies import get_supabase_client
        client = get_supabase_client()
        resp = (
            client.table("project_members")
            .select("*, profiles(email, display_name, avatar_url)")
            .eq("project_id", project_id)
            .order("created_at")
            .execute()
        )
        return resp.data

    def add_project_member(self, project_id: str, target_user_id: str, role: str) -> dict:
        from src.supabase.dependencies import get_supabase_client
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
        from src.supabase.dependencies import get_supabase_client
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
        from src.supabase.dependencies import get_supabase_client
        client = get_supabase_client()
        client.table("project_members").delete().eq("project_id", project_id).eq("user_id", target_user_id).execute()
