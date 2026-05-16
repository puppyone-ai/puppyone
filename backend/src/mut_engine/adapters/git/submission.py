"""Git-native submission helpers.

The smart-HTTP pack parser will eventually call this module after it
quarantines incoming objects and resolves the pushed ref update. Tests can
also use this directly to exercise Git object semantics without going
through legacy MUT wire payloads.
"""

from __future__ import annotations

from typing import Callable

from src.mut_engine.application.transaction_engine import GitNativeTransactionEngine
from src.mut_engine.domain.intents import TransactionResult, VersionSubmissionIntent
from src.mut_engine.server.repo_manager import MutRepoManager


async def submit_git_tree(
    repo_manager: MutRepoManager,
    *,
    project_id: str,
    scope_path: str,
    scope_excludes: list[str] | None = None,
    actor: str,
    base_commit_id: str,
    proposed_tree_id: str,
    client_commit_id: str,
    message: str,
    proposed_files: dict[str, bytes] | None = None,
    promote_objects: Callable[[], None] | None = None,
    defer_projection: bool = False,
    audit_detail: dict | None = None,
) -> TransactionResult:
    """Submit a Git commit/tree to the Git-native transaction engine."""

    engine = GitNativeTransactionEngine(repo_manager)
    return await engine.submit_version(
        VersionSubmissionIntent(
            project_id=project_id,
            scope_path=scope_path,
            actor=actor,
            source_channel="git",
            base_commit_id=base_commit_id,
            proposed_tree_id=proposed_tree_id,
            client_commit_id=client_commit_id,
            message=message,
            scope_excludes=scope_excludes or [],
            proposed_files=proposed_files,
            promote_objects=promote_objects,
            defer_projection=defer_projection,
            audit_detail=audit_detail or {},
        )
    )
