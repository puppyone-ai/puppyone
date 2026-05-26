"""Git-native Write Engine facade.

This is the L5 publish authority for PuppyOne version writes. Protocol
adapters parse requests and product services build typed splices, but all
visible version facts still enter through this facade.
"""

from __future__ import annotations

import asyncio
import time

from src.version_engine.domain.intents import (
    ConflictResolutionIntent,
    OperationWriteIntent,
    RollbackIntent,
    ScopePromoteIntent,
    TransactionResult,
    VersionSubmissionIntent,
)
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager
from src.version_engine.write_engine.audit import now_iso as _now_iso
from src.version_engine.write_engine.conflict_resolution_writer import (
    ConflictResolutionWriter,
)
from src.version_engine.write_engine.errors import (
    ConcurrentMutationError,
    CrossScopeSubmissionError,
    NonFastForwardSubmissionError,
)
from src.version_engine.write_engine.ledger import (
    NoopVersionTransactionLedger,
    VersionTransactionLedger,
)
from src.version_engine.write_engine.operation_writer import OperationWriter, SpliceFn
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.publisher import (
    publish_scope_update as _publish_scope_update,
)
from src.version_engine.write_engine.rollback_writer import RollbackWriter
from src.version_engine.write_engine.submission_writer import SubmissionWriter
from src.version_engine.write_engine.trace import (
    VersionTrace,
    active_version_trace,
    trace_mark,
    trace_phase,
    use_version_trace,
)
from src.utils.logger import log_info, log_warning


