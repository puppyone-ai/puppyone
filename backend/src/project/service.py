"""
Project 服务层

负责 Project 的业务逻辑处理
"""

from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from src.project.models import Project
from src.project.repository import ProjectRepositoryBase
from src.exceptions import NotFoundException, ErrorCode
from src.supabase.dependencies import get_supabase_repository
from src.supabase.tables.schemas import TableCreate


@dataclass
class TableInfo:
    """表信息"""
    id: int
    name: str
    rows: Optional[int] = None


class ProjectService:
    """封装项目的业务逻辑层"""

    def __init__(self, repo: ProjectRepositoryBase):
        self.repo = repo

    def get_by_id(self, project_id: int) -> Optional[Project]:
        """
        根据ID获取项目

        Args:
            project_id: 项目ID

        Returns:
            Project对象，如果不存在则返回None
        """
        return self.repo.get_by_id(project_id)

    def get_by_id_with_access_check(self, project_id: int, user_id: str) -> Project:
        """
        获取项目并验证用户权限

        检查 project.user_id 是否等于用户ID

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

    def get_by_user_id(self, user_id: str) -> List[Project]:
        """
        获取用户的所有项目

        Args:
            user_id: 用户ID

        Returns:
            项目列表
        """
        return self.repo.get_by_user_id(user_id)

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
        return self.repo.create(
            name=name,
            description=description,
            user_id=user_id,
        )

    def update(
        self,
        project_id: int,
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

    def delete(self, project_id: int) -> None:
        """
        删除项目

        Args:
            project_id: 项目ID

        Raises:
            NotFoundException: 如果项目不存在
        """
        success = self.repo.delete(project_id)
        if not success:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

    def import_folder_as_table(
        self,
        project_id: str,
        table_name: str,
        folder_structure: Dict[str, Any]
    ) -> TableInfo:
        """
        导入文件夹结构作为表

        Args:
            project_id: 项目ID
            table_name: 表名
            folder_structure: 文件夹结构数据

        Returns:
            创建的表信息

        Raises:
            NotFoundException: 如果项目不存在
        """
        # 验证项目存在
        project = self.repo.get_by_id(int(project_id))
        if not project:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

        # 创建表数据
        supabase_repo = get_supabase_repository()
        table_data = TableCreate(
            name=table_name,
            project_id=int(project_id),
            description="Imported from folder structure",
            data=folder_structure
        )

        # 保存到 Supabase
        table_response = supabase_repo.create_table(table_data)

        # 计算行数（如果是列表则取长度，如果是字典则取键的数量）
        rows = None
        if folder_structure:
            if isinstance(folder_structure, list):
                rows = len(folder_structure)
            elif isinstance(folder_structure, dict):
                rows = len(folder_structure)

        return TableInfo(
            id=table_response.id,
            name=table_response.name or table_name,
            rows=rows
        )

    def verify_project_access(self, project_id: int, user_id: str) -> bool:
        """
        验证用户是否有权限访问指定的项目

        Args:
            project_id: 项目ID
            user_id: 用户ID

        Returns:
            如果用户有权限返回True，否则返回False
        """
        return self.repo.verify_project_access(project_id, user_id)
