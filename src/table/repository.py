from abc import ABC, abstractmethod
from typing import List, Optional

from src.table.models import Table


class TableRepositoryBase(ABC):
    """抽象Table仓库接口"""

    @abstractmethod
    def get_by_user_id(self, user_id: int) -> List[Table]:
        """通过用户ID获取所有Tables（通过project关联）"""
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
        from src.supabase.schemas import TableCreate

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
        from src.supabase.schemas import TableUpdate

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
        from src.supabase.schemas import TableUpdate

        update_data = TableUpdate(data=data)
        table_response = self._supabase_repo.update_table(table_id, update_data)
        if table_response:
            return self._table_response_to_table(table_response)
        return None

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
