"""Repository facade facts for PuppyOne access surfaces.

PuppyOne exposes several repo-like entry points: project Git remotes,
Access Point Git remotes, and Access Point filesystem commands. Externally
each one behaves like a small repository with its own auth, scope, ref, and
CAS boundary. Internally those facades share the project's Git object store
and publish through the same Version Transaction Engine.

This module is the narrow translation boundary between auth dictionaries
and repo-shaped facts. Protocol adapters should consume ``RepoFacade``
instead of reaching into ``auth["_scope"]`` ad hoc.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.version_engine.application.path_utils import normalize_path


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


def repo_facade_from_auth(
    project_id: str,
    auth: dict,
    *,
    kind: str = "project_git_remote",
) -> RepoFacade:
    """Build the canonical repo facade from a resolved auth context."""

    scope = auth.get("_scope") or {}
    configured = auth.get("_repo_facade") or {}
    resolved_project_id = project_id or auth.get("_project_id") or ""

    scope_path = normalize_path(scope.get("path", ""))
    excludes = tuple(
        normalize_path(item)
        for item in (scope.get("exclude") or [])
        if item
    )
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
