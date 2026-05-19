"""Persistence boundary for Version Engine transaction side effects.

The Write Engine is the application-level publish authority. It should
decide *what* lifecycle facts need to be recorded, but not know *how* Supabase
stores them. Concrete implementations live under ``version_engine.server``.
"""

from __future__ import annotations

from typing import Protocol


class VersionTransactionLedger(Protocol):
    """Repository contract for non-commit transaction lifecycle records."""

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
        ...

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
        ...

    def load_pending_conflict(
        self,
        project_id: str,
        pending_conflict_id: str,
    ) -> dict | None:
        ...

    def mark_pending_conflict(
        self,
        *,
        project_id: str,
        pending_conflict_id: str,
        status: str,
        resolver_actor: str,
    ) -> None:
        ...

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
        ...


class NoopVersionTransactionLedger:
    """Test/default ledger for in-memory repositories without persistence."""

    def insert_version_transaction(self, **_: object) -> int | None:
        return None

    def record_pending_conflict(self, **_: object) -> None:
        return None

    def load_pending_conflict(
        self,
        project_id: str,
        pending_conflict_id: str,
    ) -> dict | None:
        return None

    def mark_pending_conflict(self, **_: object) -> None:
        return None

    def close_pending_conflict(self, **_: object) -> None:
        return None
