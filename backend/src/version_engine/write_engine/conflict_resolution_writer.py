"""Pending-conflict resolution flow for L5."""

from __future__ import annotations

import asyncio
import time

from src.version_engine.domain.intents import (
    ConflictResolutionIntent,
    TransactionResult,
    VersionSubmissionIntent,
)
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.submission_writer import SubmissionWriter
from src.version_engine.write_engine.tree_objects import build_tree_from_files
from src.utils.logger import log_info, log_warning


class ConflictResolutionWriter:
    """Resolve pending rows by re-entering the submission pipeline."""

    def __init__(
        self,
        repo_manager: VersionRepoManager,
        ledger,
        submission_writer: SubmissionWriter,
    ):
        self._repos = repo_manager
        self._ledger = ledger
        self._submission_writer = submission_writer

    async def resolve(
        self,
        intent: ConflictResolutionIntent,
    ) -> TransactionResult:
        """Apply a manual or hosted-agent resolution to a pending conflict."""

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
        result = await self._submission_writer.submit_version_root_first(
            submission, started_ms,
        )

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
