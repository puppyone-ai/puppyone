"""
DB Connector Sync Job - 定时重跑查询刷新 Mut tree 文件数据。
"""

import json
from typing import Any

from src.connectors.database.repository import DBConnectionRepository
from src.connectors.database.providers import get_provider
from src.connectors.datasource.repository import SyncRepository
from src.infra.supabase.client import SupabaseClient
from src.utils.logger import log_info, log_error


async def db_sync_job(ctx: dict[str, Any], content_node_id: str) -> dict[str, Any]:
    """
    重跑某个 content path 关联的 REST API 查询，刷新数据。

    由 Scheduler 定时触发，在 Worker 进程中执行。

    Args:
        ctx: ARQ context
        content_node_id: 要刷新的 content path (Mut tree path)
    """
    db_repo: DBConnectionRepository = ctx["db_repo"]

    try:
        sync_repo = SyncRepository(SupabaseClient())
        sync = sync_repo.get_by_node(content_node_id)
        sync_config = sync.config if sync else {}

        if not sync_config:
            return {"ok": False, "error": "No sync config found for node"}

        connection_id = sync_config.get("connection_id")
        table = sync_config.get("table")
        project_id = sync_config.get("project_id")

        if not connection_id or not table:
            return {"ok": False, "error": "Missing connection_id or table in sync_config"}

        if not project_id:
            return {"ok": False, "error": "Missing project_id in sync_config"}

        connection = db_repo.get_by_id(connection_id)
        if not connection or not connection.is_active:
            log_error(f"DB sync: connection {connection_id} not found or inactive")
            return {"ok": False, "error": "Connection not found or inactive"}

        log_info(f"DB sync: running query for path {content_node_id}")
        provider = get_provider(connection.provider)
        result = await provider.query_table(
            connection.config,
            table=table,
            select=sync_config.get("select", "*"),
            filters=sync_config.get("filters"),
            order=sync_config.get("order"),
            limit=sync_config.get("limit", 1000),
        )

        new_content = {
            "columns": result.columns,
            "rows": result.rows,
            "row_count": result.row_count,
        }

        from src.mut_engine.dependencies import create_ephemeral_client
        auth_ctx = {
            "agent": f"db_connector:{connection_id}",
            "_scope": {"id": "_db_sync", "path": "", "exclude": [], "mode": "rw"},
        }
        client = create_ephemeral_client(project_id, auth_ctx)
        client.clone()
        content_bytes = json.dumps(new_content, ensure_ascii=False, indent=2).encode("utf-8")
        client.push(
            modified={content_node_id: content_bytes},
            message=f"DB sync refresh for table '{table}'",
            who=f"db_connector:{connection_id}",
        )

        db_repo.update_last_used(connection_id)

        log_info(f"DB sync completed: path={content_node_id}, rows={result.row_count}")
        return {
            "ok": True,
            "content_node_id": content_node_id,
            "row_count": result.row_count,
        }

    except Exception as e:
        log_error(f"DB sync failed: path={content_node_id}, error={e}")
        return {"ok": False, "error": str(e)}
