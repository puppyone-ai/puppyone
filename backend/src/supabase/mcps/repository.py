"""
MCP 数据访问层

提供针对 mcp 表的增删改查操作。
"""

from typing import List, Optional
from supabase import Client

from src.supabase.exceptions import handle_supabase_error
from src.supabase.mcps.schemas import (
    McpCreate,
    McpUpdate,
    McpResponse,
)


class McpRepository:
    """MCP 数据访问仓库"""

    def __init__(self, client: Client):
        """
        初始化仓库

        Args:
            client: Supabase 客户端实例
        """
        self._client = client

    def create(self, mcp_data: McpCreate) -> McpResponse:
        """
        创建 MCP 实例

        Args:
            mcp_data: MCP 创建数据

        Returns:
            创建的 MCP 实例数据

        Raises:
            SupabaseException: 当创建失败时
        """
        try:
            data = mcp_data.model_dump(exclude_none=True)
            # 确保不包含 id 和 created_at（这些由数据库自动生成）
            data.pop("id", None)
            data.pop("created_at", None)
            response = self._client.table("mcp_instance").insert(data).execute()
            return McpResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建 MCP 实例")

    def get_by_id(self, mcp_id: int) -> Optional[McpResponse]:
        """
        根据 ID 获取 MCP 实例

        Args:
            mcp_id: MCP 实例 ID

        Returns:
            MCP 实例数据，如果不存在则返回 None
        """
        response = (
            self._client.table("mcp_instance")
            .select("*")
            .eq("id", mcp_id)
            .execute()
        )
        if response.data:
            return McpResponse(**response.data[0])
        return None

    def get_by_api_key(self, api_key: str) -> Optional[McpResponse]:
        """
        根据 API Key 获取 MCP 实例

        Args:
            api_key: MCP API Key

        Returns:
            MCP 实例数据，如果不存在则返回 None
        """
        response = (
            self._client.table("mcp_instance")
            .select("*")
            .eq("api_key", api_key)
            .execute()
        )
        if response.data:
            return McpResponse(**response.data[0])
        return None

    def get_list(
        self,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[str] = None,
        project_id: Optional[int] = None,
        table_id: Optional[int] = None,
    ) -> List[McpResponse]:
        """
        获取 MCP 实例列表

        Args:
            skip: 跳过记录数
            limit: 返回记录数
            user_id: 可选，按用户 ID 过滤
            project_id: 可选，按项目 ID 过滤
            table_id: 可选，按表 ID 过滤

        Returns:
            MCP 实例列表
        """
        query = self._client.table("mcp_instance").select("*")

        if user_id is not None:
            query = query.eq("user_id", user_id)

        if project_id is not None:
            query = query.eq("project_id", project_id)

        if table_id is not None:
            query = query.eq("table_id", table_id)

        response = query.range(skip, skip + limit - 1).execute()
        return [McpResponse(**item) for item in response.data]

    def update(
        self, mcp_id: int, mcp_data: McpUpdate
    ) -> Optional[McpResponse]:
        """
        更新 MCP 实例

        Args:
            mcp_id: MCP 实例 ID
            mcp_data: MCP 更新数据

        Returns:
            更新后的 MCP 实例数据，如果不存在则返回 None

        Raises:
            SupabaseException: 当更新失败时
        """
        try:
            data = mcp_data.model_dump(exclude_none=True)
            if not data:
                return self.get_by_id(mcp_id)

            # 确保不包含 id 和 created_at
            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table("mcp_instance")
                .update(data)
                .eq("id", mcp_id)
                .execute()
            )
            if response.data:
                return McpResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新 MCP 实例")

    def update_by_api_key(
        self, api_key: str, mcp_data: McpUpdate
    ) -> Optional[McpResponse]:
        """
        根据 API Key 更新 MCP 实例

        Args:
            api_key: MCP API Key
            mcp_data: MCP 更新数据

        Returns:
            更新后的 MCP 实例数据，如果不存在则返回 None

        Raises:
            SupabaseException: 当更新失败时
        """
        try:
            data = mcp_data.model_dump(exclude_none=True)
            if not data:
                return self.get_by_api_key(api_key)

            # 确保不包含 id 和 created_at
            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table("mcp_instance")
                .update(data)
                .eq("api_key", api_key)
                .execute()
            )
            if response.data:
                return McpResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新 MCP 实例")

    def delete(self, mcp_id: int) -> bool:
        """
        删除 MCP 实例

        Args:
            mcp_id: MCP 实例 ID

        Returns:
            是否删除成功
        """
        response = (
            self._client.table("mcp_instance")
            .delete()
            .eq("id", mcp_id)
            .execute()
        )
        return len(response.data) > 0

    def delete_by_api_key(self, api_key: str) -> bool:
        """
        根据 API Key 删除 MCP 实例

        Args:
            api_key: MCP API Key

        Returns:
            是否删除成功
        """
        response = (
            self._client.table("mcp_instance")
            .delete()
            .eq("api_key", api_key)
            .execute()
        )
        return len(response.data) > 0
