"""
Supabase 数据访问层

提供针对 user_temp、project、table 三个表的增删改查操作。
"""

from typing import List, Optional
from supabase import Client

from src.supabase.client import SupabaseClient
from src.supabase.exceptions import handle_supabase_error
from src.supabase.schemas import (
    UserCreate,
    UserUpdate,
    UserResponse,
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    TableCreate,
    TableUpdate,
    TableResponse,
    McpCreate,
    McpUpdate,
    McpResponse,
)


class SupabaseRepository:
    """Supabase 数据访问仓库"""

    def __init__(self, client: Optional[Client] = None):
        """
        初始化仓库

        Args:
            client: 可选的 Supabase 客户端，如果不提供则使用单例客户端
        """
        if client is None:
            self._client = SupabaseClient().get_client()
        else:
            self._client = client

    # ==================== User 相关操作 ====================

    def create_user(self, user_data: UserCreate) -> UserResponse:
        """
        创建用户

        Args:
            user_data: 用户创建数据

        Returns:
            创建的用户数据

        Raises:
            SupabaseException: 当创建失败时
        """
        try:
            data = user_data.model_dump(exclude_none=True)
            # 确保不包含 id 和 created_at（这些由数据库自动生成）
            data.pop("id", None)
            data.pop("created_at", None)
            response = self._client.table("user_temp").insert(data).execute()
            return UserResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建用户")

    def get_user(self, user_id: int) -> Optional[UserResponse]:
        """
        根据 ID 获取用户

        Args:
            user_id: 用户 ID

        Returns:
            用户数据，如果不存在则返回 None
        """
        response = (
            self._client.table("user_temp")
            .select("*")
            .eq("id", str(user_id))
            .execute()
        )
        if response.data:
            return UserResponse(**response.data[0])
        return None

    def get_users(
        self,
        skip: int = 0,
        limit: int = 100,
        name: Optional[str] = None,
    ) -> List[UserResponse]:
        """
        获取用户列表

        Args:
            skip: 跳过记录数
            limit: 返回记录数
            name: 可选，按名称过滤

        Returns:
            用户列表
        """
        query = self._client.table("user_temp").select("*")

        if name:
            query = query.eq("name", name)

        response = query.range(skip, skip + limit - 1).execute()
        return [UserResponse(**item) for item in response.data]

    def update_user(
        self, user_id: int, user_data: UserUpdate
    ) -> Optional[UserResponse]:
        """
        更新用户

        Args:
            user_id: 用户 ID
            user_data: 用户更新数据

        Returns:
            更新后的用户数据，如果不存在则返回 None

        Raises:
            SupabaseException: 当更新失败时
        """
        try:
            data = user_data.model_dump(exclude_none=True)
            if not data:
                return self.get_user(user_id)

            # 确保不包含 id 和 created_at
            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table("user_temp")
                .update(data)
                .eq("id", str(user_id))
                .execute()
            )
            if response.data:
                return UserResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新用户")

    def delete_user(self, user_id: int) -> bool:
        """
        删除用户

        Args:
            user_id: 用户 ID

        Returns:
            是否删除成功
        """
        response = (
            self._client.table("user_temp")
            .delete()
            .eq("id", str(user_id))
            .execute()
        )
        return len(response.data) > 0

    # ==================== Project 相关操作 ====================

    def create_project(self, project_data: ProjectCreate) -> ProjectResponse:
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

    def get_project(self, project_id: int) -> Optional[ProjectResponse]:
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

    def get_projects(
        self,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[int] = None,
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

    def update_project(
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
                return self.get_project(project_id)

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

    def delete_project(self, project_id: int) -> bool:
        """
        删除项目

        Args:
            project_id: 项目 ID

        Returns:
            是否删除成功
        """
        response = (
            self._client.table("project")
            .delete()
            .eq("id", project_id)
            .execute()
        )
        return len(response.data) > 0

    # ==================== Table 相关操作 ====================

    def create_table(self, table_data: TableCreate) -> TableResponse:
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

    def get_table(self, table_id: int) -> Optional[TableResponse]:
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

    def get_tables(
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

    def update_table(
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
                return self.get_table(table_id)

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

    def delete_table(self, table_id: int) -> bool:
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

    # ==================== MCP 相关操作 ====================

    def create_mcp(self, mcp_data: McpCreate) -> McpResponse:
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
            response = self._client.table("mcp").insert(data).execute()
            return McpResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建 MCP 实例")

    def get_mcp(self, mcp_id: int) -> Optional[McpResponse]:
        """
        根据 ID 获取 MCP 实例

        Args:
            mcp_id: MCP 实例 ID

        Returns:
            MCP 实例数据，如果不存在则返回 None
        """
        response = (
            self._client.table("mcp")
            .select("*")
            .eq("id", mcp_id)
            .execute()
        )
        if response.data:
            return McpResponse(**response.data[0])
        return None

    def get_mcp_by_api_key(self, api_key: str) -> Optional[McpResponse]:
        """
        根据 API Key 获取 MCP 实例

        Args:
            api_key: MCP API Key

        Returns:
            MCP 实例数据，如果不存在则返回 None
        """
        response = (
            self._client.table("mcp")
            .select("*")
            .eq("api_key", api_key)
            .execute()
        )
        if response.data:
            return McpResponse(**response.data[0])
        return None

    def get_mcps(
        self,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[int] = None,
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
        query = self._client.table("mcp").select("*")

        if user_id is not None:
            query = query.eq("user_id", user_id)

        if project_id is not None:
            query = query.eq("project_id", project_id)

        if table_id is not None:
            query = query.eq("table_id", table_id)

        response = query.range(skip, skip + limit - 1).execute()
        return [McpResponse(**item) for item in response.data]

    def update_mcp(
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
                return self.get_mcp(mcp_id)

            # 确保不包含 id 和 created_at
            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table("mcp")
                .update(data)
                .eq("id", mcp_id)
                .execute()
            )
            if response.data:
                return McpResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新 MCP 实例")

    def update_mcp_by_api_key(
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
                return self.get_mcp_by_api_key(api_key)

            # 确保不包含 id 和 created_at
            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table("mcp")
                .update(data)
                .eq("api_key", api_key)
                .execute()
            )
            if response.data:
                return McpResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新 MCP 实例")

    def delete_mcp(self, mcp_id: int) -> bool:
        """
        删除 MCP 实例

        Args:
            mcp_id: MCP 实例 ID

        Returns:
            是否删除成功
        """
        response = (
            self._client.table("mcp")
            .delete()
            .eq("id", mcp_id)
            .execute()
        )
        return len(response.data) > 0

    def delete_mcp_by_api_key(self, api_key: str) -> bool:
        """
        根据 API Key 删除 MCP 实例

        Args:
            api_key: MCP API Key

        Returns:
            是否删除成功
        """
        response = (
            self._client.table("mcp")
            .delete()
            .eq("api_key", api_key)
            .execute()
        )
        return len(response.data) > 0
