"""Git commit selection for submitted trees.

Git pushes may bring a client-created commit object. L5 can preserve that
commit only when it is compatible with the accepted tree and parent shape;
otherwise it synthesizes a server commit with PuppyOne provenance trailers.
"""

from __future__ import annotations

from typing import Any

from src.version_engine.domain.intents import VersionSubmissionIntent
from src.version_engine.write_engine.git_commit import (
    build_git_commit,
    commit_tree_id,
    git_compatibility_error,
    shallow_git_parent_or_empty,
)
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.scope_view import (
    commit_exists,
    git_safe_parent,
)
from src.utils.logger import log_warning


def select_or_create_commit(
    *,
    repo: Any,
    intent: VersionSubmissionIntent,
    tree_id: str,
    parent_id: str,
    created_at_iso: str,
    preserve_client: bool,
) -> str:
    if preserve_client and intent.client_commit_id:
        try:
            if (
                commit_exists(repo, intent.client_commit_id)
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
    trailers = {
        "PuppyOne-Source": intent.source_channel,
        "PuppyOne-Scope": normalize_path(intent.scope_path) or "/",
        "PuppyOne-Original-Commit": intent.client_commit_id or "",
        "PuppyOne-Base-Commit": intent.base_commit_id or "",
    }
    return build_git_commit(
        repo,
        tree_sha=tree_id,
        parent_sha=git_safe_parent(repo, parent_id),
        who=intent.actor,
        message=intent.message,
        created_at_iso=created_at_iso,
        trailers=trailers,
        validate_parent_graph=False,
    )
