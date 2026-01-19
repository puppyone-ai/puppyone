"""
Supabase 数据访问层 (Facade)

提供针对 user_temp、project、table、mcp 表的增删改查操作。
此类作为 Facade 模式的实现，委托给各个子模块的 Repository。
"""

from typing import List, Optional
from supabase import Client

from src.supabase.client import SupabaseClient

# 导入各个子模块的 Repository
from src.supabase.projects.repository import ProjectRepository
from src.supabase.tables.repository import TableRepository
from src.supabase.mcps.repository import McpRepository
from src.supabase.tools.repository import ToolRepository
from src.supabase.mcp_v2.repository import McpV2Repository
from src.supabase.mcp_binding.repository import McpBindingRepository
from src.supabase.context_publish.repository import ContextPublishRepository

# 导入各个子模块的 Schema
from src.supabase.projects.schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
)
from src.supabase.tables.schemas import (
    TableCreate,
    TableUpdate,
    TableResponse,
)
from src.supabase.mcps.schemas import (
    McpCreate,
    McpUpdate,
    McpResponse,
)
from src.supabase.tools.schemas import ToolCreate, ToolUpdate, ToolResponse
from src.supabase.mcp_v2.schemas import McpV2Create, McpV2Update, McpV2Response
from src.supabase.mcp_binding.schemas import (
    McpBindingCreate,
    McpBindingUpdate,
    McpBindingResponse,
)
from src.supabase.context_publish.schemas import (
    ContextPublishCreate,
    ContextPublishUpdate,
    ContextPublishResponse,
)


