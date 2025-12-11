from abc import ABC, abstractmethod
from typing import List, Optional

from src.table.models import Table
from src.table.schemas import ProjectWithTables


class TableRepositoryBase(ABC):
    """抽象Table仓库接口"""

    @abstractmethod
    def get_by_user_id(self, user_id: int) -> List[Table]:
        """通过用户ID获取所有Tables（通过project关联）"""
        pass

    @abstractmethod
    def get_projects_with_tables_by_user_id(self, user_id: str) -> List[ProjectWithTables]:
        """获取用户的所有项目及其下的所有表格"""
        pass

    @abstractmethod
    def get_by_id(self, table_id: int) -> Optional[Table]:
        pass

    @abstractmethod
    def update(
        self,
        table_id: int,
        name: Optional[str],
        description: Optional[str],
        data: Optional[dict],
    ) -> Optional[Table]:
        pass

    @abstractmethod
    def delete(self, table_id: int) -> bool:
        pass

    @abstractmethod
    def create(
        self,
        project_id: int,
        name: str,
        description: str,
        data: dict,
    ) -> Table:
        pass

    @abstractmethod
    def update_context_data(
        self, table_id: int, data: dict
    ) -> Optional[Table]:
        """更新 data 字段"""
        pass

    @abstractmethod
    def verify_table_access(self, table_id: int, user_id: str) -> bool:
        """
        验证用户是否有权限访问指定的表格
        
        通过 table.project_id 关联到 project 表，检查 project.user_id 是否等于用户ID
        
        Args:
            table_id: 表格ID
            user_id: 用户ID
            
        Returns:
            如果用户有权限返回True，否则返回False
        """
        pass

    @abstractmethod
    def verify_project_access(self, project_id: int, user_id: str) -> bool:
        """
        验证用户是否有权限访问指定的项目
        
        检查 project.user_id 是否等于用户ID
        
        Args:
            project_id: 项目ID
            user_id: 用户ID
            
        Returns:
            如果用户有权限返回True，否则返回False
        """
        pass


