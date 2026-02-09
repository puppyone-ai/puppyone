"""
DB Connector Sync Job - 定时重跑查询刷新 content_node 数据。

跑在 SaaS Worker 进程里（ARQ），不阻塞 API。
"""

from typing import Any

from src.db_connector.repository import DBConnectionRepository
from src.db_connector.providers import get_provider
from src.content_node.service import ContentNodeService
from src.supabase.client import SupabaseClient
from src.utils.logger import log_info, log_error


async def db_sync_job(ctx: dict[str, Any], content_node_id: str) -> dict[str, Any]:
    """
    重跑某个 content_node 关联的 REST API 查询，刷新数据。

    由 Scheduler 定时触发，在 Worker 进程中执行。

    Args:
        ctx: ARQ context
        content_node_id: 要刷新的 content_node ID
    """
    node_service: ContentNodeService = ctx["node_service"]
    db_repo: DBConnectionRepository = ctx["db_repo"]

    try:
        # 1. 读取 content_node，获取 sync_config
        node = node_service.get_by_id_unsafe(content_node_id)

        if not node.sync_config:
            return {"ok": False, "error": "No sync_config on node"}

        connection_id = node.sync_config.get("connection_id")
        table = node.sync_config.get("table")

        if not connection_id or not table:
            return {"ok": False, "error": "Missing connection_id or table in sync_config"}

        # 2. 获取连接信息
        connection = db_repo.get_by_id(connection_id)
        if not connection or not connection.is_active:
            log_error(f"DB sync: connection {connection_id} not found or inactive")
            return {"ok": False, "error": "Connection not found or inactive"}

        # 3. 执行查询（使用保存的查询参数）
        log_info(f"DB sync: running query for node {content_node_id}")
        provider = get_provider(connection.provider)
        result = await provider.query_table(
            connection.config,
            table=table,
            select=node.sync_config.get("select", "*"),
            filters=node.sync_config.get("filters"),
            order=node.sync_config.get("order"),
            limit=node.sync_config.get("limit", 1000),
        )

        # 4. 更新 content_node 的数据
        new_content = {
            "columns": result.columns,
            "rows": result.rows,
            "row_count": result.row_count,
        }
        node_service.update_sync_content(content_node_id, new_content)

        db_repo.update_last_used(connection_id)

        log_info(f"DB sync completed: node={content_node_id}, rows={result.row_count}")
        return {
            "ok": True,
            "content_node_id": content_node_id,
            "row_count": result.row_count,
        }

    except Exception as e:
        log_error(f"DB sync failed: node={content_node_id}, error={e}")
        return {"ok": False, "error": str(e)}
