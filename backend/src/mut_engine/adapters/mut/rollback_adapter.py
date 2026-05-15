"""Translate legacy MUT rollback payloads into engine rollback intents."""

from __future__ import annotations

from mut.core.protocol import RollbackRequest, RollbackResponse, normalize_path, require_supported_protocol
from mut.foundation.error import PermissionDenied

from src.mut_engine.application.transaction_engine import GitNativeTransactionEngine
from src.mut_engine.domain.intents import RollbackIntent
from src.mut_engine.server.repo_manager import MutRepoManager


async def submit_mut_rollback(
    repo_manager: MutRepoManager,
    project_id: str,
    auth: dict,
    body: dict,
) -> dict:
    """Handle a legacy MUT rollback through the Git-native transaction engine."""

    require_supported_protocol(body)
    scope = auth["_scope"]
    if scope.get("mode", "r") == "r":
        raise PermissionDenied("scope is read-only")

    req = RollbackRequest.from_dict(body)
    scope_path = normalize_path(scope.get("path", ""))
    engine = GitNativeTransactionEngine(repo_manager)
    result = await engine.rollback(
        RollbackIntent(
            project_id=project_id,
            scope_path=scope_path,
            actor=auth["agent"],
            source_channel="mut",
            target_commit_id=req.target_commit_id,
            message=f"rollback to #{req.target_commit_id}",
            scope_excludes=scope.get("exclude") or [],
        )
    )

    return RollbackResponse(
        status=result.status,
        new_commit_id=result.commit_id,
        target_commit_id=req.target_commit_id,
        root=result.new_scope_hash,
        changes=result.changes,
    ).to_dict()
