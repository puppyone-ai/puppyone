"""Business logic for repo_scopes.

Responsibilities the repository deliberately does NOT have:
  - access_key minting (canonical format: cli_<urlsafe-32>)
  - root-scope protection (is_root rows are not user-deletable)
  - path canonicalization (mirror mut_scope_state.scope_path rules)
  - duplicate-scope rejection
  - bound-connector check on delete
  - auto-suggest from existing folder tree
"""

from __future__ import annotations

import secrets
from typing import Optional

from src.exceptions import AppException
from src.repo.models import RepoScope
from src.repo.scope_repository import RepoScopeRepository
from src.utils.logger import log_info, log_warning


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _canonicalize_path(p: str) -> str:
    """Mirror canonical form used by mut_scope_state.scope_path and the
    repo_scopes_path_canonical CHECK constraint:
      - empty string '' for root
      - no leading or trailing /
      - no // anywhere
    """
    if p is None:
        return ""
    s = p.strip()
    while s.startswith("/"):
        s = s[1:]
    while s.endswith("/"):
        s = s[:-1]
    while "//" in s:
        s = s.replace("//", "/")
    return s


def _mint_access_key() -> str:
    """Same shape as the legacy access_points.access_key for filesystem rows
    so old `mut connect` clients keep parsing the URL the same way."""
    return f"cli_{secrets.token_urlsafe(32)}"


# ──────────────────────────────────────────────────────────────────────────
# Service
# ──────────────────────────────────────────────────────────────────────────

class ScopeService:
    def __init__(self, repository: Optional[RepoScopeRepository] = None):
        self._repo = repository or RepoScopeRepository()

    # ── Reads ────────────────────────────────────────────────────────────

    def list_for_project(self, project_id: str) -> list[RepoScope]:
        return self._repo.list_by_project(project_id)

    def get(self, scope_id: str) -> Optional[RepoScope]:
        return self._repo.get(scope_id)

    def get_root(self, project_id: str) -> Optional[RepoScope]:
        return self._repo.get_root_scope(project_id)

    def resolve_for_request(
        self, project_id: str, *, scope_id: Optional[str], request_path: Optional[str],
    ) -> Optional[RepoScope]:
        """Used by mut_engine auth: resolve the scope a request operates on.

        Priority:
          1. Explicit scope_id query param.
          2. Path-prefix inference (longest matching path in project).
          3. Root scope.
          4. None (caller decides whether to error).
        """
        if scope_id:
            scope = self._repo.get(scope_id)
            if scope and scope.project_id == project_id:
                return scope
            return None
        if request_path:
            inferred = self._repo.find_by_path_prefix(project_id, request_path)
            if inferred is not None:
                return inferred
        return self._repo.get_root_scope(project_id)

    # ── Writes ───────────────────────────────────────────────────────────

    def create(
        self,
        *,
        project_id: str,
        name: str,
        path: str,
        exclude: Optional[list[str]] = None,
        mode: str = "rw",
    ) -> RepoScope:
        canonical = _canonicalize_path(path)

        # Don't let the user create another root via this path.
        # Root scopes only come from the project-create flow / backfill migration.
        if canonical == "":
            existing_root = self._repo.get_root_scope(project_id)
            if existing_root:
                raise AppException(
                    status_code=409,
                    message=(
                        "Project already has a root scope. The root scope "
                        "is auto-created and cannot be re-created."
                    ),
                )

        return self._repo.insert(
            project_id=project_id,
            name=name,
            path=canonical,
            exclude=list(exclude or []),
            mode=mode,
            is_root=False,
            access_key=_mint_access_key(),
        )

    def ensure_root_scope(self, project_id: str) -> RepoScope:
        """Idempotent: returns the existing root scope, or creates one if
        the project doesn't have one yet (defensive — the backfill migration
        should have covered every existing project, but new projects need
        this called from project creation)."""
        existing = self._repo.get_root_scope(project_id)
        if existing:
            return existing
        log_info(f"[scope] auto-creating root scope for project={project_id}")
        return self._repo.insert(
            project_id=project_id,
            name="Root",
            path="",
            exclude=[],
            mode="rw",
            is_root=True,
            access_key=_mint_access_key(),
        )

    def update(
        self,
        scope_id: str,
        *,
        name: Optional[str] = None,
        exclude: Optional[list[str]] = None,
        mode: Optional[str] = None,
    ) -> Optional[RepoScope]:
        # `path` is intentionally not in the update signature — renaming a
        # scope's path means deleting + recreating, by design.
        return self._repo.update(scope_id, name=name, exclude=exclude, mode=mode)

    def regenerate_access_key(self, scope_id: str) -> Optional[str]:
        new_key = _mint_access_key()
        ok = self._repo.regenerate_access_key(scope_id, new_key)
        return new_key if ok else None

    def delete(
        self, scope_id: str, *, has_bound_connectors: Optional[bool] = None,
    ) -> None:
        """Delete a non-root scope.

        has_bound_connectors: if True, raises 409 with a "delete connectors first"
            hint. Caller passes the result of querying the connectors table —
            we don't query it here to keep the service module decoupled from
            connectors.
        """
        scope = self._repo.get(scope_id)
        if scope is None:
            raise AppException(status_code=404, message="Scope not found")
        if scope.is_root:
            raise AppException(status_code=400, message="Root scope cannot be deleted")
        if has_bound_connectors:
            raise AppException(
                status_code=409,
                message=(
                    "Scope has connectors bound to it. Delete those connectors "
                    "first, or use force-delete to remove them."
                ),
            )
        self._repo.delete(scope_id)

    # ── Auto-suggest ─────────────────────────────────────────────────────

    def auto_suggest_from_tree(
        self, project_id: str, top_level_folders: list[str],
    ) -> list[dict]:
        """Given the project's top-level folder names, propose new scopes
        for each folder NOT already covered by an existing scope.

        Returns a list of ScopeIn-shaped dicts. The router converts to
        Pydantic; we keep this layer plain for testability.
        """
        existing = {s.path for s in self._repo.list_by_project(project_id)}
        suggestions: list[dict] = []
        for folder in top_level_folders:
            canonical = _canonicalize_path(folder)
            if canonical in existing:
                continue
            suggestions.append({
                "name": _humanize(canonical) or "Folder",
                "path": canonical,
                "exclude": [],
                "mode": "rw",
            })
        return suggestions


def _humanize(path: str) -> str:
    """Turn 'src/handbook' → 'Src / Handbook'. Best-effort; user can rename."""
    if not path:
        return ""
    parts = [p.replace("_", " ").replace("-", " ").strip().title() for p in path.split("/")]
    return " / ".join(parts)
