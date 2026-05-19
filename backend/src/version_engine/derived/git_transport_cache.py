"""Derived Git protocol cache maintenance.

The cache warmed here is not authoritative. It is a rebuildable protocol
workspace for stock Git upload/receive-pack, driven by committed Version
Engine facts.
"""

from __future__ import annotations

from src.version_engine.adapters.git.object_quarantine import warm_transport_bare_repo


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
        include_blobs=follow_history,
    )
