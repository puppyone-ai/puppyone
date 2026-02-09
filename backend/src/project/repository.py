"""
Project 数据仓库

定义 Project 的数据访问接口和实现
"""

from abc import ABC, abstractmethod
from typing import List, Optional

from src.project.models import Project


class ProjectRepositoryBase(ABC):
    """抽象 Project 仓库接口"""

    @abstractmethod
    def get_by_id(self, project_id: str) -> Optional[Project]:
        """根据ID获取项目"""
        pass

    @abstractmethod
    def get_by_user_id(self, user_id: str) -> List[Project]:
        """根据用户ID获取项目列表"""
        pass

    @abstractmethod
    def create(
        self,
        name: str,
        description: Optional[str],
        user_id: str,
    ) -> Project:
        """创建项目"""
        pass

    @abstractmethod
    def update(
        self,
        project_id: str,
        name: Optional[str],
        description: Optional[str],
    ) -> Optional[Project]:
        """更新项目"""
        pass

    @abstractmethod
    def delete(self, project_id: str) -> bool:
        """删除项目"""
        pass

    @abstractmethod
    def verify_project_access(self, project_id: str, user_id: str) -> bool:
        """验证用户是否有权限访问指定的项目"""
        pass


class ProjectRepositorySupabase(ProjectRepositoryBase):
    """基于 Supabase 的 Project 仓库实现"""

    def __init__(self, supabase_repo=None):
        """
        初始化仓库

        Args:
            supabase_repo: 可选的 SupabaseRepository 实例，如果不提供则创建新实例
        """
        if supabase_repo is None:
            from src.supabase.dependencies import get_supabase_repository

            self._supabase_repo = get_supabase_repository()
        else:
            self._supabase_repo = supabase_repo

    def get_by_id(self, project_id: str) -> Optional[Project]:
        """
        根据ID获取项目

        Args:
            project_id: 项目ID

        Returns:
            Project对象，如果不存在则返回None
        """
        project_response = self._supabase_repo.get_project(project_id)
        if project_response:
            return self._project_response_to_project(project_response)
        return None

    def get_by_user_id(self, user_id: str) -> List[Project]:
        """
        根据用户ID获取项目列表

        Args:
            user_id: 用户ID

        Returns:
            Project列表
        """
        projects_response = self._supabase_repo.get_projects(user_id=user_id)
        return [self._project_response_to_project(p) for p in projects_response]

    def create(
        self,
        name: str,
        description: Optional[str],
        user_id: str,
    ) -> Project:
        """
        创建项目

        Args:
            name: 项目名称
            description: 项目描述
            user_id: 用户ID

        Returns:
            创建的Project对象
        """
        from src.supabase.projects.schemas import ProjectCreate
        from src.utils.id_generator import generate_uuid_v7

        project_data = ProjectCreate(
            id=generate_uuid_v7(),
            name=name,
            description=description,
            user_id=user_id,
        )
        project_response = self._supabase_repo.create_project(project_data)
        return self._project_response_to_project(project_response)

    def update(
        self,
        project_id: str,
        name: Optional[str],
        description: Optional[str],
    ) -> Optional[Project]:
        """
        更新项目

        Args:
            project_id: 项目ID
            name: 项目名称（可选，如果为None则不更新）
            description: 项目描述（可选，如果为None则不更新）

        Returns:
            更新后的Project对象，如果不存在则返回None
        """
        from src.supabase.projects.schemas import ProjectUpdate

        update_data = ProjectUpdate(
            name=name,
            description=description,
        )
        project_response = self._supabase_repo.update_project(project_id, update_data)
        if project_response:
            return self._project_response_to_project(project_response)
        return None

    def delete(self, project_id: str) -> bool:
        """
        删除项目

        Args:
            project_id: 项目ID

        Returns:
            是否删除成功
        """
        return self._supabase_repo.delete_project(project_id)

    def verify_project_access(self, project_id: str, user_id: str) -> bool:
        """
        验证用户是否有权限访问指定的项目

        检查 project.user_id 是否等于用户ID

        Args:
            project_id: 项目ID
            user_id: 用户ID

        Returns:
            如果用户有权限返回True，否则返回False
        """
        project = self.get_by_id(project_id)
        if not project:
            return False

        # 检查项目是否属于当前用户
        return project.user_id == user_id

    def _project_response_to_project(self, project_response) -> Project:
        """
        将 ProjectResponse 转换为 Project 模型

        Args:
            project_response: ProjectResponse对象

        Returns:
            Project对象
        """
        return Project(
            id=project_response.id,
            name=project_response.name,
            description=project_response.description,
            user_id=project_response.user_id,
            created_at=project_response.created_at,
        )
