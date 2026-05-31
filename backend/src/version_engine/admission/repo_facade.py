"""Repository facade facts for PuppyOne access surfaces.

PuppyOne exposes several repo-like entry points: project Git remotes,
Access Point Git remotes, and Access Point filesystem commands. Externally
each one behaves like a small repository with its own auth, scope, ref, and
CAS boundary. Internally those facades share the project's Git object store
and publish through the same Write Engine.

This module is the narrow translation boundary between auth dictionaries
and repo-shaped facts. Protocol adapters should consume ``RepoFacade``
instead of reaching into ``auth["_scope"]`` ad hoc.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from src.version_engine.write_engine.path_utils import normalize_path
from src.utils.logger import log_warning

if TYPE_CHECKING:
    from src.version_engine.infrastructure.supabase.scope_manager import ScopeBackend


_WRITE_MODES = frozenset({"rw", "write", "w"})


@dataclass(frozen=True)
class RepoFacade:
    """A repo-shaped view over a project-shared object store."""

    project_id: str
    repo_id: str
    kind: str
    scope_path: str
    excludes: tuple[str, ...]
    mode: str
    ref: str = "refs/heads/main"
    object_store_scope: str = "project-shared"

    @property
    def read_only(self) -> bool:
        return self.mode not in _WRITE_MODES

    def audit_detail(self) -> dict:
        return {
            "repo_id": self.repo_id,
            "repo_kind": self.kind,
            "repo_ref": self.ref,
            "object_store_scope": self.object_store_scope,
            "scope": self.scope_path,
        }


def compute_carved_excludes(
    scope_path: str,
    all_scopes: list[dict],
) -> tuple[str, ...]:
    """Compute the set of child-scope paths that must be hidden from a parent scope.

    The V2 Star architecture requires that when scope A has sub-scopes B and C
    (at paths ``A/B`` and ``A/C``), the parent-scope view auto-excludes ``A/B``
    and ``A/C`` so:
    - A parent Git push cannot accidentally write into a child scope's territory.
    - A parent filesystem view does not show content owned by a child scope.

    This is GAP-4 in the architecture gap analysis: without these auto-excludes
    the admission layer only enforces user-configured ``exclude`` lists, leaving
    cross-scope boundary violations silently allowed.

    Args:
        scope_path: The normalized path of the current scope ("" = root scope).
        all_scopes: All scopes for this project, each with at least {"path": str}.

    Returns:
        A tuple of normalized child-scope path strings to add as exclusions.
    """
    clean = scope_path.strip("/")
    prefix = (clean + "/") if clean else ""
    carved: list[str] = []
    for s in all_scopes:
        child_path = normalize_path(s.get("path", ""))
        if not child_path:
            continue
        # Root scope (prefix="") hides every non-root scope.
        # Non-root scope hides descendants whose path starts with "scope_path/".
        if not prefix or child_path.startswith(prefix):
            carved.append(child_path)
    return tuple(sorted(set(carved)))


def repo_facade_from_auth(
    project_id: str,
    auth: dict,
    *,
    kind: str = "project_git_remote",
    scope_backend: "ScopeBackend | None" = None,
) -> RepoFacade:
    """Build the canonical repo facade from a resolved auth context.

    When ``scope_backend`` is supplied, auto-computes ``carved_excludes`` —
    the child-scope paths that must be hidden from this scope's view. This
    enforces the nested-scope isolation contract described in
    ``01-version-engine.md`` §"嵌套 Scope 拓扑":

        父 Scope 看不到 /A/C/*（已声明的子 scope 在父视图里自动隐藏）

    Without ``scope_backend`` the behaviour is unchanged (only user-configured
    ``exclude`` entries are honoured), which preserves backwards-compat for
    callers that don't have a DB connection at facade-build time.
    """

    scope = auth.get("_scope") or {}
    configured = auth.get("_repo_facade") or {}
    resolved_project_id = project_id or auth.get("_project_id") or ""

    scope_path = normalize_path(scope.get("path", ""))
    user_excludes = tuple(
        normalize_path(item)
        for item in (scope.get("exclude") or [])
        if item
    )

    # Compute carved_excludes: auto-hide child scopes from this scope's view.
    carved: tuple[str, ...] = ()
    if scope_backend is not None:
        try:
            all_scopes = scope_backend.list_all()
            carved = compute_carved_excludes(scope_path, all_scopes)
        except Exception as exc:  # noqa: BLE001 — admission must not crash on DB hiccup
            log_warning(
                f"[RepoFacade] carved_excludes lookup failed for "
                f"project={resolved_project_id} scope={scope_path!r}: {exc}; "
                f"falling back to user-configured excludes only"
            )

    # Merge user-configured and auto-carved excludes (dedup, stable order).
    excludes = tuple(dict.fromkeys(user_excludes + carved))

    mode = str(scope.get("mode", "rw")).lower()
    repo_kind = str(configured.get("kind") or kind)
    repo_id = str(
        configured.get("id")
        or scope.get("id")
        or auth.get("agent")
        or f"{resolved_project_id}:{scope_path or 'root'}"
    )
    ref = str(configured.get("ref") or "refs/heads/main")
    object_store_scope = str(configured.get("object_store_scope") or "project-shared")

    return RepoFacade(
        project_id=str(resolved_project_id),
        repo_id=repo_id,
        kind=repo_kind,
        scope_path=scope_path,
        excludes=excludes,
        mode=mode,
        ref=ref,
        object_store_scope=object_store_scope,
    )