class VersionWriteEngine:
    """Stable L5 entrypoint for operation and version submissions.

    The facade owns dependency wiring, public API stability, and tracing
    boundaries. Intent-specific orchestration lives in focused writer modules
    so root-first CAS, submitted-tree merges, rollback, and conflict
    resolution can evolve independently.
    """

    def __init__(
        self,
        repo_manager: VersionRepoManager,
        ledger: VersionTransactionLedger | None = None,
    ):
        self._repos = repo_manager
        self._ledger = (
            ledger
            or getattr(repo_manager, "transaction_ledger", None)
            or NoopVersionTransactionLedger()
        )
        self._operation_writer = OperationWriter(self._repos, self._ledger)
        self._submission_writer = SubmissionWriter(self._repos, self._ledger)
        self._rollback_writer = RollbackWriter(self._repos)
        self._conflict_resolution_writer = ConflictResolutionWriter(
            self._repos,
            self._ledger,
            self._submission_writer,
        )

    async def initialize_project_tree(self, project_id: str) -> str:
        """Idempotently initialize an empty project root tree.

        L5 owns all ref writes, including the initial root_hash row that marks
        a project as ready for writes.
        """
        from src.version_engine.write_engine.git_object_format import EMPTY_TREE_SHA1

        repo = self._repos.get_repo(project_id)
        existing = repo.history.get_root_hash()
        if existing:
            if existing == EMPTY_TREE_SHA1:
                return existing
            backend = repo.store._backend
            if hasattr(backend, "async_exists") and await backend.async_exists(existing):
                return existing
            log_warning(
                f"[version_engine][init] project={project_id} root_hash={existing} "
                f"present in DB but blob missing in storage; re-initializing",
            )
        repo.history.set_root_hash(EMPTY_TREE_SHA1)
        log_info(f"[version_engine][init] project={project_id} initialized empty tree")
        return EMPTY_TREE_SHA1

    async def publish_scope_promotion(
        self,
        intent: ScopePromoteIntent,
    ) -> tuple[bool, int | None]:
        """Publish a derived scope-promote commit through the L5 boundary."""

        repo = self._repos.get_server_repo(intent.project_id)
        scope_norm = normalize_path(intent.scope_path)
        with trace_phase(
            "db.publish_scope_update",
            scope=scope_norm,
            op="scope_promote",
            commit_id=intent.commit_id[:12],
        ):
            result = await asyncio.to_thread(
                repo.publish_scope_update,
                scope_path=scope_norm,
                old_scope_hash=intent.old_scope_hash,
                new_scope_hash=intent.new_scope_hash,
                commit_id=intent.commit_id,
                who=intent.actor,
                message=intent.message,
                changes=list(intent.changes),
                conflicts=None,
                created_at_iso=_now_iso(),
                audit_event_type="scope_promote",
                audit_agent_id=intent.actor or "system",
                audit_detail=dict(intent.audit_detail or {}),
                source_channel=intent.source_channel,
                policy="scope_promote",
                base_commit_id=intent.base_commit_id,
                client_commit_id="",
                proposed_tree_id=intent.new_scope_hash,
                intent_type="operation",
            )
        if isinstance(result, tuple):
            return bool(result[0]), result[1]
        return bool(result), None

    async def apply_operation(
        self,
        intent: OperationWriteIntent,
        splice: SpliceFn,
    ) -> TransactionResult:
        """Apply a typed product operation through root-first CAS."""

        started_ms = int(time.time() * 1000)
        scope_norm = normalize_path(intent.scope_path)
        log_info(
            f"[version_engine][{intent.operation_type}] start "
            f"project={intent.project_id} scope={scope_norm!r} "
            f"actor={intent.actor}",
        )

        return await self._operation_writer.apply_scoped_operation_root_first(
            intent=intent,
            splice=splice,
            started_ms=started_ms,
        )

    async def apply_project_operation(
        self,
        intent: OperationWriteIntent,
        splice: SpliceFn,
    ) -> TransactionResult:
        """Apply a product API operation against the project root."""

        started_ms = int(time.time() * 1000)
        log_info(
            f"[version_engine][{intent.operation_type}:project] start "
            f"project={intent.project_id} actor={intent.actor}",
        )
        existing_trace = active_version_trace()
        trace = existing_trace or VersionTrace(
            f"{intent.operation_type}:project",
            project_id=intent.project_id,
            scope_path="",
            actor=intent.actor,
            source_channel=intent.source_channel,
        )
        with use_version_trace(trace):
            trace_mark(
                "engine.project_operation.start",
                operation_type=intent.operation_type,
            )
            try:
                with trace.phase("engine.apply_project_operation"):
                    result = (
                        await self._operation_writer.apply_project_operation_optimistic(
                            intent=intent,
                            splice=splice,
                            started_ms=started_ms,
                        )
                    )
            except Exception:
                if existing_trace is None:
                    trace.finish(status="error")
                raise
            if existing_trace is None:
                trace.finish(
                    status=result.status,
                    commit_id=result.commit_id,
                    changes=len(result.changes or []),
                )
            return result

    async def submit_version(
        self,
        intent: VersionSubmissionIntent,
    ) -> TransactionResult:
        """Apply a proposed Git tree via root-first server-side decision."""

        started_ms = int(time.time() * 1000)
        scope_norm = normalize_path(intent.scope_path)
        log_info(
            f"[version_engine][{intent.source_channel}_submit] start "
            f"project={intent.project_id} scope={scope_norm!r} "
            f"actor={intent.actor}",
        )

        return await self._submission_writer.submit_version_root_first(
            intent,
            started_ms,
        )

    async def rollback(
        self,
        intent: RollbackIntent,
    ) -> TransactionResult:
        """Restore one scope to a historical commit via root-first CAS."""

        started_ms = int(time.time() * 1000)
        scope_norm = normalize_path(intent.scope_path)
        log_info(
            f"[version_engine][rollback] start "
            f"project={intent.project_id} scope={scope_norm!r} "
            f"actor={intent.actor} target={intent.target_commit_id[:12]}",
        )

        return await self._rollback_writer.rollback_root_first(intent, started_ms)

    async def resolve(
        self,
        intent: ConflictResolutionIntent,
    ) -> TransactionResult:
        """Apply a manual or hosted-agent resolution to a pending conflict."""

        return await self._conflict_resolution_writer.resolve(intent)


__all__ = [
    "ConcurrentMutationError",
    "CrossScopeSubmissionError",
    "NonFastForwardSubmissionError",
    "VersionWriteEngine",
]
