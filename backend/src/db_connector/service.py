"""DB Connector Service - 核心业务逻辑"""

import logging
from typing import Any, List

from src.db_connector.models import DBConnection
from src.db_connector.repository import DBConnectionRepository
from src.db_connector.providers import get_provider
from src.db_connector.providers.base import QueryResult, TableInfo
from src.content_node.service import ContentNodeService
from src.project.service import ProjectService
from src.exceptions import NotFoundException, ErrorCode

logger = logging.getLogger(__name__)


class DBConnectorService:
    """
    DB Connector 核心服务。

    职责：
    - 连接管理（CRUD）
    - 列出表 / 预览表数据
    - 保存整张表为 content_node
    """

    def __init__(
        self,
        repo: DBConnectionRepository,
        node_service: ContentNodeService,
        project_service: ProjectService,
    ):
        self.repo = repo
        self.node_service = node_service
        self.project_service = project_service

    # === 连接管理 ===

    async def create_connection(
        self,
        user_id: str,
        project_id: str,
        name: str,
        provider: str,
        config: dict,
    ) -> dict[str, Any]:
        """创建连接并立即测试。"""
        db_provider = get_provider(provider)
        test_result = await db_provider.test_connection(config)

        connection = self.repo.create(
            created_by=user_id,
            project_id=project_id,
            name=name,
            provider=provider,
            config=config,
        )

        return {
            "connection": connection,
            "database_info": test_result,
        }

    def get_connection(self, connection_id: str, user_id: str) -> DBConnection:
        conn = self.repo.get_by_id(connection_id)
        if not conn:
            raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)
        # Access check: verify user has access to the connection's project
        if not self.project_service.verify_project_access(conn.project_id, user_id):
            raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)
        return conn

    def list_connections(self, project_id: str, user_id: str) -> List[DBConnection]:
        if not self.project_service.verify_project_access(project_id, user_id):
            raise NotFoundException("Project not found", code=ErrorCode.NOT_FOUND)
        return self.repo.list_by_project(project_id)

    def delete_connection(self, connection_id: str, user_id: str) -> bool:
        conn = self.get_connection(connection_id, user_id)
        return self.repo.delete(conn.id)

    # === 表数据 ===

    async def list_tables(self, connection_id: str, user_id: str) -> list[TableInfo]:
        """列出所有表（含列信息）"""
        conn = self.get_connection(connection_id, user_id)
        provider = get_provider(conn.provider)
        tables = await provider.list_tables(conn.config)
        self.repo.update_last_used(conn.id)
        return tables

    async def preview_table(
        self,
        connection_id: str,
        user_id: str,
        table: str,
        limit: int = 50,
    ) -> QueryResult:
        """预览某张表的数据"""
        conn = self.get_connection(connection_id, user_id)
        provider = get_provider(conn.provider)

        result = await provider.query_table(
            conn.config,
            table=table,
            limit=limit,
        )

        self.repo.update_last_used(conn.id)
        return result

    # === 保存表数据 ===

    async def save_table(
        self,
        connection_id: str,
        user_id: str,
        project_id: str,
        name: str,
        table: str,
        limit: int = 1000,
    ) -> dict[str, Any]:
        """拉取整张表数据并保存为 content_node。"""
        conn = self.get_connection(connection_id, user_id)
        provider = get_provider(conn.provider)

        result = await provider.query_table(
            conn.config,
            table=table,
            limit=limit,
        )

        content_data = {
            "columns": result.columns,
            "rows": result.rows,
            "row_count": result.row_count,
        }

        content_node = await self.node_service.create_synced_node(
            project_id=project_id,
            name=name,
            content=content_data,
            created_by=user_id,
        )

        self.repo.update_last_used(conn.id)

        return {
            "content_node_id": str(content_node.id),
            "row_count": result.row_count,
        }