class TableRepositorySupabase(TableRepositoryBase):
    """基于Supabase的Table仓库实现"""

    def __init__(self, supabase_repo=None):
        """
        初始化仓库

        Args:
            supabase_repo: 可选的 SupabaseRepository 实例，如果不提供则创建新实例
        """
        if supabase_repo is None:
            from src.supabase.repository import SupabaseRepository
            self._supabase_repo = SupabaseRepository()
        else:
            self._supabase_repo = supabase_repo

    def get_by_user_id(self, user_id: int) -> List[Table]:
        """
        通过用户ID获取所有Tables（通过project关联）

        Args:
            user_id: 用户ID

        Returns:
            Table列表
        """
        # 首先获取该用户的所有项目
        projects = self._supabase_repo.get_projects(user_id=user_id)
        project_ids = [project.id for project in projects]

        if not project_ids:
            return []

        # 获取这些项目下的所有Tables
        all_tables = []
        for project_id in project_ids:
            tables = self._supabase_repo.get_tables(project_id=project_id)
            all_tables.extend(tables)

        # 转换为Table模型
        return [self._table_response_to_table(table) for table in all_tables]

    def get_projects_with_tables_by_user_id(self, user_id: str) -> List[ProjectWithTables]:
        """
        获取用户的所有项目及其下的所有表格

        Args:
            user_id: 用户ID（字符串类型）

        Returns:
            包含项目信息和其下所有表格的列表
        """
        from src.table.schemas import TableOut

        # 获取用户的所有项目
        projects = self._supabase_repo.get_projects(user_id=user_id)

        # 为每个项目获取其下的所有表格
        result = []
        for project in projects:
            # 获取该项目下的所有表格
            tables_response = self._supabase_repo.get_tables(project_id=project.id)
            
            # 转换为 TableOut 模型
            tables = [
                TableOut(
                    id=table.id,
                    name=table.name,
                    project_id=table.project_id,
                    description=table.description,
                    data=table.data,
                    created_at=table.created_at,
                )
                for table in tables_response
            ]

            # 创建 ProjectWithTables 对象
            project_with_tables = ProjectWithTables(
                id=project.id,
                name=project.name,
                description=project.description,
                user_id=project.user_id,
                created_at=project.created_at,
                tables=tables,
            )
            result.append(project_with_tables)

        return result

    def get_by_id(self, table_id: int) -> Optional[Table]:
        """
        根据ID获取Table

        Args:
            table_id: Table ID

        Returns:
            Table对象，如果不存在则返回None
        """
        table_response = self._supabase_repo.get_table(table_id)
        if table_response:
            return self._table_response_to_table(table_response)
        return None

    def create(
        self,
        project_id: int,
        name: str,
        description: str,
        data: dict,
    ) -> Table:
        """
        创建新的Table

        Args:
            project_id: 项目ID
            name: Table名称
            description: Table描述
            data: Table数据（JSON对象）

        Returns:
            创建的Table对象
        """
        from src.supabase.tables.schemas import TableCreate

        table_data = TableCreate(
            name=name,
            project_id=project_id,
            description=description,
            data=data,
        )
        table_response = self._supabase_repo.create_table(table_data)
        return self._table_response_to_table(table_response)

    def update(
        self,
        table_id: int,
        name: Optional[str],
        description: Optional[str],
        data: Optional[dict],
    ) -> Optional[Table]:
        """
        更新Table

        Args:
            table_id: Table ID
            name: Table名称（可选，如果为None则不更新）
            description: Table描述（可选，如果为None则不更新）
            data: Table数据（可选，如果为None则不更新）

        Returns:
            更新后的Table对象，如果不存在则返回None
        """
        from src.supabase.tables.schemas import TableUpdate

        update_data = TableUpdate(
            name=name,
            description=description,
            data=data,
        )
        table_response = self._supabase_repo.update_table(table_id, update_data)
        if table_response:
            return self._table_response_to_table(table_response)
        return None

    def delete(self, table_id: int) -> bool:
        """
        删除Table

        Args:
            table_id: Table ID

        Returns:
            是否删除成功
        """
        return self._supabase_repo.delete_table(table_id)

    def update_context_data(
        self, table_id: int, data: dict
    ) -> Optional[Table]:
        """
        更新Table的data字段

        Args:
            table_id: Table ID
            data: 新的data数据

        Returns:
            更新后的Table对象，如果不存在则返回None
        """
        from src.supabase.tables.schemas import TableUpdate

        update_data = TableUpdate(data=data)
        table_response = self._supabase_repo.update_table(table_id, update_data)
        if table_response:
            return self._table_response_to_table(table_response)
        return None

    def verify_table_access(self, table_id: int, user_id: str) -> bool:
        """
        验证用户是否有权限访问指定的表格
        
        通过 table.project_id 关联到 project 表，检查 project.user_id 是否等于用户ID
        
        Args:
            table_id: 表格ID
            user_id: 用户ID
            
        Returns:
            如果用户有权限返回True，否则返回False
        """
        # 获取表格
        table = self.get_by_id(table_id)
        if not table:
            return False
        
        # 如果表格没有关联项目，返回False（安全起见）
        if not table.project_id:
            return False
        
        # 获取项目并检查用户权限
        project = self._supabase_repo.get_project(table.project_id)
        if not project:
            return False
        
        # 检查项目是否属于当前用户
        return project.user_id == user_id

    def verify_project_access(self, project_id: int, user_id: str) -> bool:
        """
        验证用户是否有权限访问指定的项目
        
        检查 project.user_id 是否等于用户ID
        
        Args:
            project_id: 项目ID
            user_id: 用户ID
            
        Returns:
            如果用户有权限返回True，否则返回False
        """
        # 获取项目并检查用户权限
        project = self._supabase_repo.get_project(project_id)
        if not project:
            return False
        
        # 检查项目是否属于当前用户
        return project.user_id == user_id

    def _table_response_to_table(self, table_response) -> Table:
        """
        将TableResponse转换为Table模型

        Args:
            table_response: TableResponse对象

        Returns:
            Table对象
        """
        return Table(
            id=table_response.id,
            name=table_response.name,
            project_id=table_response.project_id,
            description=table_response.description,
            data=table_response.data,  # 保持原始数据类型（可以是Dict、List或其他JSON类型）
            created_at=table_response.created_at,
        )
