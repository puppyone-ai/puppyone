"""
SupabaseAuditManager — Mut Audit 的 PostgreSQL 实现

复用现有 audit_logs 表，扩展支持 Mut 审计事件（clone/push/pull）。
与 Mut 原生的 AuditLog（文件系统 JSON）接口一致。
"""

from __future__ import annotations

import json
from typing import Optional

from src.supabase.client import SupabaseClient
from src.utils.logger import log_error


class SupabaseAuditManager:
    """Mut AuditLog 的 Supabase/PostgreSQL 实现。

    复用 audit_logs 表。Mut 审计事件映射:
      event_type → action
      agent_id   → operator_id
      detail     → metadata (JSONB)
    """

    TABLE = "audit_logs"

    def __init__(self, supabase: SupabaseClient, project_id: str):
        self._client = supabase.client
        self._project_id = project_id

    def record(self, event_type: str, agent_id: str, detail: dict) -> None:
        data = {
            "action": event_type,
            "operator_type": _infer_operator_type(agent_id),
            "operator_id": agent_id,
            "project_id": self._project_id,
            "metadata": detail,
        }
        try:
            self._client.table(self.TABLE).insert(data).execute()
        except Exception as e:
            log_error(f"[MutAudit] Failed to record {event_type}: {e}")

    async def async_record(self, event_type: str, agent_id: str, detail: dict) -> None:
        import asyncio
        await asyncio.to_thread(self.record, event_type, agent_id, detail)


def _infer_operator_type(who: str) -> str:
    if not who:
        return "system"
    if who.startswith("agent:"):
        return "agent"
    if who.startswith("sync:"):
        return "sync"
    if who.startswith("user:"):
        return "user"
    return "system"
