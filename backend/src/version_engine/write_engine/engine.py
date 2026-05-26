"""Git-native Write Engine.

This is the publish authority for PuppyOne version writes. Adapters may
parse protocols, and product services may build typed splices, but this
module owns the decision to turn an intent into visible Git version facts,
history, audit, and projection updates.
"""

from __future__ import annotations

import asyncio
import time
from typing import Callable

from src.version_engine.storage.object_store import (
    ObjectStore,
    stage_object_writes,
)
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.ledger import (
    NoopVersionTransactionLedger,
    VersionTransactionLedger,
)

from src.version_engine.write_engine.conflict_policy import (
    QUEUE_POLICIES,
    merge_file_sets_for_policy,
    select_conflict_policy,
)
from src.version_engine.write_engine.git_commit import (
    build_git_commit,
)
from src.version_engine.write_engine.git_object_format import EMPTY_TREE_SHA1, encode_tree
from src.version_engine.write_engine.tree_objects import (
    build_full_changes,
    build_tree_from_files,
    compute_changeset,
    flatten_tree_to_bytes,
    validate_scope_bound_files,
)
from src.version_engine.write_engine.audit import (
    audit_detail_with_pusher as _audit_detail_with_pusher,
    log_done as _log_done,
    now_iso as _now_iso,
)
from src.version_engine.write_engine.cas_retry import (
    merge_on_cas_retry as _merge_on_cas_retry,
)
from src.version_engine.write_engine.conflict_queue import (
    record_pending_conflict as _record_pending_conflict_generic,
)
from src.version_engine.write_engine.publisher import (
    publish_project_update as _publish_project_update,
    publish_scope_update as _publish_scope_update,
)
from src.version_engine.write_engine.root_state import (
    get_project_root_hash as _get_project_root_hash,
    get_project_root_state_for_write as _get_project_root_state_for_write,
    get_project_view_head as _get_project_view_head,
    get_scope_state as _get_scope_state,
    graft_scope_tree as _graft_scope_tree,
    parent_scope_files as _parent_scope_files,
    scope_tree_hash_for_write as _scope_tree_hash_for_write,
)
from src.version_engine.write_engine.scope_view import (
    build_scope_view_commit as _build_scope_view_commit,
    commit_exists as _commit_exists,
    git_safe_parent as _git_safe_parent,
)
from src.version_engine.write_engine.submission_commit import (
    select_or_create_commit as _select_or_create_commit,
)
from src.version_engine.write_engine.tree_access import (
    apply_sparse_file_merge as _apply_sparse_file_merge,
    changed_paths_from_tree_diff as _changed_paths_from_tree_diff,
    changed_relative_paths as _changed_relative_paths,
    changes_from_tree_diff as _changes_from_tree_diff,
    compute_merged_changes as _compute_merged_changes,
    files_at_commit as _files_at_commit,
    scope_files_for_head as _scope_files_for_head,
    sparse_files_at_tree_paths as _sparse_files_at_tree_paths,
    tree_hash_at_commit as _tree_hash_at_commit,
)
from src.version_engine.domain.intents import (
    ConflictResolutionIntent,
    OperationWriteIntent,
    RollbackIntent,
    ScopePromoteIntent,
    TransactionResult,
    VersionSubmissionIntent,
)
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager
from src.version_engine.write_engine.trace import (
    VersionTrace,
    active_version_trace,
    trace_mark,
    trace_phase,
    use_version_trace,
)
from src.utils.logger import log_info, log_warning


SpliceFn = Callable[[ObjectStore, str], "tuple[str, list[tuple[str, str]]]"]

_MAX_CAS_ATTEMPTS = 5


class ConcurrentMutationError(RuntimeError):
    """Raised when a caller supplied a stale scope head precondition."""

    def __init__(
        self,
        *,
        scope_path: str,
        expected_head_commit_id: str,
        current_head_commit_id: str,
    ):
        self.scope_path = scope_path
        self.expected_head_commit_id = expected_head_commit_id
        self.current_head_commit_id = current_head_commit_id
        super().__init__(
            "Scope changed since the command started. Pull the latest state "
            "or retry the write against the current scope head."
        )


class CrossScopeSubmissionError(PermissionError):
    """Raised when a version submission modifies paths owned by another scope."""

    def __init__(self, *, scope_path: str, rejected_paths: list[str]):
        self.scope_path = scope_path
        self.rejected_paths = rejected_paths
        super().__init__(
            "submission touches paths outside its scope; split the work across "
            f"scope remotes: {rejected_paths[:5]}"
        )


class NonFastForwardSubmissionError(RuntimeError):
    """Raised when a Git transport update loses the ref-update race."""

    def __init__(
        self,
        *,
        expected_head_commit_id: str,
        current_head_commit_id: str,
    ):
        self.expected_head_commit_id = expected_head_commit_id
        self.current_head_commit_id = current_head_commit_id
        super().__init__(
            "non-fast-forward update rejected; fetch and rebase before pushing again"
        )


