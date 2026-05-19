"""Git-native submission helpers.

The smart-HTTP pack parser will eventually call this module after it
quarantines incoming objects and resolves the pushed ref update. Tests can
also use this directly to exercise Git object semantics without going
through any non-Git wire payloads.
"""

from __future__ import annotations

from typing import Callable

from src.version_engine.write_engine.engine import VersionWriteEngine
from src.version_engine.domain.intents import TransactionResult, VersionSubmissionIntent
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager


async def submit_git_tree(
    repo_manager: VersionRepoManager,
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
    changed_paths: list[str] | None = None,
    promote_objects: Callable[[], None] | None = None,
    defer_projection: bool = False,
    audit_detail: dict | None = None,
) -> TransactionResult:
    """Submit a Git commit/tree to the Write Engine."""

    engine = VersionWriteEngine(repo_manager)
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
            changed_paths=changed_paths or [],
            promote_objects=promote_objects,
            defer_projection=defer_projection,
            audit_detail=audit_detail or {},
        )
    )
