"""Git view health DTOs for Access Point and project remotes."""

from __future__ import annotations

from src.version_engine.adapters.git.view_projection import (
    GitViewHead,
    resolve_git_view_head,
)


def git_view_health_payload(
    repo,
    *,
    project_id: str,
    scope_path: str,
    scope_excludes: list[str] | None,
    read_only: bool = False,
) -> dict:
    """Return product-facing health for one Git-visible view."""

    view = resolve_git_view_head(repo, scope_path, scope_excludes)
    usable = view.health != "current_corrupt"
    return {
        "project_id": project_id,
        "scope_path": scope_path or "",
        "scope_excludes": list(scope_excludes or []),
        "health": view.health,
        "git_head": view.head,
        "canonical_head": view.canonical_head,
        "history_cut": view.history_cut,
        "git_usable": usable,
        "clone_usable": usable,
        "fetch_usable": usable,
        "push_usable": usable and not read_only,
        "read_only": read_only,
        "reason": _health_reason(view),
        "recommended_actions": _recommended_actions(view),
    }


def _health_reason(view: GitViewHead) -> str:
    if view.reason:
        return view.reason
    if view.health == "empty":
        return "Git view has no commits yet"
    if view.health == "healthy":
        return "Git view is healthy"
    if view.health == "history_degraded":
        return "Git history was truncated at a damaged legacy boundary"
    return "Current Git view is corrupt"


def _recommended_actions(view: GitViewHead) -> list[dict[str, str]]:
    if view.health == "current_corrupt":
        return [
            {
                "type": "restore_version",
                "label": "Restore a healthy version",
            },
            {
                "type": "repair_storage",
                "label": "Repair missing or damaged current objects",
            },
        ]
    if view.health == "history_degraded":
        return [
            {
                "type": "continue",
                "label": "Continue with truncated Git history",
            },
            {
                "type": "repair_history",
                "label": "Repair legacy history objects",
            },
        ]
    return []
