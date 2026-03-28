"""
Supabase data access layer (Facade).

Provides CRUD operations for user_temp, project, table, and mcp tables.
This class implements the Facade pattern, delegating to individual sub-module Repositories.
"""

from typing import List, Optional
from supabase import Client

from src.infra.supabase.client import SupabaseClient

# Import each sub-module's Repository
from src.platform.project.supabase_repo import ProjectRepository
from src.content.table.supabase_repo import TableRepository
from src.infra.mcp_server.supabase_repo import McpRepository
from src.tool.supabase_repo import ToolRepository
from src.context_publish.supabase_repo import ContextPublishRepository

from src.platform.project.supabase_schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
)
from src.content.table.supabase_schemas import (
    TableCreate,
    TableUpdate,
    TableResponse,
)
from src.infra.mcp_server.supabase_schemas import (
    McpCreate,
    McpUpdate,
    McpResponse,
)
from src.tool.supabase_schemas import ToolCreate, ToolUpdate, ToolResponse
from src.context_publish.supabase_schemas import (
    ContextPublishCreate,
    ContextPublishUpdate,
    ContextPublishResponse,
)


class SupabaseRepository:
    """Supabase data access repository (Facade)"""

    def __init__(self, client: Optional[Client] = None):
        """
        Initialize repository.

        Args:
            client: Optional Supabase client; uses singleton client if not provided
        """
        if client is None:
            self._client = SupabaseClient().get_client()
        else:
            self._client = client

        # Initialize sub-repositories
        self._project_repo = ProjectRepository(self._client)
        self._table_repo = TableRepository(self._client)
        self._mcp_repo = McpRepository(self._client)
        self._tool_repo = ToolRepository(self._client)
        self._context_publish_repo = ContextPublishRepository(self._client)

    # ==================== Project Operations ====================

    def create_project(self, project_data: ProjectCreate) -> ProjectResponse:
        """
        Create a project.

        Args:
            project_data: Project creation data

        Returns:
            Created project data

        Raises:
            SupabaseException: When creation fails
        """
        return self._project_repo.create(project_data)

    def get_project(self, project_id: str) -> Optional[ProjectResponse]:
        """
        Get project by ID.

        Args:
            project_id: Project ID

        Returns:
            Project data, or None if not found
        """
        return self._project_repo.get_by_id(project_id)

    def get_projects(
        self,
        skip: int = 0,
        limit: int = 100,
        org_id: Optional[str] = None,
        name: Optional[str] = None,
    ) -> List[ProjectResponse]:
        """
        Get project list.

        Args:
            skip: Number of records to skip
            limit: Number of records to return
            org_id: Optional, filter by organization ID
            name: Optional, filter by name

        Returns:
            List of projects
        """
        return self._project_repo.get_list(
            skip=skip, limit=limit, org_id=org_id, name=name
        )

    def update_project(
        self, project_id: str, project_data: ProjectUpdate
    ) -> Optional[ProjectResponse]:
        """
        Update a project.

        Args:
            project_id: Project ID
            project_data: Project update data

        Returns:
            Updated project data, or None if not found

        Raises:
            SupabaseException: When update fails
        """
        return self._project_repo.update(project_id, project_data)

    def delete_project(self, project_id: str) -> bool:
        """
        Delete a project.

        Args:
            project_id: Project ID

        Returns:
            Whether deletion was successful
        """
        return self._project_repo.delete(project_id)

    # ==================== Table Operations ====================

    def create_table(self, table_data: TableCreate) -> TableResponse:
        """
        Create a table.

        Args:
            table_data: Table creation data

        Returns:
            Created table data

        Raises:
            SupabaseException: When creation fails
        """
        return self._table_repo.create(table_data)

    def get_table(self, table_id: str) -> Optional[TableResponse]:
        """
        Get table by ID.

        Args:
            table_id: Table ID

        Returns:
            Table data, or None if not found
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
        Get table list.

        Args:
            skip: Number of records to skip
            limit: Number of records to return
            project_id: Optional, filter by project ID
            name: Optional, filter by name

        Returns:
            List of tables
        """
        return self._table_repo.get_list(
            skip=skip, limit=limit, project_id=project_id, name=name
        )

    def update_table(
        self, table_id: str, table_data: TableUpdate
    ) -> Optional[TableResponse]:
        """
        Update a table.

        Args:
            table_id: Table ID
            table_data: Table update data

        Returns:
            Updated table data, or None if not found

        Raises:
            SupabaseException: When update fails
        """
        return self._table_repo.update(table_id, table_data)

    def delete_table(self, table_id: str) -> bool:
        """
        Delete a table.

        Args:
            table_id: Table ID

        Returns:
            Whether deletion was successful
        """
        return self._table_repo.delete(table_id)

    # ==================== MCP Operations ====================

    def create_mcp(self, mcp_data: McpCreate) -> McpResponse:
        """
        Create an MCP instance.

        Args:
            mcp_data: MCP creation data

        Returns:
            Created MCP instance data

        Raises:
            SupabaseException: When creation fails
        """
        return self._mcp_repo.create(mcp_data)

    def get_mcp(self, mcp_id: str) -> Optional[McpResponse]:
        """
        Get MCP instance by ID.

        Args:
            mcp_id: MCP instance ID

        Returns:
            MCP instance data, or None if not found
        """
        return self._mcp_repo.get_by_id(mcp_id)

    def get_mcp_by_api_key(self, api_key: str) -> Optional[McpResponse]:
        """
        Get MCP instance by API Key.

        Args:
            api_key: MCP API Key

        Returns:
            MCP instance data, or None if not found
        """
        return self._mcp_repo.get_by_api_key(api_key)

    def get_mcps(
        self,
        skip: int = 0,
        limit: int = 100,
        project_id: Optional[str] = None,
        table_id: Optional[str] = None,
    ) -> List[McpResponse]:
        """
        Get MCP instance list (filtered by project_id, no longer by user_id).

        Args:
            skip: Number of records to skip
            limit: Number of records to return
            project_id: Optional, filter by project ID
            table_id: Optional, filter by table ID

        Returns:
            List of MCP instances
        """
        return self._mcp_repo.get_list(
            skip=skip,
            limit=limit,
            project_id=project_id,
            table_id=table_id,
        )

    def update_mcp(self, mcp_id: str, mcp_data: McpUpdate) -> Optional[McpResponse]:
        """
        Update an MCP instance.

        Args:
            mcp_id: MCP instance ID
            mcp_data: MCP update data

        Returns:
            Updated MCP instance data, or None if not found

        Raises:
            SupabaseException: When update fails
        """
        return self._mcp_repo.update(mcp_id, mcp_data)

    def update_mcp_by_api_key(
        self, api_key: str, mcp_data: McpUpdate
    ) -> Optional[McpResponse]:
        """
        Update MCP instance by API Key.

        Args:
            api_key: MCP API Key
            mcp_data: MCP update data

        Returns:
            Updated MCP instance data, or None if not found

        Raises:
            SupabaseException: When update fails
        """
        return self._mcp_repo.update_by_api_key(api_key, mcp_data)

    def delete_mcp(self, mcp_id: str) -> bool:
        """
        Delete an MCP instance.

        Args:
            mcp_id: MCP instance ID

        Returns:
            Whether deletion was successful
        """
        return self._mcp_repo.delete(mcp_id)

    def delete_mcp_by_api_key(self, api_key: str) -> bool:
        """
        Delete MCP instance by API Key.

        Args:
            api_key: MCP API Key

        Returns:
            Whether deletion was successful
        """
        return self._mcp_repo.delete_by_api_key(api_key)

    # ==================== Tool Operations ====================

    def create_tool(self, tool_data: ToolCreate) -> ToolResponse:
        return self._tool_repo.create(tool_data)

    def get_tool(self, tool_id: str) -> Optional[ToolResponse]:
        return self._tool_repo.get_by_id(tool_id)

    def get_tools(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        org_id: Optional[str] = None,
        path: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> List[ToolResponse]:
        return self._tool_repo.get_list(
            skip=skip, limit=limit, org_id=org_id, path=path, project_id=project_id
        )

    def update_tool(
        self, tool_id: str, tool_data: ToolUpdate
    ) -> Optional[ToolResponse]:
        return self._tool_repo.update(tool_id, tool_data)

    def delete_tool(self, tool_id: str) -> bool:
        return self._tool_repo.delete(tool_id)

    # ==================== Context Publish Operations ====================

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
        created_by: Optional[str] = None,
    ) -> List[ContextPublishResponse]:
        return self._context_publish_repo.get_list(
            skip=skip, limit=limit, created_by=created_by
        )

    def update_context_publish(
        self, publish_id: str, data: ContextPublishUpdate
    ) -> Optional[ContextPublishResponse]:
        return self._context_publish_repo.update(publish_id, data)

    def delete_context_publish(self, publish_id: str) -> bool:
        return self._context_publish_repo.delete(publish_id)
