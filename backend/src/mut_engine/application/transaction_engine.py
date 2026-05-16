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

from src.mut_engine.application.object_store import ObjectStore
from src.mut_engine.application.path_utils import normalize_path

from src.mut_engine.application.conflict_policy import (
    conflict_to_dict,
    merge_file_sets_for_policy,
    select_conflict_policy,
)
from src.mut_engine.application.git_commit import (
    build_git_commit,
    commit_tree_id,
    git_compatibility_error,
    is_git_compatible_commit,
)
from src.mut_engine.application.path_utils import normalize_path
from src.mut_engine.application.tree_objects import (
    build_full_changes,
    build_tree_from_files,
    compute_changeset,
    flatten_tree_to_bytes,
    validate_scope_bound_files,
)
from src.mut_engine.adapters.git.view_projection import git_compatible_head_commit
from src.mut_engine.domain.intents import (
    ConflictResolutionIntent,
    OperationWriteIntent,
    RollbackIntent,
    TransactionResult,
    VersionSubmissionIntent,
)
from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.server.backends.s3_storage import stage_object_writes
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

    def __init__(self, repo_manager: MutRepoManager):
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

    async def submit_version(
        self,
        intent: VersionSubmissionIntent,
    ) -> TransactionResult:
        """Apply a Git/MUT proposed tree via optimistic server-side decision."""

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

        Reads the ``mut_conflicts`` row, materializes the resolution tree,
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

        try:
            await asyncio.to_thread(
                _close_pending_conflict_row,
                project_id=intent.project_id,
                pending_conflict_id=intent.pending_conflict_id,
                status="resolved",
                resolver_actor=intent.resolver_actor,
                resolution_commit_id=result.commit_id,
                resolution_detail={
                    "decision": "accept",
                    "message": intent.resolution_message,
                },
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

            with stage_object_writes(repo.store) as object_batch:
                new_scope_hash, changes = await asyncio.to_thread(
                    splice, repo.store, old_scope_hash,
                )

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
                )

                if object_batch is not None:
                    await asyncio.to_thread(object_batch.flush)

            full_changes = build_full_changes(scope_norm, changes)
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
                audit_detail=intent.audit_detail,
                changes=full_changes,
                conflicts=None,
                created_at_iso=created_at_iso,
                cas_attempt=attempt + 1,
                merged=False,
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

    async def _submit_version_optimistic(
        self,
        intent: VersionSubmissionIntent,
        started_ms: int,
    ) -> TransactionResult:
        repo = self._repos.get_server_repo(intent.project_id)
        scope_norm = normalize_path(intent.scope_path)

        if intent.proposed_files is not None:
            incoming_files = dict(intent.proposed_files)
        else:
            incoming_files = await asyncio.to_thread(
                flatten_tree_to_bytes, repo.store, intent.proposed_tree_id,
            )

        last_error: Exception | None = None
        for attempt in range(_MAX_CAS_ATTEMPTS):
            promoted_objects = False
            old_scope_hash, current_head_commit_id = _get_scope_state(repo, scope_norm)
            current_files = await asyncio.to_thread(
                _scope_files_for_head, repo, scope_norm, old_scope_hash,
            )
            rejected = validate_scope_bound_files(
                repo,
                scope_norm,
                _changed_relative_paths(current_files, incoming_files),
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
                raise CrossScopeSubmissionError(
                    scope_path=scope_norm,
                    rejected_paths=rejected,
                )

            if intent.base_commit_id == current_head_commit_id:
                new_scope_hash = intent.proposed_tree_id
                merged_files = incoming_files
                conflicts = []
                merged_changes: list[dict] = []
                changes = compute_changeset(scope_norm, current_files, merged_files)
                if intent.promote_objects is not None:
                    await asyncio.to_thread(intent.promote_objects)
                    promoted_objects = True
                commit_id = self._select_or_create_commit(
                    repo=repo,
                    intent=intent,
                    tree_id=new_scope_hash,
                    parent_id=current_head_commit_id,
                    created_at_iso=_now_iso(),
                    preserve_client=True,
                )
            else:
                base_files = await asyncio.to_thread(
                    _files_at_commit, repo, scope_norm, intent.base_commit_id,
                )
                policy = select_conflict_policy(
                    scope_path=scope_norm,
                    source_channel=intent.source_channel,
                    actor=intent.actor,
                    paths=list(incoming_files.keys()),
                )
                parent_scope_files = await asyncio.to_thread(
                    _parent_scope_files,
                    repo, scope_norm, list(incoming_files.keys()),
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
                op_type=(
                    "rollback"
                    if intent.source_channel == "mut"
                    else f"{intent.source_channel}_rollback"
                ),
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
            "rollback_error"
            if intent.source_channel == "mut"
            else f"{intent.source_channel}_rollback_error",
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
        paths = sorted({
            getattr(conflict, "path", "")
            for conflict in manual_conflicts
            if getattr(conflict, "path", "")
        })
        pending_conflict_id = _pending_conflict_id(
            intent.project_id,
            scope_path,
            current_head_commit_id,
            intent.client_commit_id,
            paths,
        )
        audit = {
            "status": "pending_manual_review",
            "pending_conflict_id": pending_conflict_id,
            "policy": "manual_review",
            "policy_reason": policy_reason,
            "scope": scope_path,
            "base_commit_id": intent.base_commit_id,
            "current_head_commit_id": current_head_commit_id,
            "client_commit_id": intent.client_commit_id,
            "proposed_tree_id": intent.proposed_tree_id,
            "current_scope_hash": current_scope_hash,
            "conflict_count": len(manual_conflicts),
            "conflicts": [conflict_to_dict(conflict) for conflict in manual_conflicts],
            "base_paths": sorted(base_files),
            "current_paths": sorted(current_files),
            "incoming_paths": sorted(incoming_files),
            **(intent.audit_detail or {}),
        }
        await asyncio.to_thread(
            repo.record_audit,
            f"{intent.source_channel}_push_conflict_pending",
            intent.actor,
            audit,
        )
        try:
            await asyncio.to_thread(
                _record_pending_conflict_row,
                project_id=intent.project_id,
                pending_conflict_id=pending_conflict_id,
                scope_path=scope_path,
                base_commit_id=intent.base_commit_id,
                current_commit_id=current_head_commit_id,
                client_commit_id=intent.client_commit_id,
                proposed_tree_id=intent.proposed_tree_id,
                changed_paths=paths,
                conflicts=manual_conflicts,
                policy="manual_review",
                source_channel=intent.source_channel,
                actor=intent.actor,
            )
        except Exception as exc:
            log_warning(
                f"[version_engine] failed to persist mut_conflicts row "
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
                    and is_git_compatible_commit(repo, intent.client_commit_id)
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
            from src.mut_engine.services.hooks import (
                run_post_push_hook,
                schedule_post_push_hook,
            )
            from src.mut_engine.services.version_outbox import (
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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _commit_exists(repo, commit_id: str) -> bool:
    return bool(commit_id) and repo.store.exists(commit_id)


def _git_safe_parent(repo, commit_id: str) -> str:
    if not commit_id:
        return ""
    if is_git_compatible_commit(repo, commit_id):
        return commit_id
    return git_compatible_head_commit(repo, commit_id)


def _get_scope_state(repo, scope_path: str) -> tuple[str, str]:
    get_state = getattr(repo, "get_scope_state", None)
    if callable(get_state):
        scope_hash, head_commit_id = get_state(scope_path)
        return scope_hash or "", head_commit_id or ""
    return (
        repo.get_scope_hash(scope_path) or "",
        repo.get_scope_head_commit_id(scope_path) or "",
    )


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


def _files_at_commit(repo, scope_path: str, commit_id: str) -> dict[str, bytes]:
    if not commit_id:
        return {}
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
        from src.mut_engine.application import tree as tree_mod

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
) -> None:
    """Insert (or refresh) the structured pending-conflict row.

    Idempotent on ``pending_conflict_id`` so retried submissions that
    produce the same conflict do not error out. Failures are logged by
    the caller; this function does not retry.
    """

    from src.infra.supabase.client import SupabaseClient

    client = SupabaseClient().client
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
        "resolver_kind": _resolver_kind_for(source_channel),
        "resolution_detail": {"actor": actor, "source_channel": source_channel},
    }
    client.table("mut_conflicts").upsert(
        payload, on_conflict="pending_conflict_id",
    ).execute()


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
        try:
            files = flatten_tree_to_bytes(repo.store, parent_scope_hash)
        except Exception:
            continue
        # The parent's tree is rooted at the parent's scope path. The
        # child's relative paths must be prefixed by the path segment
        # between parent and child to land on the same blob.
        prefix = scope_norm[len(parent_scope):].lstrip("/") if parent_scope else scope_norm
        for rel in relevant:
            if rel in parent_files:
                continue
            lookup = f"{prefix}/{rel}" if prefix else rel
            if lookup in files:
                parent_files[rel] = files[lookup]
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
        client.table("mut_conflicts")
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
    client.table("mut_conflicts").update({
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
    client.table("mut_conflicts").update({
        "status": status,
        "resolver_actor": resolver_actor or "",
        "resolution_commit_id": resolution_commit_id or "",
        "resolution_detail": resolution_detail,
        "resolved_at": _now_iso(),
    }).eq("project_id", project_id).eq(
        "pending_conflict_id", pending_conflict_id,
    ).execute()
