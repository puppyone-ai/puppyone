"""L5 helpers for scope-view commit materialization.

Canonical writes publish project-root commits. Scoped connectors still need a
Git-shaped scope head for clone/pull UX, so that projection-specific commit
creation lives here instead of in the main engine facade.
"""

from __future__ import annotations

from src.version_engine.write_engine.git_commit import (
    build_git_commit,
    shallow_git_parent_or_empty,
)
from src.version_engine.write_engine.path_utils import normalize_path


def commit_exists(repo, commit_id: str) -> bool:
    return bool(commit_id) and repo.store.exists(commit_id)


def git_safe_parent(repo, commit_id: str) -> str:
    return shallow_git_parent_or_empty(repo, commit_id)


def build_scope_view_commit(
    repo,
    *,
    scope_path: str,
    scope_hash: str,
    parent_id: str,
    actor: str,
    message: str,
    created_at_iso: str,
    source_channel: str,
    original_commit_id: str = "",
    base_commit_id: str = "",
) -> str:
    scope_norm = normalize_path(scope_path)
    if not scope_norm or not scope_hash:
        return ""
    return build_git_commit(
        repo,
        tree_sha=scope_hash,
        parent_sha=git_safe_parent(repo, parent_id),
        who=actor,
        message=message,
        created_at_iso=created_at_iso,
        trailers={
            "PuppyOne-Source": source_channel,
            "PuppyOne-Scope": scope_norm,
            "PuppyOne-Original-Commit": original_commit_id,
            "PuppyOne-Base-Commit": base_commit_id,
        },
        validate_parent_graph=False,
    )
