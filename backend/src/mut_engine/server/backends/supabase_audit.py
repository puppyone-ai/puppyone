"""
SupabaseAuditManager — PostgreSQL implementation of Mut Audit

Reuses the existing audit_logs table, extended to support Mut audit events (clone/push/pull).
Interface-compatible with Mut's native AuditLog (filesystem JSON).
"""

from __future__ import annotations

from src.infra.supabase.client import SupabaseClient
from src.utils.logger import log_error


class SupabaseAuditManager:
    """Supabase/PostgreSQL implementation of Mut AuditLog.

    Reuses the audit_logs table. Mut audit event field mapping:
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
