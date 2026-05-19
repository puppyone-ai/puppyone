"""Supabase implementation of the Version Engine transaction ledger."""

from __future__ import annotations

from src.version_engine.infrastructure.supabase.db_names import CONFLICTS_TABLE, VERSION_OUTBOX_TABLE
from src.utils.logger import log_warning


class SupabaseVersionTransactionLedger:
    """Persist pending conflicts, lifecycle rows, and resolver outbox events."""

    def __init__(self, client):
        self._client = client

    def insert_version_transaction(
        self,
        *,
        project_id: str,
        scope_path: str,
        source_channel: str,
        actor: str,
        intent_type: str,
        status: str,
        policy: str = "",
        base_commit_id: str = "",
        client_commit_id: str = "",
        proposed_tree_id: str = "",
        current_head_at_start: str = "",
        committed_commit_id: str = "",
        message: str = "",
        audit_detail: dict | None = None,
        reason: str = "",
    ) -> int | None:
        payload = {
            "project_id": project_id,
            "scope_path": scope_path or "",
            "source_channel": source_channel or "papi",
            "actor": actor or "",
            "intent_type": intent_type,
            "status": status,
            "policy": policy or "",
            "base_commit_id": base_commit_id or "",
            "client_commit_id": client_commit_id or "",
            "proposed_tree_id": proposed_tree_id or "",
            "current_head_at_start": current_head_at_start or "",
            "committed_commit_id": committed_commit_id or "",
            "message": message or "",
            "audit_detail": audit_detail or {},
            "reason": reason or "",
        }
        resp = self._client.table("version_transactions").insert(payload).execute()
        data = getattr(resp, "data", None) or []
        if data and isinstance(data[0], dict):
            return data[0].get("id")
        return None

    def record_pending_conflict(
        self,
        *,
        project_id: str,
        pending_conflict_id: str,
        scope_path: str,
        base_commit_id: str,
        current_commit_id: str,
        client_commit_id: str,
        proposed_tree_id: str,
        changed_paths: list[str],
        conflict_records: list[dict],
        policy: str,
        source_channel: str,
        actor: str,
        transaction_id: int | None = None,
    ) -> None:
        resolver_kind = _resolver_kind_for(source_channel)
        payload = {
            "pending_conflict_id": pending_conflict_id,
            "project_id": project_id,
            "scope_path": scope_path,
            "base_commit_id": base_commit_id or "",
            "current_commit_id": current_commit_id or "",
            "client_commit_id": client_commit_id or "",
            "proposed_tree_id": proposed_tree_id or "",
            "changed_paths": changed_paths,
            "conflict_records": conflict_records,
            "policy": policy,
            "status": "pending",
            "resolver_actor": "",
            "resolver_kind": resolver_kind,
            "resolution_detail": {"actor": actor, "source_channel": source_channel},
        }
        if transaction_id is not None:
            payload["transaction_id"] = transaction_id
        self._client.table(CONFLICTS_TABLE).upsert(
            payload, on_conflict="pending_conflict_id",
        ).execute()

        try:
            self._client.table(VERSION_OUTBOX_TABLE).insert({
                "project_id": project_id,
                "commit_id": "",
                "event_type": "pending_conflict_created",
                "payload": {
                    "pending_conflict_id": pending_conflict_id,
                    "scope_path": scope_path,
                    "policy": policy,
                    "transaction_id": transaction_id,
                    "source_channel": source_channel,
                    "resolver_kind": resolver_kind,
                    "changed_paths": changed_paths[:50],
                },
            }).execute()
        except Exception as exc:
            log_warning(
                f"[version_engine] failed to enqueue pending_conflict_created "
                f"outbox for {pending_conflict_id[:12]}: {exc}",
            )

    def load_pending_conflict(
        self,
        project_id: str,
        pending_conflict_id: str,
    ) -> dict | None:
        resp = (
            self._client.table(CONFLICTS_TABLE)
            .select("*")
            .eq("project_id", project_id)
            .eq("pending_conflict_id", pending_conflict_id)
            .maybe_single()
            .execute()
        )
        return getattr(resp, "data", None)

    def mark_pending_conflict(
        self,
        *,
        project_id: str,
        pending_conflict_id: str,
        status: str,
        resolver_actor: str,
    ) -> None:
        self._client.table(CONFLICTS_TABLE).update({
            "status": status,
            "resolver_actor": resolver_actor or "",
        }).eq("project_id", project_id).eq(
            "pending_conflict_id", pending_conflict_id,
        ).execute()

    def close_pending_conflict(
        self,
        *,
        project_id: str,
        pending_conflict_id: str,
        status: str,
        resolver_actor: str,
        resolution_commit_id: str,
        resolution_detail: dict,
    ) -> None:
        self._client.table(CONFLICTS_TABLE).update({
            "status": status,
            "resolver_actor": resolver_actor or "",
            "resolution_commit_id": resolution_commit_id or "",
            "resolution_detail": resolution_detail,
            "resolved_at": _now_iso(),
        }).eq("project_id", project_id).eq(
            "pending_conflict_id", pending_conflict_id,
        ).execute()


def _resolver_kind_for(source_channel: str) -> str:
    if source_channel in {"agent", "sync"}:
        return "agent"
    return "human"


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()

