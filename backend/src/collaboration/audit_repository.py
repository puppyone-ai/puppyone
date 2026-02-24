"""
L2 Collaboration — AuditRepository

audit_logs 表的数据访问层。
"""

from typing import Optional, Any, List
from src.supabase.client import SupabaseClient


class AuditRepository:
    """audit_logs 表的数据访问"""

    TABLE_NAME = "audit_logs"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def insert(
        self,
        action: str,
        node_id: str,
        operator_type: str = "user",
        operator_id: Optional[str] = None,
        old_version: Optional[int] = None,
        new_version: Optional[int] = None,
        status: Optional[str] = None,
        strategy: Optional[str] = None,
        conflict_details: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        """插入一条审计日志"""
        data: dict[str, Any] = {
            "action": action,
            "node_id": node_id,
            "operator_type": operator_type,
        }
        if operator_id is not None:
            data["operator_id"] = operator_id
        if old_version is not None:
            data["old_version"] = old_version
        if new_version is not None:
            data["new_version"] = new_version
        if status is not None:
            data["status"] = status
        if strategy is not None:
            data["strategy"] = strategy
        if conflict_details is not None:
            data["conflict_details"] = conflict_details
        if metadata is not None:
            data["metadata"] = metadata

        self.client.table(self.TABLE_NAME).insert(data).execute()

    def list_by_node(
        self, node_id: str, limit: int = 50, offset: int = 0
    ) -> List[dict]:
        """查询节点的审计日志"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("node_id", node_id)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return response.data