class SupabaseRepository:
    """Supabase 数据访问仓库 (Facade)"""

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

        # 初始化各个子仓库
        self._project_repo = ProjectRepository(self._client)
        self._table_repo = TableRepository(self._client)
        self._mcp_repo = McpRepository(self._client)
        self._tool_repo = ToolRepository(self._client)
        self._mcp_v2_repo = McpV2Repository(self._client)
        self._mcp_binding_repo = McpBindingRepository(self._client)
        self._context_publish_repo = ContextPublishRepository(self._client)

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
        return self._project_repo.create(project_data)

    def get_project(self, project_id: str) -> Optional[ProjectResponse]:
        """
        根据 ID 获取项目

        Args:
            project_id: 项目 ID

        Returns:
            项目数据，如果不存在则返回 None
        """
        return self._project_repo.get_by_id(project_id)

    def get_projects(
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
        return self._project_repo.get_list(
            skip=skip, limit=limit, user_id=user_id, name=name
        )

    def update_project(
        self, project_id: str, project_data: ProjectUpdate
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
        return self._project_repo.update(project_id, project_data)

    def delete_project(self, project_id: str) -> bool:
        """
        删除项目

        Args:
            project_id: 项目 ID

        Returns:
            是否删除成功
        """
        return self._project_repo.delete(project_id)

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
        return self._table_repo.create(table_data)

    def get_table(self, table_id: str) -> Optional[TableResponse]:
        """
        根据 ID 获取表

        Args:
            table_id: 表 ID

        Returns:
            表数据，如果不存在则返回 None
        """
        return self._table_repo.get_by_id(table_id)

    def get_tables(
        self,
        skip: int = 0,
        limit: int = 100,
        project_id: Optional[str] = None,
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
        return self._table_repo.get_list(
            skip=skip, limit=limit, project_id=project_id, name=name
        )

    def update_table(
        self, table_id: str, table_data: TableUpdate
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
        return self._table_repo.update(table_id, table_data)

    def delete_table(self, table_id: str) -> bool:
        """
        删除表

        Args:
            table_id: 表 ID

        Returns:
            是否删除成功
        """
        return self._table_repo.delete(table_id)

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
        return self._mcp_repo.create(mcp_data)

    def get_mcp(self, mcp_id: str) -> Optional[McpResponse]:
        """
        根据 ID 获取 MCP 实例

        Args:
            mcp_id: MCP 实例 ID

        Returns:
            MCP 实例数据，如果不存在则返回 None
        """
        return self._mcp_repo.get_by_id(mcp_id)

    def get_mcp_by_api_key(self, api_key: str) -> Optional[McpResponse]:
        """
        根据 API Key 获取 MCP 实例

        Args:
            api_key: MCP API Key

        Returns:
            MCP 实例数据，如果不存在则返回 None
        """
        return self._mcp_repo.get_by_api_key(api_key)

    def get_mcps(
        self,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        table_id: Optional[str] = None,
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
        return self._mcp_repo.get_list(
            skip=skip,
            limit=limit,
            user_id=user_id,
            project_id=project_id,
            table_id=table_id,
        )

    def update_mcp(self, mcp_id: str, mcp_data: McpUpdate) -> Optional[McpResponse]:
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
        return self._mcp_repo.update(mcp_id, mcp_data)

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
        return self._mcp_repo.update_by_api_key(api_key, mcp_data)

    def delete_mcp(self, mcp_id: str) -> bool:
        """
        删除 MCP 实例

        Args:
            mcp_id: MCP 实例 ID

        Returns:
            是否删除成功
        """
        return self._mcp_repo.delete(mcp_id)

    def delete_mcp_by_api_key(self, api_key: str) -> bool:
        """
        根据 API Key 删除 MCP 实例

        Args:
            api_key: MCP API Key

        Returns:
            是否删除成功
        """
        return self._mcp_repo.delete_by_api_key(api_key)

    # ==================== Tool 相关操作 ====================

    def create_tool(self, tool_data: ToolCreate) -> ToolResponse:
        return self._tool_repo.create(tool_data)

    def get_tool(self, tool_id: str) -> Optional[ToolResponse]:
        return self._tool_repo.get_by_id(tool_id)

    def get_tools(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[str] = None,
        table_id: Optional[str] = None,
    ) -> List[ToolResponse]:
        return self._tool_repo.get_list(
            skip=skip, limit=limit, user_id=user_id, table_id=table_id
        )

    def update_tool(
        self, tool_id: str, tool_data: ToolUpdate
    ) -> Optional[ToolResponse]:
        return self._tool_repo.update(tool_id, tool_data)

    def delete_tool(self, tool_id: str) -> bool:
        return self._tool_repo.delete(tool_id)

    # ==================== MCP v2 相关操作 ====================

    def create_mcp_v2(self, data: McpV2Create) -> McpV2Response:
        return self._mcp_v2_repo.create(data)

    def get_mcp_v2(self, mcp_id: str) -> Optional[McpV2Response]:
        return self._mcp_v2_repo.get_by_id(mcp_id)

    def get_mcp_v2_by_api_key(self, api_key: str) -> Optional[McpV2Response]:
        return self._mcp_v2_repo.get_by_api_key(api_key)

    def get_mcp_v2_list(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[str] = None,
    ) -> List[McpV2Response]:
        return self._mcp_v2_repo.get_list(skip=skip, limit=limit, user_id=user_id)

    def update_mcp_v2(self, mcp_id: str, data: McpV2Update) -> Optional[McpV2Response]:
        return self._mcp_v2_repo.update(mcp_id, data)

    def delete_mcp_v2(self, mcp_id: str) -> bool:
        return self._mcp_v2_repo.delete(mcp_id)

    # ==================== MCP Binding 相关操作 ====================

    def create_mcp_binding(self, data: McpBindingCreate) -> McpBindingResponse:
        return self._mcp_binding_repo.create(data)

    def get_mcp_binding(self, binding_id: str) -> Optional[McpBindingResponse]:
        return self._mcp_binding_repo.get_by_id(binding_id)

    def get_mcp_binding_by_mcp_and_tool(
        self, mcp_id: str, tool_id: str
    ) -> Optional[McpBindingResponse]:
        return self._mcp_binding_repo.get_by_mcp_and_tool(mcp_id, tool_id)

    def get_mcp_bindings_by_mcp_id(
        self,
        mcp_id: str,
        *,
        skip: int = 0,
        limit: int = 1000,
    ) -> List[McpBindingResponse]:
        return self._mcp_binding_repo.get_list_by_mcp_id(mcp_id, skip=skip, limit=limit)

    def get_mcp_bindings_by_tool_id(
        self,
        tool_id: str,
        *,
        skip: int = 0,
        limit: int = 1000,
    ) -> List[McpBindingResponse]:
        return self._mcp_binding_repo.get_list_by_tool_id(
            tool_id, skip=skip, limit=limit
        )

    def update_mcp_binding(
        self, binding_id: str, data: McpBindingUpdate
    ) -> Optional[McpBindingResponse]:
        return self._mcp_binding_repo.update(binding_id, data)

    def delete_mcp_binding(self, binding_id: str) -> bool:
        return self._mcp_binding_repo.delete(binding_id)

    # ==================== Context Publish 相关操作 ====================

    def create_context_publish(
        self, data: ContextPublishCreate
    ) -> ContextPublishResponse:
        return self._context_publish_repo.create(data)

    def get_context_publish(self, publish_id: str) -> Optional[ContextPublishResponse]:
        return self._context_publish_repo.get_by_id(publish_id)

    def get_context_publish_by_key(
        self, publish_key: str
    ) -> Optional[ContextPublishResponse]:
        return self._context_publish_repo.get_by_publish_key(publish_key)

    def get_context_publish_list(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[str] = None,
    ) -> List[ContextPublishResponse]:
        return self._context_publish_repo.get_list(
            skip=skip, limit=limit, user_id=user_id
        )

    def update_context_publish(
        self, publish_id: str, data: ContextPublishUpdate
    ) -> Optional[ContextPublishResponse]:
        return self._context_publish_repo.update(publish_id, data)

    def delete_context_publish(self, publish_id: str) -> bool:
        return self._context_publish_repo.delete(publish_id)