class VersionWriteEngine:
    """Single publish authority for operation and version submissions."""

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

    async def initialize_project_tree(self, project_id: str) -> str:
        """Idempotently initialize an empty project root tree.

        L5 owns ALL ref writes — including the initial root_hash row that
        marks a project as ready for writes. Callers (project creation,
        demo seeding, startup repair) used to invoke this from a read
        service, which violated the "read paths consume committed facts
        only" rule.

        Returns the root hash (always ``EMPTY_TREE_SHA1`` here; future
        bootstrapping may seed a non-empty root).
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
        """Publish a derived scope-promote commit through the L5 boundary.

        ``derived/parent_scope_promote`` already builds the commit +
        synthesizes the grafted tree (with cordon logic for damaged
        ancestry); this method exists so the actual ref-advancing call
        runs inside the engine the way every other publish does. The
        engine's audit / tracing / future hardening (rate limiting,
        write-ahead audit) then covers projection-triggered publishes
        too, not just user-initiated writes.

        Returns ``(published, transaction_id)``: ``published`` is False
        when the underlying CAS lost (someone else advanced the parent
        scope while we were building); the caller's outer retry loop
        decides whether to recompute and try again.
        """
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
        """Apply a typed product operation via optimistic per-scope CAS.

        The merge/build phase intentionally does not hold an application-level
        scope lock. Concurrent writers may compute candidate trees in parallel;
        the SQL CAS publish is the linearization point. A losing writer reloads
        the latest scope head and recomputes on top of it.
        """

        started_ms = int(time.time() * 1000)
        scope_norm = normalize_path(intent.scope_path)
        log_info(
            f"[version_engine][{intent.operation_type}] start "
            f"project={intent.project_id} scope={scope_norm!r} "
            f"actor={intent.actor}",
        )

        return await self._apply_scoped_operation_root_first(
            intent=intent,
            splice=splice,
            started_ms=started_ms,
        )

    async def apply_project_operation(
        self,
        intent: OperationWriteIntent,
        splice: SpliceFn,
    ) -> TransactionResult:
        """Apply a product API operation against the project root.

        Frontend/Data-page writes are repository-level actions. They use
        the materialized project root as their CAS base and publish one
        user-visible history/audit event. Scope refs are derived after
        commit so access-point remotes stay current without becoming
        separate product commits.
        """

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
                    result = await self._apply_project_operation_optimistic(
                        intent=intent,
                        splice=splice,
                        started_ms=started_ms,
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
        """Apply a proposed Git tree via optimistic server-side decision."""

        started_ms = int(time.time() * 1000)
        scope_norm = normalize_path(intent.scope_path)
        log_info(
            f"[version_engine][{intent.source_channel}_submit] start "
            f"project={intent.project_id} scope={scope_norm!r} "
            f"actor={intent.actor}",
        )

        return await self._submit_version_root_first(intent, started_ms)

    async def rollback(
        self,
        intent: RollbackIntent,
    ) -> TransactionResult:
        """Restore one scope to a historical commit via optimistic CAS."""

        started_ms = int(time.time() * 1000)
        scope_norm = normalize_path(intent.scope_path)
        log_info(
            f"[version_engine][rollback] start "
            f"project={intent.project_id} scope={scope_norm!r} "
            f"actor={intent.actor} target={intent.target_commit_id[:12]}",
        )

        return await self._rollback_root_first(intent, started_ms)

    async def resolve(
        self,
        intent: ConflictResolutionIntent,
    ) -> TransactionResult:
        """Apply a manual or hosted-agent resolution to a pending conflict.

        Reads the pending-conflict row, materializes the resolution tree,
        re-enters the publish pipeline against the *current* scope head
        (not the head observed when the conflict was recorded), and clears
        the pending row.
        """

        started_ms = int(time.time() * 1000)
        scope_norm = normalize_path(intent.scope_path)
        log_info(
            f"[version_engine][resolve] start "
            f"project={intent.project_id} scope={scope_norm!r} "
            f"pending={intent.pending_conflict_id[:12]} "
            f"decision={intent.decision} actor={intent.resolver_actor}",
        )

        pending = await asyncio.to_thread(
            self._ledger.load_pending_conflict,
            intent.project_id,
            intent.pending_conflict_id,
        )
        if pending is None:
            raise ValueError(
                f"pending conflict {intent.pending_conflict_id!r} not found",
            )
        if pending.get("status") != "pending":
            raise ValueError(
                f"pending conflict {intent.pending_conflict_id!r} is "
                f"{pending.get('status')!r}, not pending",
            )

        if intent.decision == "reject":
            await asyncio.to_thread(
                self._ledger.close_pending_conflict,
                project_id=intent.project_id,
                pending_conflict_id=intent.pending_conflict_id,
                status="rejected",
                resolver_actor=intent.resolver_actor,
                resolution_commit_id="",
                resolution_detail={
                    "reason": intent.resolution_message or "rejected by resolver",
                    "decision": "reject",
                },
            )
            return TransactionResult(
                status="rejected",
                merged=False,
                reason="resolver_rejected",
                pending_conflict_id=intent.pending_conflict_id,
            )

        await asyncio.to_thread(
            self._ledger.mark_pending_conflict,
            project_id=intent.project_id,
            pending_conflict_id=intent.pending_conflict_id,
            status="resolving",
            resolver_actor=intent.resolver_actor,
        )

        repo = self._repos.get_server_repo(intent.project_id)
        if intent.resolution_files is not None:
            files = dict(intent.resolution_files)
            resolution_tree_id = await asyncio.to_thread(
                build_tree_from_files, repo.store, files,
            )
        else:
            if not intent.resolution_tree_id:
                raise ValueError(
                    "resolution requires resolution_tree_id or resolution_files",
                )
            resolution_tree_id = intent.resolution_tree_id

        submission = VersionSubmissionIntent(
            project_id=intent.project_id,
            scope_path=scope_norm,
            actor=intent.resolver_actor,
            source_channel=intent.source_channel,
            base_commit_id=pending.get("current_commit_id", "") or "",
            proposed_tree_id=resolution_tree_id,
            client_commit_id="",
            message=intent.resolution_message or "conflict resolved",
            audit_detail={
                **(intent.audit_detail or {}),
                "pending_conflict_id": intent.pending_conflict_id,
                "resolution_decision": "accept",
            },
            defer_projection=intent.defer_projection,
        )
        result = await self._submit_version_root_first(submission, started_ms)

        # The resolution may itself land as ``pending`` if the merge against
        # the *current* scope head produced fresh unsafe conflicts (rare; a
        # concurrent write between conflict-record-time and resolve-time that
        # the resolver did not account for). In that case we have a NEW
        # pending row, and the original row should stay in ``resolving`` so
        # a follow-up resolution can re-close it — marking it ``resolved``
        # with an empty commit_id would lie to the audit ledger.
        if result.status == "ok" and result.commit_id:
            new_status = "resolved"
            commit_id_for_row = result.commit_id
            detail = {"decision": "accept", "message": intent.resolution_message}
        elif result.status == "pending":
            new_status = "resolving"
            commit_id_for_row = ""
            detail = {
                "decision": "accept",
                "message": intent.resolution_message,
                "follow_up_pending_conflict_id": result.pending_conflict_id,
            }
        else:
            new_status = "rejected"
            commit_id_for_row = ""
            detail = {
                "decision": "accept",
                "message": intent.resolution_message,
                "reason": result.reason or f"submission_status:{result.status}",
            }
        try:
            await asyncio.to_thread(
                self._ledger.close_pending_conflict,
                project_id=intent.project_id,
                pending_conflict_id=intent.pending_conflict_id,
                status=new_status,
                resolver_actor=intent.resolver_actor,
                resolution_commit_id=commit_id_for_row,
                resolution_detail=detail,
            )
        except Exception as exc:
            log_warning(
                f"[version_engine][resolve] could not close pending row "
                f"{intent.pending_conflict_id[:12]}: {exc}",
            )
        return result

    async def _apply_scoped_operation_root_first(
        self,
        *,
        intent: OperationWriteIntent,
        splice: SpliceFn,
        started_ms: int,
    ) -> TransactionResult:
        """Apply a scope-relative product operation to the canonical root.

        Scope/access still defines the caller's working directory and policy
        boundary, but the linearization point is the project root CAS. The
        accepted scope subtree is written back to ``mut_scope_state`` only as a
        derived cache for Git/AP reads and legacy callers.
        """

        repo = self._repos.get_server_repo(intent.project_id)
        scope_norm = normalize_path(intent.scope_path)

        last_error: Exception | None = None
        base_scope_hash: str | None = None
        merge_audit: dict | None = None
        for attempt in range(_MAX_CAS_ATTEMPTS):
            attempt_no = attempt + 1
            old_root_hash, base_root_hash = _get_project_root_state_for_write(repo)
            current_head_commit_id = _get_project_view_head(repo, old_root_hash)
            current_scope_hash = _scope_tree_hash_for_write(
                repo, base_root_hash, scope_norm,
            )

            if attempt == 0:
                base_scope_hash = current_scope_hash

            if (
                intent.expected_head_commit_id is not None
                and current_head_commit_id != intent.expected_head_commit_id
            ):
                raise ConcurrentMutationError(
                    scope_path=scope_norm,
                    expected_head_commit_id=intent.expected_head_commit_id,
                    current_head_commit_id=current_head_commit_id,
                )

            with stage_object_writes(repo.store) as object_batch:
                new_scope_hash, splice_changes = await asyncio.to_thread(
                    splice, repo.store, current_scope_hash,
                )
                full_changes = build_full_changes(scope_norm, splice_changes)

                pending_result: TransactionResult | None = None
                if (
                    attempt > 0
                    and base_scope_hash is not None
                    and base_scope_hash != current_scope_hash
                    and new_scope_hash != current_scope_hash
                ):
                    (
                        merged_tree,
                        merge_audit,
                        manual_conflicts,
                        merge_policy,
                        base_files,
                        current_files_at_head,
                        incoming_files_for_audit,
                    ) = _merge_on_cas_retry(
                        repo=repo,
                        intent=intent,
                        scope_norm=scope_norm,
                        base_scope_hash=base_scope_hash,
                        current_scope_hash=current_scope_hash,
                        incoming_scope_hash=new_scope_hash,
                    )
                    if manual_conflicts and merge_policy in QUEUE_POLICIES:
                        pending_result = await _record_pending_conflict_generic(
                            ledger=self._ledger,
                            repo=repo,
                            project_id=intent.project_id,
                            scope_path=scope_norm,
                            current_head_commit_id=current_head_commit_id,
                            current_scope_hash=current_scope_hash,
                            client_commit_id="",
                            base_commit_id=base_scope_hash,
                            proposed_tree_id=new_scope_hash,
                            source_channel=intent.source_channel,
                            actor=intent.actor,
                            message=intent.message,
                            audit_detail=_audit_detail_with_pusher(intent),
                            base_files=base_files,
                            current_files=current_files_at_head,
                            incoming_files=incoming_files_for_audit,
                            manual_conflicts=manual_conflicts,
                            policy_reason=(merge_audit or {}).get(
                                "policy_reason", "manual_review",
                            ),
                        )
                    elif merged_tree is not None and merged_tree != new_scope_hash:
                        old_files = await asyncio.to_thread(
                            flatten_tree_to_bytes, repo.store, current_scope_hash,
                        )
                        new_files = await asyncio.to_thread(
                            flatten_tree_to_bytes, repo.store, merged_tree,
                        )
                        full_changes = compute_changeset(
                            scope_norm, old_files, new_files,
                        )
                        new_scope_hash = merged_tree

                if pending_result is not None:
                    _log_done(
                        f"{intent.operation_type}_pending",
                        intent.project_id,
                        scope_norm,
                        pending_result,
                        started_ms,
                    )
                    return pending_result

                if (
                    not full_changes
                    or (
                        new_scope_hash == current_scope_hash
                        and not intent.allow_same_tree_commit
                    )
                ):
                    elapsed = int(time.time() * 1000) - started_ms
                    log_info(
                        f"[version_engine][{intent.operation_type}] noop "
                        f"project={intent.project_id} scope={scope_norm!r} "
                        f"elapsed={elapsed}ms",
                    )
                    return TransactionResult(
                        status="ok",
                        is_noop=True,
                        new_scope_hash=current_scope_hash,
                    )

                new_root_hash = _graft_scope_tree(
                    repo, base_root_hash, scope_norm, new_scope_hash,
                )
                created_at_iso = _now_iso()
                new_commit_id = await asyncio.to_thread(
                    build_git_commit,
                    repo,
                    tree_sha=new_root_hash,
                    parent_sha=_git_safe_parent(repo, current_head_commit_id),
                    who=intent.actor,
                    message=intent.message,
                    created_at_iso=created_at_iso,
                    validate_parent_graph=False,
                )

                if object_batch is not None:
                    await asyncio.to_thread(object_batch.flush)

            scope_head_commit_id = ""
            if scope_norm:
                _cached_scope_hash, previous_scope_head_id = _get_scope_state(
                    repo, scope_norm,
                )
                scope_head_commit_id = await asyncio.to_thread(
                    _build_scope_view_commit,
                    repo,
                    scope_path=scope_norm,
                    scope_hash=new_scope_hash,
                    parent_id=previous_scope_head_id,
                    actor=intent.actor,
                    message=intent.message,
                    created_at_iso=created_at_iso,
                    source_channel=intent.source_channel,
                    base_commit_id=previous_scope_head_id,
                )

            audit_detail = dict(_audit_detail_with_pusher(intent))
            if merge_audit:
                audit_detail.setdefault("cas_retry_merge", merge_audit)
            result = await _publish_project_update(
                repo_manager=self._repos,
                repo=repo,
                project_id=intent.project_id,
                old_root_hash=old_root_hash,
                new_root_hash=new_root_hash,
                scope_path=scope_norm,
                scope_hash=new_scope_hash,
                scope_head_commit_id=scope_head_commit_id,
                commit_id=new_commit_id,
                actor=intent.actor,
                message=intent.message,
                op_type=intent.operation_type,
                audit_detail=audit_detail,
                changes=full_changes,
                conflicts=None,
                created_at_iso=created_at_iso,
                cas_attempt=attempt_no,
                merged=bool(merge_audit),
                merged_changes=[],
                source_channel=intent.source_channel,
                policy=intent.policy_override,
                base_commit_id=current_head_commit_id,
                proposed_tree_id=new_scope_hash,
                intent_type="operation",
            )
            if result is not None:
                result.new_scope_hash = new_scope_hash
                _log_done(intent.operation_type, intent.project_id, scope_norm, result, started_ms)
                return result

            last_error = RuntimeError("project root CAS lost")
            log_info(
                f"[version_engine][{intent.operation_type}] root CAS lost "
                f"(attempt {attempt_no}/{_MAX_CAS_ATTEMPTS}) "
                f"project={intent.project_id} scope={scope_norm!r}",
            )

        raise RuntimeError(
            f"[version_engine][{intent.operation_type}] root CAS still failing "
            f"after {_MAX_CAS_ATTEMPTS} attempts "
            f"(project={intent.project_id}, scope={scope_norm!r}); "
            f"last error: {last_error}",
        )

    async def _apply_operation_optimistic(
        self,
        *,
        intent: OperationWriteIntent,
        splice: SpliceFn,
        started_ms: int,
    ) -> TransactionResult:
        repo = self._repos.get_server_repo(intent.project_id)
        scope_norm = normalize_path(intent.scope_path)

        last_error: Exception | None = None
        # Captured on the FIRST attempt; used as the merge base on every
        # subsequent retry where the scope head moved underneath us. The
        # invariant we want: the actor's perceived "starting point" never
        # changes — only the merge target does. So when a concurrent writer
        # (A) commits between our attempt 0 splice and our publish, attempt
        # 1+ produces a server-side merged commit that combines A's edit
        # with the caller's intent (B), rather than blindly overwriting A.
        base_scope_hash: str | None = None
        merge_audit: dict | None = None
        for attempt in range(_MAX_CAS_ATTEMPTS):
            old_scope_hash, current_head_commit_id = _get_scope_state(repo, scope_norm)
            if (
                intent.expected_head_commit_id is not None
                and current_head_commit_id != intent.expected_head_commit_id
            ):
                raise ConcurrentMutationError(
                    scope_path=scope_norm,
                    expected_head_commit_id=intent.expected_head_commit_id,
                    current_head_commit_id=current_head_commit_id,
                )

            if attempt == 0:
                base_scope_hash = old_scope_hash

            with stage_object_writes(repo.store) as object_batch:
                new_scope_hash, changes = await asyncio.to_thread(
                    splice, repo.store, old_scope_hash,
                )

                # CAS-retry merge: if the scope advanced between our base
                # capture and this attempt, what the splice produced is
                # "caller's intent applied on top of someone else's commit".
                # That's a blind overwrite of whatever the other commit
                # changed at the same path. Run the V1 conflict-policy
                # three-way merge against the captured base to recover the
                # other side's content where it can be safely combined.
                pending_result: TransactionResult | None = None
                if (
                    attempt > 0
                    and base_scope_hash is not None
                    and base_scope_hash != old_scope_hash
                    and new_scope_hash != old_scope_hash
                ):
                    (
                        merged_tree,
                        merge_audit,
                        manual_conflicts,
                        merge_policy,
                        base_files,
                        current_files_at_head,
                        incoming_files_for_audit,
                    ) = _merge_on_cas_retry(
                        repo=repo,
                        intent=intent,
                        scope_norm=scope_norm,
                        base_scope_hash=base_scope_hash,
                        current_scope_hash=old_scope_hash,
                        incoming_scope_hash=new_scope_hash,
                    )
                    # If the merge classified anything as manual_review,
                    # don't commit — queue the conflict and return.
                    if manual_conflicts and merge_policy in QUEUE_POLICIES:
                        pending_result = await _record_pending_conflict_generic(
                            ledger=self._ledger,
                            repo=repo,
                            project_id=intent.project_id,
                            scope_path=scope_norm,
                            current_head_commit_id=current_head_commit_id,
                            current_scope_hash=old_scope_hash,
                            client_commit_id="",
                            base_commit_id=base_scope_hash,
                            proposed_tree_id=new_scope_hash,
                            source_channel=intent.source_channel,
                            actor=intent.actor,
                            message=intent.message,
                            audit_detail=_audit_detail_with_pusher(intent),
                            base_files=base_files,
                            current_files=current_files_at_head,
                            incoming_files=incoming_files_for_audit,
                            manual_conflicts=manual_conflicts,
                            policy_reason=(merge_audit or {}).get(
                                "policy_reason", "manual_review",
                            ),
                        )
                    elif merged_tree is not None and merged_tree != new_scope_hash:
                        # Rebuild ``changes`` so the audit row reflects the
                        # merged tree, not the pre-merge splice.
                        changes = await asyncio.to_thread(
                            compute_changeset,
                            scope_norm,
                            await asyncio.to_thread(
                                flatten_tree_to_bytes, repo.store, old_scope_hash,
                            ),
                            await asyncio.to_thread(
                                flatten_tree_to_bytes, repo.store, merged_tree,
                            ),
                        )
                        new_scope_hash = merged_tree

                if pending_result is not None:
                    _log_done(
                        f"{intent.operation_type}_pending",
                        intent.project_id,
                        scope_norm,
                        pending_result,
                        started_ms,
                    )
                    return pending_result

                if (
                    not changes
                    or (
                        new_scope_hash == old_scope_hash
                        and not intent.allow_same_tree_commit
                    )
                ):
                    elapsed = int(time.time() * 1000) - started_ms
                    log_info(
                        f"[version_engine][{intent.operation_type}] noop "
                        f"project={intent.project_id} scope={scope_norm!r} "
                        f"elapsed={elapsed}ms",
                    )
                    return TransactionResult(
                        status="ok",
                        is_noop=True,
                        new_scope_hash=old_scope_hash,
                    )

                created_at_iso = _now_iso()
                new_commit_id = await asyncio.to_thread(
                    build_git_commit,
                    repo,
                    tree_sha=new_scope_hash,
                    parent_sha=_git_safe_parent(repo, current_head_commit_id),
                    who=intent.actor,
                    message=intent.message,
                    created_at_iso=created_at_iso,
                    validate_parent_graph=False,
                )

                if object_batch is not None:
                    await asyncio.to_thread(object_batch.flush)

            full_changes = build_full_changes(scope_norm, changes)
            # If the CAS-retry merge fired, stamp the audit detail so the
            # ledger row records what was combined and which strategy
            # produced the merged content.
            audit_detail = dict(intent.audit_detail or {})
            if merge_audit:
                audit_detail.setdefault("cas_retry_merge", merge_audit)
            result = await _publish_scope_update(
                repo_manager=self._repos,
                repo=repo,
                project_id=intent.project_id,
                scope_path=scope_norm,
                old_scope_hash=old_scope_hash,
                new_scope_hash=new_scope_hash,
                commit_id=new_commit_id,
                actor=intent.actor,
                message=intent.message,
                op_type=intent.operation_type,
                audit_detail=audit_detail,
                changes=full_changes,
                conflicts=None,
                created_at_iso=created_at_iso,
                cas_attempt=attempt + 1,
                merged=bool(merge_audit),
                merged_changes=[],
                defer_projection=intent.defer_projection,
                source_channel=intent.source_channel,
                base_commit_id=current_head_commit_id,
                proposed_tree_id=new_scope_hash,
                intent_type="operation",
            )
            if result is not None:
                _log_done(intent.operation_type, intent.project_id, scope_norm, result, started_ms)
                return result

            last_error = RuntimeError("CAS lost")
            log_info(
                f"[version_engine][{intent.operation_type}] CAS lost "
                f"(attempt {attempt + 1}/{_MAX_CAS_ATTEMPTS}) "
                f"project={intent.project_id} scope={scope_norm!r}",
            )

        raise RuntimeError(
            f"[version_engine][{intent.operation_type}] CAS still failing "
            f"after {_MAX_CAS_ATTEMPTS} attempts "
            f"(project={intent.project_id}, scope={scope_norm!r}); "
            f"last error: {last_error}",
        )

    async def _apply_project_operation_optimistic(
        self,
        *,
        intent: OperationWriteIntent,
        splice: SpliceFn,
        started_ms: int,
    ) -> TransactionResult:
        write_state = intent.project_write_state
        with trace_phase("repo.resolve", project_id=intent.project_id):
            repo = self._repos.get_server_repo(
                intent.project_id,
                project_name=write_state.project_name if write_state else None,
            )

        last_error: Exception | None = None
        # Same invariant as the scope path (_apply_operation_optimistic):
        # capture the actor's perceived starting point on attempt 0 and
        # use it as the three-way-merge base whenever the root advances
        # under us on a later attempt. Without this, concurrent root
        # writes silently overwrite each other on CAS retry.
        merge_base_root_hash: str | None = None
        merge_audit: dict | None = None
        for attempt in range(_MAX_CAS_ATTEMPTS):
            attempt_no = attempt + 1
            if attempt == 0 and write_state is not None:
                old_root_hash = write_state.root_hash or ""
                current_head_commit_id = write_state.head_commit_id or ""
                trace_mark(
                    "db.project_write_state.reused",
                    attempt=attempt_no,
                    root_hash=old_root_hash[:12],
                    head_commit_id=current_head_commit_id[:12],
                )
            else:
                with trace_phase("db.get_project_root", attempt=attempt_no):
                    old_root_hash = _get_project_root_hash(repo)
                with trace_phase(
                    "db.get_project_view_head",
                    attempt=attempt_no,
                    root_hash=old_root_hash[:12],
                ):
                    current_head_commit_id = _get_project_view_head(repo, old_root_hash)
            if old_root_hash:
                base_root_hash = old_root_hash
            else:
                with trace_phase("object.create_empty_root", attempt=attempt_no):
                    base_root_hash = repo.store.put_tree(encode_tree([]))
            if attempt == 0:
                merge_base_root_hash = base_root_hash
            if (
                intent.expected_head_commit_id is not None
                and current_head_commit_id != intent.expected_head_commit_id
            ):
                raise ConcurrentMutationError(
                    scope_path="",
                    expected_head_commit_id=intent.expected_head_commit_id,
                    current_head_commit_id=current_head_commit_id,
                )

            with stage_object_writes(repo.store) as object_batch:
                with trace_phase(
                    "tree.splice",
                    attempt=attempt_no,
                    base_root_hash=base_root_hash[:12],
                ):
                    new_root_hash, changes = await asyncio.to_thread(
                        splice, repo.store, base_root_hash,
                    )

                # CAS-retry merge for the project root. Mirrors the scope
                # path: when the root has advanced between our base capture
                # and this attempt, splice gave us "caller intent on top of
                # someone else's commit" — a blind overwrite. Run the V1
                # policy three-way merge against the original base so the
                # other side's edits survive.
                pending_result: TransactionResult | None = None
                if (
                    attempt > 0
                    and merge_base_root_hash is not None
                    and merge_base_root_hash != base_root_hash
                    and new_root_hash != base_root_hash
                ):
                    (
                        merged_tree,
                        merge_audit,
                        manual_conflicts,
                        merge_policy,
                        base_files,
                        current_files_at_head,
                        incoming_files_for_audit,
                    ) = _merge_on_cas_retry(
                        repo=repo,
                        intent=intent,
                        scope_norm="",
                        base_scope_hash=merge_base_root_hash,
                        current_scope_hash=base_root_hash,
                        incoming_scope_hash=new_root_hash,
                    )
                    if manual_conflicts and merge_policy in QUEUE_POLICIES:
                        pending_result = await _record_pending_conflict_generic(
                            ledger=self._ledger,
                            repo=repo,
                            project_id=intent.project_id,
                            scope_path="",
                            current_head_commit_id=current_head_commit_id,
                            current_scope_hash=base_root_hash,
                            client_commit_id="",
                            base_commit_id=merge_base_root_hash,
                            proposed_tree_id=new_root_hash,
                            source_channel=intent.source_channel,
                            actor=intent.actor,
                            message=intent.message,
                            audit_detail=_audit_detail_with_pusher(intent),
                            base_files=base_files,
                            current_files=current_files_at_head,
                            incoming_files=incoming_files_for_audit,
                            manual_conflicts=manual_conflicts,
                            policy_reason=(merge_audit or {}).get(
                                "policy_reason", "manual_review",
                            ),
                        )
                    elif merged_tree is not None and merged_tree != new_root_hash:
                        # Rebuild ``changes`` so the audit reflects the
                        # merged tree, not the pre-merge splice.
                        changes = await asyncio.to_thread(
                            compute_changeset,
                            "",
                            await asyncio.to_thread(
                                flatten_tree_to_bytes, repo.store, base_root_hash,
                            ),
                            await asyncio.to_thread(
                                flatten_tree_to_bytes, repo.store, merged_tree,
                            ),
                        )
                        new_root_hash = merged_tree

                if pending_result is not None:
                    _log_done(
                        f"{intent.operation_type}:project_pending",
                        intent.project_id,
                        "",
                        pending_result,
                        started_ms,
                    )
                    return pending_result

                if (
                    not changes
                    or (
                        new_root_hash == base_root_hash
                        and not intent.allow_same_tree_commit
                    )
                ):
                    elapsed = int(time.time() * 1000) - started_ms
                    log_info(
                        f"[version_engine][{intent.operation_type}:project] noop "
                        f"project={intent.project_id} elapsed={elapsed}ms",
                    )
                    return TransactionResult(
                        status="ok",
                        is_noop=True,
                        new_scope_hash=base_root_hash,
                    )

                created_at_iso = _now_iso()
                with trace_phase(
                    "git.parent.resolve",
                    attempt=attempt_no,
                    current_head=current_head_commit_id[:12],
                ):
                    parent_commit_id = _git_safe_parent(repo, current_head_commit_id)
                with trace_phase(
                    "git.build_commit",
                    attempt=attempt_no,
                    tree_sha=new_root_hash[:12],
                    parent_sha=parent_commit_id[:12],
                ):
                    new_commit_id = await asyncio.to_thread(
                        build_git_commit,
                        repo,
                        tree_sha=new_root_hash,
                        parent_sha=parent_commit_id,
                        who=intent.actor,
                        message=intent.message,
                        created_at_iso=created_at_iso,
                        validate_parent_graph=False,
                    )

                if object_batch is not None:
                    count = getattr(object_batch, "count", lambda: None)()
                    with trace_phase("object.flush", attempt=attempt_no, count=count):
                        await asyncio.to_thread(object_batch.flush)

            with trace_phase("changes.build_full_changes", attempt=attempt_no):
                full_changes = build_full_changes("", changes)
            with trace_phase(
                "db.publish_project_update",
                attempt=attempt_no,
                old_root_hash=old_root_hash[:12],
                new_root_hash=new_root_hash[:12],
                commit_id=new_commit_id[:12],
            ):
                result = await _publish_project_update(
                    repo_manager=self._repos,
                    repo=repo,
                    project_id=intent.project_id,
                    old_root_hash=old_root_hash,
                    new_root_hash=new_root_hash,
                    commit_id=new_commit_id,
                    actor=intent.actor,
                    message=intent.message,
                    op_type=intent.operation_type,
                    audit_detail=_audit_detail_with_pusher(intent),
                    changes=full_changes,
                    conflicts=None,
                    created_at_iso=created_at_iso,
                    cas_attempt=attempt_no,
                    merged=False,
                    merged_changes=[],
                    source_channel=intent.source_channel,
                    policy=intent.policy_override,
                    base_commit_id=current_head_commit_id,
                    proposed_tree_id=new_root_hash,
                    intent_type="operation",
                )
            if result is not None:
                _log_done(
                    f"{intent.operation_type}:project",
                    intent.project_id,
                    "",
                    result,
                    started_ms,
                )
                return result

            last_error = RuntimeError("project root CAS lost")
            log_info(
                f"[version_engine][{intent.operation_type}:project] root CAS lost "
                f"(attempt {attempt + 1}/{_MAX_CAS_ATTEMPTS}) "
                f"project={intent.project_id}",
            )

        raise RuntimeError(
            f"[version_engine][{intent.operation_type}:project] root CAS still "
            f"failing after {_MAX_CAS_ATTEMPTS} attempts "
            f"(project={intent.project_id}); last error: {last_error}",
        )

    async def _submit_version_root_first(
        self,
        intent: VersionSubmissionIntent,
        started_ms: int,
    ) -> TransactionResult:
        """Publish a submitted scope tree by grafting it into project root."""

        repo = self._repos.get_server_repo(intent.project_id)
        scope_norm = normalize_path(intent.scope_path)
        incoming_files = (
            dict(intent.proposed_files)
            if intent.proposed_files is not None
            else None
        )
        changed_paths_hint = [
            normalize_path(path)
            for path in intent.changed_paths
            if normalize_path(path)
        ]

        last_error: Exception | None = None
        for attempt in range(_MAX_CAS_ATTEMPTS):
            attempt_no = attempt + 1
            old_root_hash, base_root_hash = _get_project_root_state_for_write(repo)
            project_head_commit_id = _get_project_view_head(repo, old_root_hash)
            old_scope_hash = _scope_tree_hash_for_write(
                repo, base_root_hash, scope_norm,
            )
            _cached_scope_hash, current_scope_head_id = _get_scope_state(
                repo, scope_norm,
            )
            acceptable_git_heads: set[str] | None = None
            if intent.source_channel == "git":
                if scope_norm:
                    canonical_scope_head_id = current_scope_head_id or ""
                    git_visible_head_id = str(
                        (intent.audit_detail or {}).get("git_visible_old_commit_id")
                        or ""
                    )
                    acceptable_git_heads = {
                        head
                        for head in (canonical_scope_head_id, git_visible_head_id)
                        if head
                    }
                    current_scope_head_id = (
                        canonical_scope_head_id or git_visible_head_id
                    )
                else:
                    # Push fast-forward checks must use the committed root ref,
                    # not the derived project-view ref. The latter is async and
                    # may legitimately lag behind the DB-authoritative root.
                    current_scope_head_id = (
                        current_scope_head_id
                        or (repo.get_head_commit_id() if hasattr(repo, "get_head_commit_id") else "")
                        or project_head_commit_id
                    )
            current_scope_head_id = (
                current_scope_head_id
                or (project_head_commit_id if not scope_norm else "")
            )

            if intent.source_channel == "git":
                acceptable_heads = acceptable_git_heads or {
                    head for head in (current_scope_head_id,) if head
                }
                if acceptable_heads and intent.base_commit_id not in acceptable_heads:
                    raise NonFastForwardSubmissionError(
                        expected_head_commit_id=intent.base_commit_id,
                        current_head_commit_id=(
                            current_scope_head_id
                            or sorted(acceptable_heads)[0]
                        ),
                    )
                if not acceptable_heads and intent.base_commit_id:
                    raise NonFastForwardSubmissionError(
                        expected_head_commit_id=intent.base_commit_id,
                        current_head_commit_id="",
                    )
                if (
                    intent.base_commit_id in acceptable_heads
                    and not current_scope_head_id
                ):
                    current_scope_head_id = intent.base_commit_id

            promoted_objects = False
            if (
                intent.promote_objects is not None
                and not changed_paths_hint
                and incoming_files is None
            ):
                await asyncio.to_thread(intent.promote_objects)
                promoted_objects = True

            current_files: dict[str, bytes] | None = None
            if incoming_files is not None:
                current_files = await asyncio.to_thread(
                    _scope_files_for_head, repo, scope_norm, old_scope_hash,
                )
                changed_relative_paths = _changed_relative_paths(
                    current_files,
                    incoming_files,
                )
            else:
                changed_relative_paths = changed_paths_hint or await asyncio.to_thread(
                    _changed_paths_from_tree_diff,
                    repo,
                    old_scope_hash,
                    intent.proposed_tree_id,
                )
            rejected = validate_scope_bound_files(
                repo,
                scope_norm,
                changed_relative_paths,
                intent.scope_excludes,
            )
            if rejected:
                await asyncio.to_thread(
                    repo.record_audit,
                    f"{intent.source_channel}_push_rejected",
                    intent.actor,
                    {
                        "scope": scope_norm,
                        "rejected_paths": rejected,
                        **intent.audit_detail,
                    },
                )
                try:
                    await asyncio.to_thread(
                        self._ledger.insert_version_transaction,
                        project_id=intent.project_id,
                        scope_path=scope_norm,
                        source_channel=intent.source_channel,
                        actor=intent.actor,
                        intent_type="submission",
                        status="rejected",
                        base_commit_id=intent.base_commit_id,
                        client_commit_id=intent.client_commit_id,
                        proposed_tree_id=intent.proposed_tree_id,
                        current_head_at_start=current_scope_head_id,
                        message=intent.message,
                        audit_detail={
                            "rejected_paths": rejected[:50],
                            **(intent.audit_detail or {}),
                        },
                        reason="cross_scope_paths_outside_scope",
                    )
                except Exception as exc:
                    log_warning(
                        f"[version_engine] failed to record rejected "
                        f"version_transactions row: {exc}",
                    )
                raise CrossScopeSubmissionError(
                    scope_path=scope_norm,
                    rejected_paths=rejected,
                )

            if intent.promote_objects is not None and not promoted_objects:
                await asyncio.to_thread(intent.promote_objects)
                promoted_objects = True

            if intent.base_commit_id == current_scope_head_id:
                new_scope_hash = intent.proposed_tree_id
                conflicts = []
                merged_changes: list[dict] = []
                if incoming_files is not None:
                    if current_files is None:
                        current_files = await asyncio.to_thread(
                            _scope_files_for_head, repo, scope_norm, old_scope_hash,
                        )
                    changes = compute_changeset(
                        scope_norm,
                        current_files,
                        incoming_files,
                    )
                    if intent.proposed_tree_id != old_scope_hash:
                        new_scope_hash = await asyncio.to_thread(
                            build_tree_from_files, repo.store, incoming_files,
                        )
                else:
                    changes = await asyncio.to_thread(
                        _changes_from_tree_diff,
                        repo,
                        scope_norm,
                        old_scope_hash,
                        new_scope_hash,
                    )
            else:
                if incoming_files is None:
                    base_tree_for_merge = await asyncio.to_thread(
                        _tree_hash_at_commit,
                        repo,
                        scope_norm,
                        intent.base_commit_id,
                    )
                    merge_paths = changed_paths_hint or await asyncio.to_thread(
                        _changed_paths_from_tree_diff,
                        repo,
                        base_tree_for_merge,
                        intent.proposed_tree_id,
                    )
                    base_files = await asyncio.to_thread(
                        _sparse_files_at_tree_paths,
                        repo,
                        base_tree_for_merge,
                        merge_paths,
                    )
                    current_files = await asyncio.to_thread(
                        _sparse_files_at_tree_paths,
                        repo,
                        old_scope_hash,
                        merge_paths,
                    )
                    incoming_files = await asyncio.to_thread(
                        _sparse_files_at_tree_paths,
                        repo,
                        intent.proposed_tree_id,
                        merge_paths,
                    )
                    sparse_merge = True
                else:
                    merge_paths = list(incoming_files.keys())
                    sparse_merge = False
                if current_files is None:
                    current_files = await asyncio.to_thread(
                        _scope_files_for_head, repo, scope_norm, old_scope_hash,
                    )
                if not sparse_merge:
                    base_files = await asyncio.to_thread(
                        _files_at_commit, repo, scope_norm, intent.base_commit_id,
                    )
                if intent.policy_override in QUEUE_POLICIES:
                    from src.version_engine.domain.conflicts import (
                        ConflictPolicyDecision,
                    )
                    policy = ConflictPolicyDecision(
                        policy=intent.policy_override,
                        reason=f"submission_intent_override:{intent.policy_override}",
                    )
                else:
                    policy = select_conflict_policy(
                        scope_path=scope_norm,
                        source_channel=intent.source_channel,
                        actor=intent.actor,
                        paths=merge_paths,
                    )
                parent_scope_files = await asyncio.to_thread(
                    _parent_scope_files, repo, scope_norm, merge_paths,
                )
                merge_result = merge_file_sets_for_policy(
                    base_files,
                    current_files,
                    incoming_files,
                    policy=policy,
                    parent_scope_files=parent_scope_files,
                )
                if merge_result.manual_conflicts and policy.policy in QUEUE_POLICIES:
                    result = await self._record_pending_conflict(
                        repo=repo,
                        intent=intent,
                        scope_path=scope_norm,
                        current_head_commit_id=current_scope_head_id,
                        current_scope_hash=old_scope_hash,
                        base_files=base_files,
                        current_files=current_files,
                        incoming_files=incoming_files,
                        manual_conflicts=merge_result.manual_conflicts,
                        policy_reason=policy.reason,
                    )
                    _log_done(
                        f"{intent.source_channel}_push_pending",
                        intent.project_id,
                        scope_norm,
                        result,
                        started_ms,
                    )
                    return result
                merged_files = merge_result.merged_files
                conflicts = (
                    list(merge_result.auto_merge_records)
                    + list(merge_result.lww_records)
                    + list(merge_result.superseded_by_parent)
                )
                if sparse_merge:
                    new_scope_hash, sparse_changes = await asyncio.to_thread(
                        _apply_sparse_file_merge,
                        repo,
                        old_scope_hash,
                        current_files,
                        merged_files,
                        merge_paths,
                    )
                    changes = build_full_changes(scope_norm, sparse_changes)
                else:
                    new_scope_hash = await asyncio.to_thread(
                        build_tree_from_files, repo.store, merged_files,
                    )
                    changes = compute_changeset(scope_norm, current_files, merged_files)
                merged_changes = _compute_merged_changes(
                    current_files, merged_files, incoming_files, scope_norm,
                )

            if not changes and new_scope_hash == old_scope_hash:
                return TransactionResult(
                    status="ok",
                    commit_id=current_scope_head_id,
                    new_scope_hash=old_scope_hash,
                    is_noop=True,
                )

            new_root_hash = _graft_scope_tree(
                repo, base_root_hash, scope_norm, new_scope_hash,
            )
            created_at_iso = _now_iso()
            if not scope_norm:
                commit_id = _select_or_create_commit(
                    repo=repo,
                    intent=intent,
                    tree_id=new_root_hash,
                    parent_id=current_scope_head_id,
                    created_at_iso=created_at_iso,
                    preserve_client=True,
                )
            else:
                trailers = {
                    "PuppyOne-Source": intent.source_channel,
                    "PuppyOne-Scope": scope_norm or "/",
                    "PuppyOne-Original-Commit": intent.client_commit_id or "",
                    "PuppyOne-Base-Commit": intent.base_commit_id or "",
                }
                commit_id = await asyncio.to_thread(
                    build_git_commit,
                    repo,
                    tree_sha=new_root_hash,
                    parent_sha=_git_safe_parent(repo, project_head_commit_id),
                    who=intent.actor,
                    message=intent.message,
                    created_at_iso=created_at_iso,
                    trailers=trailers,
                    validate_parent_graph=False,
                )

            scope_head_commit_id = ""
            if scope_norm:
                if intent.client_commit_id:
                    scope_head_commit_id = intent.client_commit_id
                else:
                    scope_head_commit_id = await asyncio.to_thread(
                        _build_scope_view_commit,
                        repo,
                        scope_path=scope_norm,
                        scope_hash=new_scope_hash,
                        parent_id=current_scope_head_id,
                        actor=intent.actor,
                        message=intent.message,
                        created_at_iso=created_at_iso,
                        source_channel=intent.source_channel,
                        original_commit_id=intent.client_commit_id,
                        base_commit_id=intent.base_commit_id,
                    )

            result = await _publish_project_update(
                repo_manager=self._repos,
                repo=repo,
                project_id=intent.project_id,
                old_root_hash=old_root_hash,
                new_root_hash=new_root_hash,
                scope_path=scope_norm,
                scope_hash=new_scope_hash,
                scope_head_commit_id=scope_head_commit_id,
                commit_id=commit_id,
                actor=intent.actor,
                message=intent.message,
                op_type=f"{intent.source_channel}_push",
                audit_detail={
                    "base_commit_id": intent.base_commit_id,
                    "client_commit_id": intent.client_commit_id,
                    **_audit_detail_with_pusher(intent),
                },
                changes=changes,
                conflicts=conflicts,
                created_at_iso=created_at_iso,
                cas_attempt=attempt_no,
                merged=bool(conflicts) or new_scope_hash != intent.proposed_tree_id,
                merged_changes=merged_changes,
                source_channel=intent.source_channel,
                base_commit_id=intent.base_commit_id,
                client_commit_id=intent.client_commit_id,
                proposed_tree_id=intent.proposed_tree_id,
                intent_type="submission",
            )
            if result is not None:
                result.new_scope_hash = new_scope_hash
                _log_done(f"{intent.source_channel}_push", intent.project_id, scope_norm, result, started_ms)
                return result

            last_error = RuntimeError("project root CAS lost")
            log_info(
                f"[version_engine][{intent.source_channel}_push] root CAS lost "
                f"(attempt {attempt_no}/{_MAX_CAS_ATTEMPTS}) "
                f"project={intent.project_id} scope={scope_norm!r}",
            )

        raise RuntimeError(
            f"[version_engine][{intent.source_channel}_push] root CAS still failing "
            f"after {_MAX_CAS_ATTEMPTS} attempts "
            f"(project={intent.project_id}, scope={scope_norm!r}); "
            f"last error: {last_error}",
        )

    async def _submit_version_optimistic(
        self,
        intent: VersionSubmissionIntent,
        started_ms: int,
    ) -> TransactionResult:
        repo = self._repos.get_server_repo(intent.project_id)
        scope_norm = normalize_path(intent.scope_path)

        incoming_files = (
            dict(intent.proposed_files)
            if intent.proposed_files is not None
            else None
        )
        changed_paths_hint = [
            normalize_path(path)
            for path in intent.changed_paths
            if normalize_path(path)
        ]

        last_error: Exception | None = None
        for attempt in range(_MAX_CAS_ATTEMPTS):
            promoted_objects = False
            old_scope_hash, current_head_commit_id = _get_scope_state(repo, scope_norm)
            if (
                intent.source_channel == "git"
                and intent.base_commit_id != current_head_commit_id
            ):
                raise NonFastForwardSubmissionError(
                    expected_head_commit_id=intent.base_commit_id,
                    current_head_commit_id=current_head_commit_id,
                )
            current_files: dict[str, bytes] | None = None
            if incoming_files is not None:
                current_files = await asyncio.to_thread(
                    _scope_files_for_head, repo, scope_norm, old_scope_hash,
                )
                changed_relative_paths = _changed_relative_paths(
                    current_files,
                    incoming_files,
                )
            else:
                changed_relative_paths = changed_paths_hint or await asyncio.to_thread(
                    _changed_paths_from_tree_diff,
                    repo,
                    old_scope_hash,
                    intent.proposed_tree_id,
                )
            rejected = validate_scope_bound_files(
                repo,
                scope_norm,
                changed_relative_paths,
                intent.scope_excludes,
            )
            if rejected:
                await asyncio.to_thread(
                    repo.record_audit,
                    f"{intent.source_channel}_push_rejected",
                    intent.actor,
                    {
                        "scope": scope_norm,
                        "rejected_paths": rejected,
                        **intent.audit_detail,
                    },
                )
                # B6: record a rejected version_transactions row so the
                # ledger captures cross-scope guard hits, not just
                # successful commits.
                try:
                    await asyncio.to_thread(
                        self._ledger.insert_version_transaction,
                        project_id=intent.project_id,
                        scope_path=scope_norm,
                        source_channel=intent.source_channel,
                        actor=intent.actor,
                        intent_type="submission",
                        status="rejected",
                        base_commit_id=intent.base_commit_id,
                        client_commit_id=intent.client_commit_id,
                        proposed_tree_id=intent.proposed_tree_id,
                        current_head_at_start=current_head_commit_id,
                        message=intent.message,
                        audit_detail={
                            "rejected_paths": rejected[:50],
                            **(intent.audit_detail or {}),
                        },
                        reason="cross_scope_paths_outside_scope",
                    )
                except Exception as exc:
                    log_warning(
                        f"[version_engine] failed to record rejected "
                        f"version_transactions row: {exc}",
                    )
                raise CrossScopeSubmissionError(
                    scope_path=scope_norm,
                    rejected_paths=rejected,
                )

            if intent.promote_objects is not None:
                await asyncio.to_thread(intent.promote_objects)
                promoted_objects = True

            if intent.base_commit_id == current_head_commit_id:
                new_scope_hash = intent.proposed_tree_id
                conflicts = []
                merged_changes: list[dict] = []
                if incoming_files is not None:
                    if current_files is None:
                        current_files = await asyncio.to_thread(
                            _scope_files_for_head,
                            repo,
                            scope_norm,
                            old_scope_hash,
                        )
                    merged_files = incoming_files
                    changes = compute_changeset(scope_norm, current_files, merged_files)
                else:
                    changes = await asyncio.to_thread(
                        _changes_from_tree_diff,
                        repo,
                        scope_norm,
                        old_scope_hash,
                        new_scope_hash,
                    )
                commit_id = _select_or_create_commit(
                    repo=repo,
                    intent=intent,
                    tree_id=new_scope_hash,
                    parent_id=current_head_commit_id,
                    created_at_iso=_now_iso(),
                    preserve_client=True,
                )
            else:
                if incoming_files is None:
                    base_tree_for_merge = await asyncio.to_thread(
                        _tree_hash_at_commit,
                        repo,
                        scope_norm,
                        intent.base_commit_id,
                    )
                    merge_paths = changed_paths_hint or await asyncio.to_thread(
                        _changed_paths_from_tree_diff,
                        repo,
                        base_tree_for_merge,
                        intent.proposed_tree_id,
                    )
                    base_files = await asyncio.to_thread(
                        _sparse_files_at_tree_paths,
                        repo,
                        base_tree_for_merge,
                        merge_paths,
                    )
                    current_files = await asyncio.to_thread(
                        _sparse_files_at_tree_paths,
                        repo,
                        old_scope_hash,
                        merge_paths,
                    )
                    incoming_files = await asyncio.to_thread(
                        _sparse_files_at_tree_paths,
                        repo,
                        intent.proposed_tree_id,
                        merge_paths,
                    )
                    sparse_merge = True
                else:
                    merge_paths = list(incoming_files.keys())
                    sparse_merge = False
                if current_files is None:
                    current_files = await asyncio.to_thread(
                        _scope_files_for_head, repo, scope_norm, old_scope_hash,
                    )
                if not sparse_merge:
                    base_files = await asyncio.to_thread(
                        _files_at_commit, repo, scope_norm, intent.base_commit_id,
                    )
                if intent.policy_override in QUEUE_POLICIES:
                    from src.version_engine.domain.conflicts import (
                        ConflictPolicyDecision,
                    )
                    policy = ConflictPolicyDecision(
                        policy=intent.policy_override,
                        reason=f"submission_intent_override:{intent.policy_override}",
                    )
                else:
                    policy = select_conflict_policy(
                        scope_path=scope_norm,
                        source_channel=intent.source_channel,
                        actor=intent.actor,
                        paths=merge_paths,
                    )
                parent_scope_files = await asyncio.to_thread(
                    _parent_scope_files, repo, scope_norm, merge_paths,
                )
                merge_result = merge_file_sets_for_policy(
                    base_files, current_files, incoming_files,
                    policy=policy,
                    parent_scope_files=parent_scope_files,
                )
                if merge_result.manual_conflicts and policy.policy in QUEUE_POLICIES:
                    result = await self._record_pending_conflict(
                        repo=repo,
                        intent=intent,
                        scope_path=scope_norm,
                        current_head_commit_id=current_head_commit_id,
                        current_scope_hash=old_scope_hash,
                        base_files=base_files,
                        current_files=current_files,
                        incoming_files=incoming_files,
                        manual_conflicts=merge_result.manual_conflicts,
                        policy_reason=policy.reason,
                    )
                    _log_done(
                        f"{intent.source_channel}_push_pending",
                        intent.project_id,
                        scope_norm,
                        result,
                        started_ms,
                    )
                    return result
                merged_files = merge_result.merged_files
                conflicts = (
                    list(merge_result.auto_merge_records)
                    + list(merge_result.lww_records)
                    + list(merge_result.superseded_by_parent)
                )
                if sparse_merge:
                    new_scope_hash, sparse_changes = await asyncio.to_thread(
                        _apply_sparse_file_merge,
                        repo,
                        old_scope_hash,
                        current_files,
                        merged_files,
                        merge_paths,
                    )
                    changes = build_full_changes(scope_norm, sparse_changes)
                else:
                    new_scope_hash = await asyncio.to_thread(
                        build_tree_from_files, repo.store, merged_files,
                    )
                    changes = compute_changeset(scope_norm, current_files, merged_files)
                merged_changes = _compute_merged_changes(
                    current_files, merged_files, incoming_files, scope_norm,
                )
                commit_id = _select_or_create_commit(
                    repo=repo,
                    intent=intent,
                    tree_id=new_scope_hash,
                    parent_id=current_head_commit_id,
                    created_at_iso=_now_iso(),
                    preserve_client=False,
                )

            if not changes and commit_id == current_head_commit_id:
                return TransactionResult(
                    status="ok",
                    commit_id=current_head_commit_id,
                    new_scope_hash=old_scope_hash,
                    is_noop=True,
                )

            if not promoted_objects and intent.promote_objects is not None and (
                new_scope_hash == intent.proposed_tree_id or commit_id == intent.client_commit_id
            ):
                await asyncio.to_thread(intent.promote_objects)

            created_at_iso = _now_iso()
            if not _commit_exists(repo, commit_id):
                commit_id = await asyncio.to_thread(
                    build_git_commit,
                    repo,
                    tree_sha=new_scope_hash,
                    parent_sha=_git_safe_parent(repo, current_head_commit_id),
                    who=intent.actor,
                    message=intent.message,
                    created_at_iso=created_at_iso,
                )

            result = await _publish_scope_update(
                repo_manager=self._repos,
                repo=repo,
                project_id=intent.project_id,
                scope_path=scope_norm,
                old_scope_hash=old_scope_hash,
                new_scope_hash=new_scope_hash,
                commit_id=commit_id,
                actor=intent.actor,
                message=intent.message,
                op_type=f"{intent.source_channel}_push",
                audit_detail={
                    "base_commit_id": intent.base_commit_id,
                    "client_commit_id": intent.client_commit_id,
                    **intent.audit_detail,
                },
                changes=changes,
                conflicts=conflicts,
                created_at_iso=created_at_iso,
                cas_attempt=attempt + 1,
                merged=bool(conflicts) or new_scope_hash != intent.proposed_tree_id,
                merged_changes=merged_changes,
                source_channel=intent.source_channel,
                base_commit_id=intent.base_commit_id,
                client_commit_id=intent.client_commit_id,
                proposed_tree_id=intent.proposed_tree_id,
                intent_type="submission",
                defer_projection=intent.defer_projection,
            )
            if result is not None:
                _log_done(f"{intent.source_channel}_push", intent.project_id, scope_norm, result, started_ms)
                return result

            last_error = RuntimeError("CAS lost")
            log_info(
                f"[version_engine][{intent.source_channel}_push] CAS lost "
                f"(attempt {attempt + 1}/{_MAX_CAS_ATTEMPTS}) "
                f"project={intent.project_id} scope={scope_norm!r}",
            )

        raise RuntimeError(
            f"[version_engine][{intent.source_channel}_push] CAS still failing "
            f"after {_MAX_CAS_ATTEMPTS} attempts "
            f"(project={intent.project_id}, scope={scope_norm!r}); "
            f"last error: {last_error}",
        )

    async def _rollback_optimistic(
        self,
        intent: RollbackIntent,
        started_ms: int,
    ) -> TransactionResult:
        repo = self._repos.get_server_repo(intent.project_id)
        scope_norm = normalize_path(intent.scope_path)
        target_commit_id = intent.target_commit_id
        if not target_commit_id:
            raise ValueError("target_commit_id is required")

        current_scope_hash, current_head_commit_id = _get_scope_state(repo, scope_norm)
        if target_commit_id == current_head_commit_id:
            return TransactionResult(
                status="already-at-commit",
                commit_id=current_head_commit_id,
                new_scope_hash=current_scope_hash,
                is_noop=True,
            )

        target_entry = repo.get_history_entry(target_commit_id)
        if target_entry:
            target_scope = normalize_path(target_entry.get("scope_path", ""))
            if target_scope != scope_norm:
                raise ValueError(
                    f"commit {target_commit_id} belongs to scope '{target_scope}', "
                    f"not '{scope_norm}'"
                )
        else:
            target_tree = _tree_hash_at_commit(repo, scope_norm, target_commit_id)
            if not target_tree:
                raise ValueError(f"commit {target_commit_id} not found")

        target_files = await asyncio.to_thread(
            _files_at_commit, repo, scope_norm, target_commit_id,
        )

        last_error: Exception | None = None
        for attempt in range(_MAX_CAS_ATTEMPTS):
            old_scope_hash, current_head_commit_id = _get_scope_state(repo, scope_norm)
            current_files = await asyncio.to_thread(
                _scope_files_for_head, repo, scope_norm, old_scope_hash,
            )
            new_scope_hash = await asyncio.to_thread(
                build_tree_from_files, repo.store, target_files,
            )
            changes = compute_changeset(scope_norm, current_files, target_files)
            created_at_iso = _now_iso()
            commit_id = await asyncio.to_thread(
                build_git_commit,
                repo,
                tree_sha=new_scope_hash,
                parent_sha=_git_safe_parent(repo, current_head_commit_id),
                who=intent.actor,
                message=intent.message or f"rollback to {target_commit_id}",
                created_at_iso=created_at_iso,
                validate_parent_graph=False,
            )

            result = await _publish_scope_update(
                repo_manager=self._repos,
                repo=repo,
                project_id=intent.project_id,
                scope_path=scope_norm,
                old_scope_hash=old_scope_hash,
                new_scope_hash=new_scope_hash,
                commit_id=commit_id,
                actor=intent.actor,
                message=intent.message or f"rollback to #{target_commit_id}",
                op_type="rollback",
                audit_detail={
                    "target_commit_id": target_commit_id,
                    "new_commit_id": commit_id,
                    **intent.audit_detail,
                },
                changes=changes,
                conflicts=None,
                created_at_iso=created_at_iso,
                cas_attempt=attempt + 1,
                merged=False,
                merged_changes=[],
                defer_projection=intent.defer_projection,
                source_channel=intent.source_channel,
                base_commit_id=current_head_commit_id,
                proposed_tree_id=new_scope_hash,
                intent_type="rollback",
            )
            if result is not None:
                result.status = "rolled-back"
                _log_done("rollback", intent.project_id, scope_norm, result, started_ms)
                return result

            last_error = RuntimeError("CAS lost")
            log_info(
                f"[version_engine][rollback] CAS lost "
                f"(attempt {attempt + 1}/{_MAX_CAS_ATTEMPTS}) "
                f"project={intent.project_id} scope={scope_norm!r}",
            )

        await asyncio.to_thread(
            repo.record_audit,
            "rollback_error",
            intent.actor,
            {
                "scope": scope_norm,
                "target_commit_id": target_commit_id,
                "error": "CAS failed after max retries",
                **(intent.audit_detail or {}),
            },
        )
        raise RuntimeError(
            f"[version_engine][rollback] CAS still failing "
            f"after {_MAX_CAS_ATTEMPTS} attempts "
            f"(project={intent.project_id}, scope={scope_norm!r}); "
            f"last error: {last_error}",
        )

    async def _rollback_root_first(
        self,
        intent: RollbackIntent,
        started_ms: int,
    ) -> TransactionResult:
        repo = self._repos.get_server_repo(intent.project_id)
        scope_norm = normalize_path(intent.scope_path)
        target_commit_id = intent.target_commit_id
        if not target_commit_id:
            raise ValueError("target_commit_id is required")

        target_entry = repo.get_history_entry(target_commit_id)
        if target_entry:
            target_scope = normalize_path(target_entry.get("scope_path", ""))
            if target_scope != scope_norm:
                raise ValueError(
                    f"commit {target_commit_id} belongs to scope '{target_scope}', "
                    f"not '{scope_norm}'"
                )
        else:
            target_tree = _tree_hash_at_commit(repo, scope_norm, target_commit_id)
            if not target_tree:
                raise ValueError(f"commit {target_commit_id} not found")

        target_files = await asyncio.to_thread(
            _files_at_commit, repo, scope_norm, target_commit_id,
        )
        new_scope_hash = await asyncio.to_thread(
            build_tree_from_files, repo.store, target_files,
        )

        last_error: Exception | None = None
        for attempt in range(_MAX_CAS_ATTEMPTS):
            attempt_no = attempt + 1
            old_root_hash, base_root_hash = _get_project_root_state_for_write(repo)
            project_head_commit_id = _get_project_view_head(repo, old_root_hash)
            current_scope_hash = _scope_tree_hash_for_write(
                repo, base_root_hash, scope_norm,
            )
            _cached_scope_hash, current_scope_head_id = _get_scope_state(
                repo, scope_norm,
            )
            current_scope_head_id = (
                current_scope_head_id
                or (project_head_commit_id if not scope_norm else "")
            )
            if target_commit_id == current_scope_head_id:
                return TransactionResult(
                    status="already-at-commit",
                    commit_id=current_scope_head_id,
                    new_scope_hash=current_scope_hash,
                    is_noop=True,
                )

            current_files = await asyncio.to_thread(
                flatten_tree_to_bytes, repo.store, current_scope_hash,
            )
            changes = compute_changeset(scope_norm, current_files, target_files)
            if not changes and new_scope_hash == current_scope_hash:
                return TransactionResult(
                    status="ok",
                    commit_id=current_scope_head_id,
                    new_scope_hash=current_scope_hash,
                    is_noop=True,
                )

            new_root_hash = _graft_scope_tree(
                repo, base_root_hash, scope_norm, new_scope_hash,
            )
            created_at_iso = _now_iso()
            commit_id = await asyncio.to_thread(
                build_git_commit,
                repo,
                tree_sha=new_root_hash,
                parent_sha=_git_safe_parent(repo, project_head_commit_id),
                who=intent.actor,
                message=intent.message or f"rollback to {target_commit_id}",
                created_at_iso=created_at_iso,
                validate_parent_graph=False,
            )
            scope_head_commit_id = ""
            if scope_norm:
                scope_head_commit_id = await asyncio.to_thread(
                    _build_scope_view_commit,
                    repo,
                    scope_path=scope_norm,
                    scope_hash=new_scope_hash,
                    parent_id=current_scope_head_id,
                    actor=intent.actor,
                    message=intent.message or f"rollback to {target_commit_id}",
                    created_at_iso=created_at_iso,
                    source_channel=intent.source_channel,
                    original_commit_id=target_commit_id,
                    base_commit_id=current_scope_head_id,
                )

            result = await _publish_project_update(
                repo_manager=self._repos,
                repo=repo,
                project_id=intent.project_id,
                old_root_hash=old_root_hash,
                new_root_hash=new_root_hash,
                scope_path=scope_norm,
                scope_hash=new_scope_hash,
                scope_head_commit_id=scope_head_commit_id,
                commit_id=commit_id,
                actor=intent.actor,
                message=intent.message or f"rollback to #{target_commit_id}",
                op_type="rollback",
                audit_detail={
                    "target_commit_id": target_commit_id,
                    "new_commit_id": commit_id,
                    **intent.audit_detail,
                },
                changes=changes,
                conflicts=None,
                created_at_iso=created_at_iso,
                cas_attempt=attempt_no,
                merged=False,
                merged_changes=[],
                source_channel=intent.source_channel,
                base_commit_id=current_scope_head_id,
                proposed_tree_id=new_scope_hash,
                intent_type="rollback",
            )
            if result is not None:
                result.status = "rolled-back"
                result.new_scope_hash = new_scope_hash
                _log_done("rollback", intent.project_id, scope_norm, result, started_ms)
                return result

            last_error = RuntimeError("project root CAS lost")
            log_info(
                f"[version_engine][rollback] root CAS lost "
                f"(attempt {attempt_no}/{_MAX_CAS_ATTEMPTS}) "
                f"project={intent.project_id} scope={scope_norm!r}",
            )

        await asyncio.to_thread(
            repo.record_audit,
            "rollback_error",
            intent.actor,
            {
                "scope": scope_norm,
                "target_commit_id": target_commit_id,
                "error": "root CAS failed after max retries",
                **(intent.audit_detail or {}),
            },
        )
        raise RuntimeError(
            f"[version_engine][rollback] root CAS still failing "
            f"after {_MAX_CAS_ATTEMPTS} attempts "
            f"(project={intent.project_id}, scope={scope_norm!r}); "
            f"last error: {last_error}",
        )

    async def _record_pending_conflict(
        self,
        *,
        repo,
        intent: VersionSubmissionIntent,
        scope_path: str,
        current_head_commit_id: str,
        current_scope_hash: str,
        base_files: dict[str, bytes],
        current_files: dict[str, bytes],
        incoming_files: dict[str, bytes],
        manual_conflicts: list,
        policy_reason: str,
    ) -> TransactionResult:
        """Submission-intent shaped wrapper. Adapter calls the generic
        impl below for the Git push path."""

        return await _record_pending_conflict_generic(
            ledger=self._ledger,
            repo=repo,
            project_id=intent.project_id,
            scope_path=scope_path,
            current_head_commit_id=current_head_commit_id,
            current_scope_hash=current_scope_hash,
            client_commit_id=intent.client_commit_id,
            base_commit_id=intent.base_commit_id,
            proposed_tree_id=intent.proposed_tree_id,
            source_channel=intent.source_channel,
            actor=intent.actor,
            message=intent.message,
            audit_detail=_audit_detail_with_pusher(intent),
            base_files=base_files,
            current_files=current_files,
            incoming_files=incoming_files,
            manual_conflicts=manual_conflicts,
            policy_reason=policy_reason,
        )
