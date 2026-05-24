"""Derived Git protocol cache maintenance.

The cache warmed here is not authoritative. It is a rebuildable protocol
workspace for stock Git upload/receive-pack, driven by committed Version
Engine facts.
"""

from __future__ import annotations

from src.version_engine.adapters.git.object_quarantine import warm_transport_bare_repo
from src.version_engine.adapters.git.view_cache import (
    GitViewCacheKey,
    invalidate_git_view_cache,
)


def warm_git_transport_view(
    repo,
    scope_path: str,
    scope_excludes: list[str] | None = None,
    *,
    follow_history: bool = False,
) -> str:
    """Advance one Git protocol view cache to its current canonical head."""

    return warm_transport_bare_repo(
        repo,
        scope_path,
        scope_excludes,
        follow_history=follow_history,
        include_blobs=True,
    )


def rebuild_git_transport_view(
    repo,
    *,
    scope_path: str,
    scope_excludes: list[str] | None = None,
    follow_history: bool = True,
    include_blobs: bool = True,
) -> dict:
    """Drop a Git view cache and rewarm from canonical Version Engine facts.

    The architecture doc promises "if the cache is missing or unhealthy,
    it can be rebuilt from committed Version Engine facts" — this
    function is that rebuild path. It composes:

      1. ``invalidate_git_view_cache``: wipe the on-disk per-view bare
         repo directory.
      2. ``warm_transport_bare_repo``: walk the committed object store
         and rehydrate the bare repo (refs + reachable objects).

    Callers (admin endpoints, repair workers) get back the new head
    plus the per-view cache key so they can confirm the rebuild landed
    on the expected view. Rebuilds BOTH cache variants by default
    (full history + receive boundary, with and without blobs) since
    cache identity is per-variant — if you don't rebuild the variant
    a future request will use, that variant stays cold.
    """
    key = GitViewCacheKey.from_repo(
        repo,
        scope_path,
        scope_excludes,
        follow_history=follow_history,
        include_blobs=include_blobs,
    )
    invalidate_git_view_cache(key)
    new_head = warm_transport_bare_repo(
        repo,
        scope_path,
        scope_excludes,
        follow_history=follow_history,
        include_blobs=include_blobs,
    )
    return {
        "view_id": key.view_id,
        "project_id": key.project_id,
        "scope_path": key.scope_path,
        "scope_excludes": list(key.scope_excludes),
        "history_mode": key.history_mode,
        "blob_mode": key.blob_mode,
        "head": new_head,
    }
