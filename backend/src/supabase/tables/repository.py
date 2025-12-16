"""
Table 数据访问层

提供针对 table 表的增删改查操作。
"""

from typing import List, Optional
from supabase import Client

from src.supabase.exceptions import handle_supabase_error
from src.supabase.tables.schemas import (
    TableCreate,
    TableUpdate,
    TableResponse,
)


class TableRepository:
    """Table 数据访问仓库"""

    def __init__(self, client: Client):
        """
        初始化仓库

        Args:
            client: Supabase 客户端实例
        """
        self._client = client

    def create(self, table_data: TableCreate) -> TableResponse:
        """
        创建表

        Args:
            table_data: 表创建数据

        Returns:
            创建的表数据

        Raises:
            SupabaseException: 当创建失败时
        """
        try:
            data = table_data.model_dump(exclude_none=True)
            # 确保不包含 id 和 created_at（这些由数据库自动生成）
            data.pop("id", None)
            data.pop("created_at", None)
            response = self._client.table("table").insert(data).execute()
            return TableResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建表")

    def get_by_id(self, table_id: int) -> Optional[TableResponse]:
        """
        根据 ID 获取表

        Args:
            table_id: 表 ID

        Returns:
            表数据，如果不存在则返回 None
        """
        response = (
            self._client.table("table")
            .select("*")
            .eq("id", table_id)
            .execute()
        )
        if response.data:
            return TableResponse(**response.data[0])
        return None

    def get_list(
        self,
        skip: int = 0,
        limit: int = 100,
        project_id: Optional[int] = None,
        name: Optional[str] = None,
    ) -> List[TableResponse]:
        """
        获取表列表

        Args:
            skip: 跳过记录数
            limit: 返回记录数
            project_id: 可选，按项目 ID 过滤
            name: 可选，按名称过滤

        Returns:
            表列表
        """
        query = self._client.table("table").select("*")

        if project_id is not None:
            query = query.eq("project_id", project_id)

        if name:
            query = query.eq("name", name)

        response = query.range(skip, skip + limit - 1).execute()
        return [TableResponse(**item) for item in response.data]

    def update(
        self, table_id: int, table_data: TableUpdate
    ) -> Optional[TableResponse]:
        """
        更新表

        Args:
            table_id: 表 ID
            table_data: 表更新数据

        Returns:
            更新后的表数据，如果不存在则返回 None

        Raises:
            SupabaseException: 当更新失败时
        """
        try:
            data = table_data.model_dump(exclude_none=True)
            if not data:
                return self.get_by_id(table_id)

            # 确保不包含 id 和 created_at
            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table("table")
                .update(data)
                .eq("id", table_id)
                .execute()
            )
            if response.data:
                return TableResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新表")

    def delete(self, table_id: int) -> bool:
        """
        删除表

        Args:
            table_id: 表 ID

        Returns:
            是否删除成功
        """
        response = (
            self._client.table("table")
            .delete()
            .eq("id", table_id)
            .execute()
        )
        return len(response.data) > 0
