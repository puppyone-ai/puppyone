"""Git-native write transaction engine.

This is the publish authority for PuppyOne version writes. Adapters may
parse protocols, and product services may build typed splices, but this
module owns the decision to turn an intent into visible Git version facts,
history, audit, and projection updates.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Callable

from src.version_engine.application.object_store import ObjectStore
from src.version_engine.application.path_utils import normalize_path

from src.version_engine.application.conflict_policy import (
    conflict_to_dict,
    merge_file_sets_for_policy,
    select_conflict_policy,
)
from src.version_engine.application.git_commit import (
    build_git_commit,
    commit_tree_id,
    git_compatibility_error,
    shallow_git_parent_or_empty,
)
from src.version_engine.application.git_object_format import encode_tree
from src.version_engine.application.diff import diff_trees
from src.version_engine.application.tree_objects import (
    build_full_changes,
    build_tree_from_files,
    compute_changeset,
    flatten_tree_to_bytes,
    join_scope_path,
    validate_scope_bound_files,
)
from src.version_engine.domain.intents import (
    ConflictResolutionIntent,
    OperationWriteIntent,
    RollbackIntent,
    TransactionResult,
    VersionSubmissionIntent,
)
from src.version_engine.server.db_names import CONFLICTS_TABLE, VERSION_OUTBOX_TABLE
from src.version_engine.server.repo_manager import VersionRepoManager
from src.version_engine.server.backends.s3_storage import stage_object_writes
from src.version_engine.services.tree_splice import splice_batch
from src.version_engine.services.version_trace import (
    VersionTrace,
    active_version_trace,
    trace_mark,
    trace_phase,
    use_version_trace,
)
from src.utils.logger import log_error, log_info, log_warning


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


class GitNativeTransactionEngine:
    """Single publish authority for operation and version submissions."""

    def __init__(self, repo_manager: VersionRepoManager):
        self._repos = repo_manager

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

        return await self._apply_operation_optimistic(
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

        return await self._submit_version_optimistic(intent, started_ms)

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

        return await self._rollback_optimistic(intent, started_ms)

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
            _load_pending_conflict_row,
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
                _close_pending_conflict_row,
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
            _mark_pending_conflict_row,
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
        result = await self._submit_version_optimistic(submission, started_ms)

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
                _close_pending_conflict_row,
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
                    ) = self._merge_on_cas_retry(
                        repo=repo,
                        intent=intent,
                        scope_norm=scope_norm,
                        base_scope_hash=base_scope_hash,
                        current_scope_hash=old_scope_hash,
                        incoming_scope_hash=new_scope_hash,
                    )
                    # If the merge classified anything as manual_review,
                    # don't commit — queue the conflict and return.
                    if manual_conflicts and merge_policy == "manual_review":
                        pending_result = await self._record_pending_conflict_generic(
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
                            audit_detail=dict(intent.audit_detail or {}),
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
            result = await self._publish_scope_update(
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

    def _merge_on_cas_retry(
        self,
        *,
        repo,
        intent: OperationWriteIntent,
        scope_norm: str,
        base_scope_hash: str,
        current_scope_hash: str,
        incoming_scope_hash: str,
    ) -> "tuple[str | None, dict | None, list, str, dict, dict, dict]":
        """Run the V1 policy three-way merge during a CAS retry.

        Returns the seven-tuple

            (merged_tree_hash, audit_dict, manual_conflicts,
             policy_name, base_files, current_files, incoming_files)

        so the caller (``_apply_operation_optimistic``) can:

          * use ``merged_tree_hash`` as the publish tree on a clean
            merge (everything safe / LWW resolved)
          * route through ``_record_pending_conflict_generic`` when
            ``manual_conflicts`` is non-empty AND ``policy_name`` is
            ``manual_review`` — the trailing dicts are the inputs that
            helper expects so it can persist them as audit context.

        Tree-load and splice failures are loud. Continuing with the
        pre-merge splice would turn a CAS retry into a blind overwrite.

        ``base``   = scope tree the operation was originally splice'd against
                     (the actor's perceived starting point, captured on
                     attempt 0).
        ``current`` = scope tree as it now stands after a concurrent
                       writer (A) committed.
        ``incoming`` = tree the splice produced this attempt — caller's
                        intent applied on top of ``current``. It carries
                        B's content at the touched paths but lost A's
                        edits at those same paths.

        Three-way merge against ``base`` recovers A's content where the
        safe-merge strategies (identical / one_side_only / json / line)
        can combine the two sides; otherwise the configured policy
        (LWW or manual_review) fires.
        """

        try:
            base_files = flatten_tree_to_bytes(repo.store, base_scope_hash)
            current_files = flatten_tree_to_bytes(repo.store, current_scope_hash)
            incoming_files = flatten_tree_to_bytes(repo.store, incoming_scope_hash)
        except Exception as exc:
            log_warning(
                f"[cas-retry-merge] failed to load tree files "
                f"(base={base_scope_hash[:8]}, current={current_scope_hash[:8]}, "
                f"incoming={incoming_scope_hash[:8]}): {exc}",
            )
            raise RuntimeError("CAS retry merge could not load tree files") from exc

        # Touched paths drive policy selection (e.g. *.lock → manual_review).
        touched = sorted(
            (set(current_files) | set(incoming_files))
            - {
                p for p in (set(current_files) & set(incoming_files))
                if current_files.get(p) == incoming_files.get(p)
            }
        )
        if not touched:
            return (None, None, [], "", {}, {}, {})

        # Caller's policy_override (set on OperationWriteIntent) wins over
        # configured rules when non-empty — the runner / API caller
        # opted into a stricter policy and the engine must honor it.
        if getattr(intent, "policy_override", "") == "manual_review":
            from src.version_engine.domain.conflicts import ConflictPolicyDecision
            policy = ConflictPolicyDecision(
                policy="manual_review",
                reason="op_intent_override:manual_review",
            )
        else:
            policy = select_conflict_policy(
                scope_path=scope_norm,
                source_channel=intent.source_channel,
                actor=intent.actor,
                paths=touched,
            )
        merge_result = merge_file_sets_for_policy(
            base_files, current_files, incoming_files,
            policy=policy,
        )

        # Apply the merged file set on top of current head as a batch
        # splice. We must emit explicit ``rm`` ops for any path that
        # the merge considered (was in base / current / incoming) but
        # DIDN'T end up in ``merged_files`` — that signals "the merge
        # decided to honor a delete". Without this, ``splice_batch``
        # leaves those paths at their current-tree value, which
        # silently resurrects files that one side deleted while the
        # other left untouched (the C12 / C07 shape).
        ops: list = []
        considered_paths = (
            set(base_files) | set(current_files) | set(incoming_files)
        )
        for path in considered_paths:
            if path in merge_result.merged_files:
                content = merge_result.merged_files[path]
                if content is None:
                    ops.append(("rm", path))
                else:
                    # Only re-put when the merge picked something
                    # different from current (avoid no-op splice ops).
                    if current_files.get(path) != content:
                        ops.append(("put", path, content))
            else:
                # Merge decided "this path should not exist". If current
                # has it, emit an explicit rm. If current also lacks
                # it, no op needed.
                if path in current_files:
                    ops.append(("rm", path))
        # Paths present in current but absent from merged_files were
        # untouched — splice_batch leaves them alone.
        try:
            merged_tree, _splice_changes = splice_batch(
                repo.store, current_scope_hash, ops,
            )
        except Exception as exc:
            log_warning(
                f"[cas-retry-merge] splice_batch failed for "
                f"{len(ops)} ops: {exc}",
            )
            raise RuntimeError("CAS retry merge splice failed") from exc

        audit = {
            "policy": policy.policy,
            "policy_reason": policy.reason,
            "base_scope_hash": base_scope_hash,
            "current_scope_hash": current_scope_hash,
            "auto_merged_paths": [r.path for r in merge_result.auto_merge_records],
            "lww_paths": [r.path for r in merge_result.lww_records],
            "superseded_paths": [
                r.path for r in merge_result.superseded_by_parent
            ],
            "pending_paths": [r.path for r in merge_result.manual_conflicts],
        }
        log_info(
            f"[cas-retry-merge] scope={scope_norm!r} "
            f"auto={len(merge_result.auto_merge_records)} "
            f"lww={len(merge_result.lww_records)} "
            f"pending={len(merge_result.manual_conflicts)} "
            f"superseded={len(merge_result.superseded_by_parent)}",
        )
        return (
            merged_tree, audit,
            list(merge_result.manual_conflicts),
            policy.policy,
            base_files, current_files, incoming_files,
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
                result = await self._publish_project_update(
                    repo=repo,
                    project_id=intent.project_id,
                    old_root_hash=old_root_hash,
                    new_root_hash=new_root_hash,
                    commit_id=new_commit_id,
                    actor=intent.actor,
                    message=intent.message,
                    op_type=intent.operation_type,
                    audit_detail=intent.audit_detail,
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
                        _insert_version_transaction_row,
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
                commit_id = self._select_or_create_commit(
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
                if merge_result.manual_conflicts and policy.policy == "manual_review":
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
                commit_id = self._select_or_create_commit(
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

            result = await self._publish_scope_update(
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
        if not target_entry:
            raise ValueError(f"commit {target_commit_id} not found")
        target_scope = normalize_path(target_entry.get("scope_path", ""))
        if target_scope != scope_norm:
            raise ValueError(
                f"commit {target_commit_id} belongs to scope '{target_scope}', "
                f"not '{scope_norm}'"
            )

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

            result = await self._publish_scope_update(
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

        return await self._record_pending_conflict_generic(
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
            audit_detail=intent.audit_detail,
            base_files=base_files,
            current_files=current_files,
            incoming_files=incoming_files,
            manual_conflicts=manual_conflicts,
            policy_reason=policy_reason,
        )

    async def _record_pending_conflict_generic(
        self,
        *,
        repo,
        project_id: str,
        scope_path: str,
        current_head_commit_id: str,
        current_scope_hash: str,
        client_commit_id: str,
        base_commit_id: str,
        proposed_tree_id: str,
        source_channel: str,
        actor: str,
        message: str,
        audit_detail: dict,
        base_files: dict[str, bytes],
        current_files: dict[str, bytes],
        incoming_files: dict[str, bytes],
        manual_conflicts: list,
        policy_reason: str,
    ) -> TransactionResult:
        """Persist a pending conflict for manual review.

        Generic shape (no intent-specific dependency) so both Git push
        (``VersionSubmissionIntent``) and ProductOperationAdapter op writes
        (``OperationWriteIntent``) can queue conflicts via the same path.
        """

        paths = sorted({
            getattr(conflict, "path", "")
            for conflict in manual_conflicts
            if getattr(conflict, "path", "")
        })
        pending_conflict_id = _pending_conflict_id(
            project_id,
            scope_path,
            current_head_commit_id,
            client_commit_id,
            paths,
        )
        audit = {
            "status": "pending_manual_review",
            "pending_conflict_id": pending_conflict_id,
            "policy": "manual_review",
            "policy_reason": policy_reason,
            "scope": scope_path,
            "base_commit_id": base_commit_id,
            "current_head_commit_id": current_head_commit_id,
            "client_commit_id": client_commit_id,
            "proposed_tree_id": proposed_tree_id,
            "current_scope_hash": current_scope_hash,
            "conflict_count": len(manual_conflicts),
            "conflicts": [conflict_to_dict(conflict) for conflict in manual_conflicts],
            "base_paths": sorted(base_files),
            "current_paths": sorted(current_files),
            "incoming_paths": sorted(incoming_files),
            **(audit_detail or {}),
        }
        await asyncio.to_thread(
            repo.record_audit,
            f"{source_channel}_push_conflict_pending",
            actor,
            audit,
        )
        # Record a non-committed version_transactions row so the ledger
        # captures the full lifecycle (received → pending_manual_review),
        # not just successful commits. The row's id is used as the FK in
        # pending-conflict storage so the conflict resolver UI can join cleanly.
        txn_id: int | None = None
        try:
            txn_id = await asyncio.to_thread(
                _insert_version_transaction_row,
                project_id=project_id,
                scope_path=scope_path,
                source_channel=source_channel,
                actor=actor,
                intent_type="submission",
                status="pending_manual_review",
                policy="manual_review",
                base_commit_id=base_commit_id,
                client_commit_id=client_commit_id,
                proposed_tree_id=proposed_tree_id,
                current_head_at_start=current_head_commit_id,
                message=message,
                audit_detail={
                    "pending_conflict_id": pending_conflict_id,
                    **(audit_detail or {}),
                },
                reason=policy_reason,
            )
        except Exception as exc:
            log_warning(
                f"[version_engine] failed to record pending version_transactions "
                f"row for {pending_conflict_id[:12]}: {exc}",
            )

        try:
            await asyncio.to_thread(
                _record_pending_conflict_row,
                project_id=project_id,
                pending_conflict_id=pending_conflict_id,
                scope_path=scope_path,
                base_commit_id=base_commit_id,
                current_commit_id=current_head_commit_id,
                client_commit_id=client_commit_id,
                proposed_tree_id=proposed_tree_id,
                changed_paths=paths,
                conflicts=manual_conflicts,
                policy="manual_review",
                source_channel=source_channel,
                actor=actor,
                transaction_id=txn_id,
            )
        except Exception as exc:
            log_warning(
                f"[version_engine] failed to persist pending-conflict row "
                f"{pending_conflict_id[:12]}: {exc}",
            )
        return TransactionResult(
            status="pending",
            merged=False,
            conflicts=len(manual_conflicts),
            paths=paths,
            new_scope_hash=current_scope_hash,
            pending_conflict_id=pending_conflict_id,
            reason="manual_review_required",
        )

    def _select_or_create_commit(
        self,
        *,
        repo,
        intent: VersionSubmissionIntent,
        tree_id: str,
        parent_id: str,
        created_at_iso: str,
        preserve_client: bool,
    ) -> str:
        if preserve_client and intent.client_commit_id:
            try:
                if (
                    _commit_exists(repo, intent.client_commit_id)
                    and commit_tree_id(repo, intent.client_commit_id) == tree_id
                    and shallow_git_parent_or_empty(repo, intent.client_commit_id)
                    == intent.client_commit_id
                ):
                    return intent.client_commit_id
                compatibility_error = git_compatibility_error(repo, intent.client_commit_id)
                if compatibility_error:
                    raise ValueError(compatibility_error)
            except Exception as e:
                log_warning(
                    f"[version_engine] cannot preserve client commit "
                    f"{intent.client_commit_id[:12]}: {e}",
                )
        # Server-synthesized commit — stamp immutable provenance trailers.
        trailers = {
            "PuppyOne-Source": intent.source_channel,
            "PuppyOne-Scope": normalize_path(intent.scope_path) or "/",
            "PuppyOne-Original-Commit": intent.client_commit_id or "",
            "PuppyOne-Base-Commit": intent.base_commit_id or "",
        }
        return build_git_commit(
            repo,
            tree_sha=tree_id,
            parent_sha=_git_safe_parent(repo, parent_id),
            who=intent.actor,
            message=intent.message,
            created_at_iso=created_at_iso,
            trailers=trailers,
            validate_parent_graph=False,
        )

    async def _publish_scope_update(
        self,
        *,
        repo,
        project_id: str,
        scope_path: str,
        old_scope_hash: str,
        new_scope_hash: str,
        commit_id: str,
        actor: str,
        message: str,
        op_type: str,
        audit_detail: dict,
        changes: list[dict],
        conflicts,
        created_at_iso: str,
        cas_attempt: int,
        merged: bool,
        merged_changes: list[dict],
        defer_projection: bool,
        source_channel: str = "",
        policy: str = "",
        base_commit_id: str = "",
        client_commit_id: str = "",
        proposed_tree_id: str = "",
        intent_type: str = "operation",
    ) -> TransactionResult | None:
        audit = {
            "scope": scope_path,
            "commit_id": commit_id,
            "scope_hash": new_scope_hash,
            "cas_attempts": cas_attempt,
            "changes": len(changes),
            "merged": merged,
            "conflict_count": len(conflicts or []),
            **(audit_detail or {}),
        }
        publish_outcome = await asyncio.to_thread(
            repo.publish_scope_update,
            scope_path=scope_path,
            old_scope_hash=old_scope_hash,
            new_scope_hash=new_scope_hash,
            commit_id=commit_id,
            who=actor,
            message=message,
            changes=changes,
            conflicts=conflicts,
            created_at_iso=created_at_iso,
            audit_event_type=op_type,
            audit_agent_id=actor,
            audit_detail=audit,
            source_channel=source_channel,
            policy=policy,
            base_commit_id=base_commit_id,
            client_commit_id=client_commit_id,
            proposed_tree_id=proposed_tree_id,
            intent_type=intent_type,
        )
        if isinstance(publish_outcome, tuple):
            published, _txn_id = publish_outcome
        else:
            published, _txn_id = bool(publish_outcome), None
        if not published:
            return None

        push_result = {
            "status": "ok",
            "commit_id": commit_id,
            "root": new_scope_hash,
            "merged": merged,
            "conflicts": len(conflicts or []),
        }
        try:
            from src.version_engine.services.hooks import (
                run_post_push_hook,
                schedule_post_push_hook,
            )
            from src.version_engine.services.version_outbox import (
                complete_version_outbox_for_commit,
            )

            if defer_projection:
                schedule_post_push_hook(project_id, self._repos, push_result)
            else:
                await asyncio.to_thread(
                    run_post_push_hook,
                    project_id,
                    self._repos,
                    push_result,
                    raise_errors=True,
                )
                await asyncio.to_thread(
                    complete_version_outbox_for_commit,
                    project_id,
                    commit_id,
                )
        except Exception as e:
            log_error(
                f"[version_engine][{op_type}] projection hook failed "
                f"(commit landed but project view may lag): {e}",
            )

        commit_object = ""
        try:
            commit_object = base64.b64encode(repo.store.get_loose(commit_id)).decode()
        except Exception:
            pass

        return TransactionResult(
            commit_id=commit_id,
            status="ok",
            merged=merged,
            conflicts=len(conflicts or []),
            paths=[c["path"] for c in changes],
            changes=changes,
            new_scope_hash=new_scope_hash,
            is_noop=False,
            merged_changes=merged_changes,
            commit_object=commit_object,
        )

    async def _publish_project_update(
        self,
        *,
        repo,
        project_id: str,
        old_root_hash: str,
        new_root_hash: str,
        commit_id: str,
        actor: str,
        message: str,
        op_type: str,
        audit_detail: dict,
        changes: list[dict],
        conflicts,
        created_at_iso: str,
        cas_attempt: int,
        merged: bool,
        merged_changes: list[dict],
        source_channel: str = "",
        policy: str = "",
        base_commit_id: str = "",
        client_commit_id: str = "",
        proposed_tree_id: str = "",
        intent_type: str = "operation",
    ) -> TransactionResult | None:
        audit = {
            "scope": "",
            "commit_id": commit_id,
            "root_hash": new_root_hash,
            "scope_hash": new_root_hash,
            "cas_attempts": cas_attempt,
            "changes": len(changes),
            "merged": merged,
            "conflict_count": len(conflicts or []),
            "project_root_operation": True,
            **(audit_detail or {}),
        }
        with trace_phase("db.publish_project_update.rpc", commit_id=commit_id[:12]):
            published = await asyncio.to_thread(
                repo.publish_project_update,
                old_root_hash=old_root_hash,
                new_root_hash=new_root_hash,
                commit_id=commit_id,
                who=actor,
                message=message,
                changes=changes,
                conflicts=conflicts,
                created_at_iso=created_at_iso,
                audit_event_type=op_type,
                audit_agent_id=actor,
                audit_detail=audit,
                source_channel=source_channel,
                policy=policy,
                base_commit_id=base_commit_id,
                client_commit_id=client_commit_id,
                proposed_tree_id=proposed_tree_id,
                intent_type=intent_type,
            )
        if isinstance(published, tuple):
            published, _txn_id = published
        else:
            published, _txn_id = bool(published), None
        if not published:
            return None

        push_result = {
            "status": "ok",
            "commit_id": commit_id,
            "root": new_root_hash,
            "old_root": old_root_hash,
            "merged": merged,
            "conflicts": len(conflicts or []),
        }
        try:
            from src.version_engine.services.hooks import schedule_post_project_update_hook

            with trace_phase("hook.schedule_project_update", commit_id=commit_id[:12]):
                schedule_post_project_update_hook(project_id, self._repos, push_result)
        except Exception as e:
            log_error(
                f"[version_engine][{op_type}:project] projection hook failed "
                f"(commit landed but derived views may lag): {e}",
            )

        commit_object = ""
        try:
            with trace_phase("object.read_commit_for_response", commit_id=commit_id[:12]):
                commit_object = base64.b64encode(repo.store.get_loose(commit_id)).decode()
        except Exception:
            pass

        return TransactionResult(
            commit_id=commit_id,
            status="ok",
            merged=merged,
            conflicts=len(conflicts or []),
            paths=[c["path"] for c in changes],
            changes=changes,
            new_scope_hash=new_root_hash,
            is_noop=False,
            merged_changes=merged_changes,
            commit_object=commit_object,
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _commit_exists(repo, commit_id: str) -> bool:
    return bool(commit_id) and repo.store.exists(commit_id)


def _git_safe_parent(repo, commit_id: str) -> str:
    return shallow_git_parent_or_empty(repo, commit_id)


def _get_scope_state(repo, scope_path: str) -> tuple[str, str]:
    get_state = getattr(repo, "get_scope_state", None)
    if callable(get_state):
        scope_hash, head_commit_id = get_state(scope_path)
        return scope_hash or "", head_commit_id or ""
    return (
        repo.get_scope_hash(scope_path) or "",
        repo.get_scope_head_commit_id(scope_path) or "",
    )


def _get_project_root_hash(repo) -> str:
    try:
        return repo.get_root_hash() or ""
    except Exception:
        return ""


def _get_project_view_head(repo, project_root_hash: str = "") -> str:
    root_state = getattr(repo, "get_scope_state", None)
    if callable(root_state):
        try:
            root_hash, root_head = root_state("")
            if root_head and root_hash == project_root_hash:
                return root_head
        except Exception:
            pass
    latest = getattr(repo, "get_latest_project_view_commit_id", None)
    if callable(latest):
        try:
            commit_id = latest() or ""
            if commit_id:
                return commit_id
        except Exception:
            pass
    head = getattr(repo, "get_head_commit_id", None)
    if callable(head):
        try:
            return head() or ""
        except Exception:
            return ""
    return ""


def _pending_conflict_id(
    project_id: str,
    scope_path: str,
    current_head_commit_id: str,
    client_commit_id: str,
    paths: list[str],
) -> str:
    payload = json.dumps(
        {
            "project_id": project_id,
            "scope_path": scope_path,
            "current_head_commit_id": current_head_commit_id,
            "client_commit_id": client_commit_id,
            "paths": paths,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha1(payload).hexdigest()


def _scope_files_for_head(repo, scope_path: str, scope_hash: str) -> dict[str, bytes]:
    if scope_hash:
        return flatten_tree_to_bytes(repo.store, scope_hash)
    scope = {"id": scope_path or "_root", "path": scope_path, "exclude": [], "mode": "rw"}
    try:
        return repo.list_scope_files(scope)
    except Exception:
        return {}


def _changed_relative_paths(
    old_files: dict[str, bytes],
    new_files: dict[str, bytes],
) -> list[str]:
    changed: list[str] = []
    for path in sorted(set(old_files) | set(new_files)):
        if old_files.get(path) != new_files.get(path):
            changed.append(path)
    return changed


def _changed_paths_from_tree_diff(repo, old_tree: str, new_tree: str) -> list[str]:
    return [
        normalize_path(change.get("path", ""))
        for change in _expanded_tree_diff(repo, old_tree, new_tree)
        if normalize_path(change.get("path", ""))
    ]


def _changes_from_tree_diff(
    repo,
    scope_path: str,
    old_tree: str,
    new_tree: str,
) -> list[dict]:
    op_to_action = {
        "added": "add",
        "deleted": "delete",
        "modified": "update",
    }
    scope_norm = normalize_path(scope_path)
    changes: list[dict] = []
    for change in _expanded_tree_diff(repo, old_tree, new_tree):
        rel_path = normalize_path(change.get("path", ""))
        if not rel_path:
            continue
        changes.append({
            "path": join_scope_path(scope_norm, rel_path),
            "action": op_to_action.get(change.get("op"), "update"),
        })
    return changes


def _expanded_tree_diff(repo, old_tree: str, new_tree: str) -> list[dict]:
    expanded: list[dict] = []
    for change in _raw_tree_diff(repo, old_tree, new_tree):
        rel_path = normalize_path(change.get("path", ""))
        op = change.get("op")
        if op in {"added", "deleted"}:
            source_tree = new_tree if op == "added" else old_tree
            child_paths = _expand_tree_path_if_directory(repo, source_tree, rel_path)
            if child_paths:
                expanded.extend({"path": path, "op": op} for path in child_paths)
                continue
        expanded.append(change)
    return expanded


def _expand_tree_path_if_directory(repo, tree_hash: str, rel_path: str) -> list[str]:
    entry = _entry_at_tree_path(repo, tree_hash, rel_path)
    if not entry or entry[0] != "T":
        return []
    from src.version_engine.application import tree as tree_mod

    flat = tree_mod.tree_to_flat(repo.store, entry[1])
    if not flat:
        return [rel_path]
    return [
        f"{rel_path}/{child}" if rel_path else child
        for child in sorted(flat)
    ]


def _raw_tree_diff(repo, old_tree: str, new_tree: str) -> list[dict]:
    if old_tree == new_tree:
        return []
    if not old_tree:
        old_tree = repo.store.put_tree(encode_tree([]))
    if not new_tree:
        new_tree = repo.store.put_tree(encode_tree([]))
    return diff_trees(repo.store, old_tree, new_tree)


def _tree_hash_at_commit(repo, scope_path: str, commit_id: str) -> str:
    if not commit_id:
        return ""
    entry = repo.get_history_entry(commit_id)
    if entry:
        scope_hash = entry.get("scope_hash", "")
        if scope_hash and repo.store.exists(scope_hash):
            return scope_hash
        root_hash = entry.get("root") or entry.get("root_hash", "")
        if root_hash and repo.store.exists(root_hash):
            return _tree_hash_at_path(repo, root_hash, scope_path)
        return ""
    try:
        obj_type, _body = repo.store.get_object(commit_id)
        if obj_type != "commit":
            return ""
        tree_id = commit_tree_id(repo, commit_id)
        return tree_id if tree_id and repo.store.exists(tree_id) else ""
    except Exception:
        return ""


def _tree_hash_at_path(repo, root_hash: str, scope_path: str) -> str:
    if not root_hash:
        return ""
    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        return root_hash
    from src.version_engine.application import tree as tree_mod

    current = root_hash
    for part in [p for p in scope_norm.split("/") if p]:
        try:
            entries = tree_mod.read_tree(repo.store, current)
        except Exception:
            return ""
        typ, child = entries.get(part, (None, None))
        if typ != "T" or not child:
            return ""
        current = child
    return current


def _sparse_files_at_tree_paths(
    repo,
    tree_hash: str,
    paths: list[str],
) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for path in sorted({normalize_path(path) for path in paths if normalize_path(path)}):
        blob_hash = _blob_hash_at_tree_path(repo, tree_hash, path)
        if blob_hash:
            files[path] = repo.store.get(blob_hash)
    return files


def _blob_hash_at_tree_path(repo, tree_hash: str, rel_path: str) -> str:
    entry = _entry_at_tree_path(repo, tree_hash, rel_path)
    if not entry:
        return ""
    typ, child = entry
    return child if typ == "B" else ""


def _entry_at_tree_path(repo, tree_hash: str, rel_path: str) -> tuple[str, str] | None:
    if not tree_hash:
        return None
    parts = [p for p in normalize_path(rel_path).split("/") if p]
    if not parts:
        return None
    from src.version_engine.application import tree as tree_mod

    current = tree_hash
    for index, part in enumerate(parts):
        try:
            entries = tree_mod.read_tree(repo.store, current)
        except Exception:
            return None
        typ, child = entries.get(part, (None, None))
        if not typ or not child:
            return None
        if index == len(parts) - 1:
            return typ, child
        if typ != "T":
            return None
        current = child
    return None


def _apply_sparse_file_merge(
    repo,
    current_tree: str,
    current_files: dict[str, bytes],
    merged_files: dict[str, bytes],
    changed_paths: list[str],
) -> tuple[str, list[tuple[str, str]]]:
    ops: list[tuple] = []
    paths = sorted(
        {normalize_path(p) for p in changed_paths if normalize_path(p)}
        | set(current_files)
        | set(merged_files)
    )
    for path in paths:
        if path in merged_files:
            ops.append(("put", path, merged_files[path]))
        elif path in current_files:
            ops.append(("rm", path))
    if not ops:
        return current_tree, []
    return splice_batch(repo.store, current_tree, ops)


def _files_at_commit(repo, scope_path: str, commit_id: str) -> dict[str, bytes]:
    if not commit_id:
        return {}
    tree_hash = _tree_hash_at_commit(repo, scope_path, commit_id)
    if tree_hash:
        return flatten_tree_to_bytes(repo.store, tree_hash)
    entry = repo.get_history_entry(commit_id)
    if not entry:
        try:
            obj_type, body = repo.store.get_object(commit_id)
            if obj_type != "commit":
                return {}
            tree_id = commit_tree_id(repo, commit_id)
            if not tree_id or not repo.store.exists(tree_id):
                return {}
            return flatten_tree_to_bytes(repo.store, tree_id)
        except Exception:
            return {}
    scope_hash = entry.get("scope_hash", "")
    if scope_hash and repo.store.exists(scope_hash):
        return flatten_tree_to_bytes(repo.store, scope_hash)
    root_hash = entry.get("root") or entry.get("root_hash", "")
    if not root_hash or not repo.store.exists(root_hash):
        return {}

    try:
        from src.version_engine.application import tree as tree_mod

        parts = [p for p in normalize_path(scope_path).split("/") if p]
        current = root_hash
        for part in parts:
            entries = tree_mod.read_tree(repo.store, current)
            typ, child = entries.get(part, (None, None))
            if typ != "T":
                return {}
            current = child
        return flatten_tree_to_bytes(repo.store, current)
    except Exception:
        return {}


def _compute_merged_changes(
    our_files: dict[str, bytes],
    merged_files: dict[str, bytes],
    their_files: dict[str, bytes],
    scope_path: str,
) -> list[dict]:
    merged_changes: list[dict] = []
    scope_prefix = normalize_path(scope_path)
    for rel_path, content in merged_files.items():
        full = f"{scope_prefix}/{rel_path}" if scope_prefix else rel_path
        if rel_path not in their_files and rel_path in our_files:
            merged_changes.append({"path": full, "action": "merged_from_server"})
        elif rel_path in their_files and rel_path in our_files:
            if content != their_files[rel_path] and content != our_files.get(rel_path):
                merged_changes.append({"path": full, "action": "content_merged"})
    return merged_changes


def _log_done(
    op_type: str,
    project_id: str,
    scope_path: str,
    result: TransactionResult,
    started_ms: int,
) -> None:
    elapsed = int(time.time() * 1000) - started_ms
    log_info(
        f"[version_engine][{op_type}] done commit={result.commit_id[:12]} "
        f"project={project_id} scope={scope_path!r} "
        f"changes={len(result.paths)} elapsed={elapsed}ms",
    )


def _record_pending_conflict_row(
    *,
    project_id: str,
    pending_conflict_id: str,
    scope_path: str,
    base_commit_id: str,
    current_commit_id: str,
    client_commit_id: str,
    proposed_tree_id: str,
    changed_paths: list[str],
    conflicts,
    policy: str,
    source_channel: str,
    actor: str,
    transaction_id: int | None = None,
) -> None:
    """Insert (or refresh) the structured pending-conflict row.

    Idempotent on ``pending_conflict_id`` so retried submissions that
    produce the same conflict do not error out. ``transaction_id`` is
    the FK back to the ``version_transactions`` row recorded for this
    pending state (B6).

    Also emits a ``pending_conflict_created`` outbox event (B13) so the
    hosted resolver agent worker can pick it up and propose a fix. The
    outbox row uses an empty ``commit_id`` because no commit has landed
    yet; the worker dispatches by ``event_type``, not by commit id.
    """

    from src.infra.supabase.client import SupabaseClient

    client = SupabaseClient().client
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
        "conflict_records": [conflict_to_dict(c) for c in (conflicts or [])],
        "policy": policy,
        "status": "pending",
        "resolver_actor": "",
        "resolver_kind": resolver_kind,
        "resolution_detail": {"actor": actor, "source_channel": source_channel},
    }
    if transaction_id is not None:
        payload["transaction_id"] = transaction_id
    client.table(CONFLICTS_TABLE).upsert(
        payload, on_conflict="pending_conflict_id",
    ).execute()

    # B13: enqueue a resolver-agent dispatch event. We do NOT block the
    # request on this — a failure to write the outbox row is downgraded
    # to a warning. The conflict is still resolvable via the HTTP API;
    # the outbox row is only the agent-loop optimisation.
    try:
        client.table(VERSION_OUTBOX_TABLE).insert({
            "project_id": project_id,
            "commit_id": "",  # no commit; non-null column needs empty string
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
        from src.utils.logger import log_warning
        log_warning(
            f"[version_engine] failed to enqueue pending_conflict_created "
            f"outbox for {pending_conflict_id[:12]}: {exc}",
        )


def _insert_version_transaction_row(
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
    """Insert a non-``committed`` version_transactions row from Python.

    The ``committed`` status is owned by the SQL scope-publish RPC
    RPC (atomic with the rest of the ledger). This helper covers the
    other terminal/transient states:

    * ``pending_manual_review`` / ``pending_agent_resolution`` — waiting
      for a resolver before any commit lands.
    * ``rejected`` — cross-scope guard fires, payload validation fails,
      conflict policy rejects, etc.
    * ``resolving`` — manual/agent resolver picked up a pending row.

    Returns the new row id, or ``None`` if the insert failed. Failures
    are logged by the caller; this helper does not retry. The audit
    ledger is still complete via ``audit_logs``, so a single missed
    version_transactions row degrades to V0 behavior, not data loss.
    """

    from src.infra.supabase.client import SupabaseClient

    client = SupabaseClient().client
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
    resp = client.table("version_transactions").insert(payload).execute()
    data = getattr(resp, "data", None) or []
    if data and isinstance(data[0], dict):
        return data[0].get("id")
    return None


def _resolver_kind_for(source_channel: str) -> str:
    if source_channel in {"agent", "sync"}:
        return "agent"
    return "human"


def _parent_scope_files(
    repo,
    scope_path: str,
    relative_paths: list[str],
) -> dict[str, bytes]:
    """Return files owned by the nearest ancestor scope for the given
    relative paths.

    Implements 07-version-engine-supplement.md §7.A "parent-scope-wins":
    when a child scope and its parent scope both claim a file, the
    parent content stays. The returned dict is keyed by the same
    relative path the incoming/current sets use, so the merge helper
    can do direct lookups.
    """

    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        # The root scope has no parent.
        return {}
    parents = list(_ancestor_scope_paths(repo, scope_norm))
    if not parents:
        return {}
    relevant: set[str] = set(relative_paths or [])
    if not relevant:
        return {}

    parent_files: dict[str, bytes] = {}
    for parent_scope in parents:
        try:
            parent_scope_hash, _ = _get_scope_state(repo, parent_scope)
        except Exception:
            parent_scope_hash = ""
        if not parent_scope_hash:
            continue
        # The parent's tree is rooted at the parent's scope path. The
        # child's relative paths must be prefixed by the path segment
        # between parent and child to land on the same blob.
        prefix = scope_norm[len(parent_scope):].lstrip("/") if parent_scope else scope_norm
        for rel in relevant:
            if rel in parent_files:
                continue
            lookup = f"{prefix}/{rel}" if prefix else rel
            blob_hash = _blob_hash_at_tree_path(repo, parent_scope_hash, lookup)
            if blob_hash:
                try:
                    parent_files[rel] = repo.store.get(blob_hash)
                except Exception:
                    continue
        if len(parent_files) == len(relevant):
            break
    return parent_files


def _ancestor_scope_paths(repo, scope_path: str) -> list[str]:
    """Return ancestor scope paths (nearest first) that the repo declares.

    Falls back to a structural walk if the repo cannot enumerate scopes,
    which keeps the merge path resilient against missing optional repo
    APIs (in-memory fakes, partial test fixtures, etc.).
    """

    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        return []
    declared: set[str] = set()
    try:
        all_scopes = repo.get_all_scope_hashes()
        declared = {normalize_path(p) for p in all_scopes.keys()}
    except Exception:
        declared = set()
    ancestors: list[str] = []
    parts = scope_norm.split("/")
    for i in range(len(parts) - 1, 0, -1):
        ancestor = "/".join(parts[:i])
        if not declared or ancestor in declared:
            ancestors.append(ancestor)
    # Always include the root scope last.
    if not declared or "" in declared:
        ancestors.append("")
    return ancestors


def _load_pending_conflict_row(project_id: str, pending_conflict_id: str) -> dict | None:
    from src.infra.supabase.client import SupabaseClient

    client = SupabaseClient().client
    resp = (
        client.table(CONFLICTS_TABLE)
        .select("*")
        .eq("project_id", project_id)
        .eq("pending_conflict_id", pending_conflict_id)
        .maybe_single()
        .execute()
    )
    return getattr(resp, "data", None)


def _mark_pending_conflict_row(
    *,
    project_id: str,
    pending_conflict_id: str,
    status: str,
    resolver_actor: str,
) -> None:
    from src.infra.supabase.client import SupabaseClient

    client = SupabaseClient().client
    client.table(CONFLICTS_TABLE).update({
        "status": status,
        "resolver_actor": resolver_actor or "",
    }).eq("project_id", project_id).eq(
        "pending_conflict_id", pending_conflict_id,
    ).execute()


def _close_pending_conflict_row(
    *,
    project_id: str,
    pending_conflict_id: str,
    status: str,
    resolver_actor: str,
    resolution_commit_id: str,
    resolution_detail: dict,
) -> None:
    from src.infra.supabase.client import SupabaseClient

    client = SupabaseClient().client
    client.table(CONFLICTS_TABLE).update({
        "status": status,
        "resolver_actor": resolver_actor or "",
        "resolution_commit_id": resolution_commit_id or "",
        "resolution_detail": resolution_detail,
        "resolved_at": _now_iso(),
    }).eq("project_id", project_id).eq(
        "pending_conflict_id", pending_conflict_id,
    ).execute()
