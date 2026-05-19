"""Domain models for the repo redesign — pure dataclasses, no DB knowledge.

Repository implementations (scope_repository, connector_repository, …) own
the row ↔ model translation. Routers/services consume these models without
caring whether they came from Supabase, an in-memory store, or a test stub.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


# ──────────────────────────────────────────────────────────────────────────
# Scope
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class RepoScope:
    """A subtree of a repo. Owns its own access_key (the scope credential
    for paths that fall under this scope)."""

    id: str
    project_id: str
    name: str
    path: str                       # canonical: '' for root, no leading/trailing /
    exclude: list[str]
    mode: str                       # 'r' | 'rw'
    is_root: bool
    access_key: str
    access_key_revoked_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


# ──────────────────────────────────────────────────────────────────────────
# Connector
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class Connector:
    """A data-flow channel bound to a scope. Built-in cli/agent rows are
    auto-created by the DB trigger when a scope is INSERTed; third-party
    rows (notion/gmail/…) are user-created."""

    id: str
    project_id: str
    scope_id: str
    provider: str                   # 'cli', 'agent', 'notion', 'gmail', ...
    name: str
    direction: str                  # 'bidirectional' | 'inbound' | 'outbound'
    config: dict[str, Any]          # provider-specific
    oauth_connection_id: Optional[int]   # FK → oauth_connections.id (BIGINT)
    trigger: dict[str, Any]         # {"type": "manual" | "scheduled" | "on_change", ...}
    status: str                     # 'active' | 'paused' | 'syncing' | 'error'
    last_run_at: Optional[datetime]
    last_run_id: Optional[str]
    error_message: Optional[str]
    created_by: Optional[str]
    created_at: datetime
    updated_at: datetime

    @property
    def is_builtin(self) -> bool:
        # Built-in connectors are auto-created by the DB trigger on every
        # repo_scopes INSERT (see migrations/…_connectors_table.sql + the
        # filesystem-builtin migration). They are protected from deletion
        # via the API — users can pause/resume but not destroy them, since
        # their lifecycle is tied to the scope itself.
        return self.provider in ("cli", "agent", "filesystem")

    @property
    def is_oauth_backed(self) -> bool:
        # Self-auth providers (raw URL, REST API with API key in config) carry
        # NULL oauth_connection_id; OAuth-backed providers carry a non-NULL one.
        return self.oauth_connection_id is not None


# ──────────────────────────────────────────────────────────────────────────
# Per-user-per-repo permissions (team plans)
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class RepoUserPermission:
    id: str
    project_id: str
    user_id: str
    role: str                       # 'admin' | 'editor' | 'reader' | 'denied'
    allowed_scope_ids: Optional[list[str]]   # None means "all scopes"
    granted_by: Optional[str]
    granted_at: datetime


@dataclass(frozen=True)
class ResolvedPermission:
    """The result of permission resolution for a (user, project) pair.

    Constructed by PermissionService.resolve(). Encodes both the source
    of truth (explicit row vs implicit org_member fallback) and the
    effective access decision so the caller can render meaningful
    UI ("Inherited from org member") and log denial reasons.
    """

    role: str                       # 'admin' | 'editor' | 'reader' | 'denied'
    source: str                     # 'explicit' | 'inherited_org' | 'no_org_member'
    allowed_scope_ids: Optional[list[str]]   # None means "all scopes"

    @property
    def can_read(self) -> bool:
        return self.role in ("admin", "editor", "reader")

    @property
    def can_write(self) -> bool:
        return self.role in ("admin", "editor")

    @property
    def can_admin(self) -> bool:
        return self.role == "admin"

    def covers_scope(self, scope_id: str) -> bool:
        """Whether this permission applies to the given scope_id."""
        if self.role == "denied":
            return False
        if self.allowed_scope_ids is None:
            return True
        return scope_id in self.allowed_scope_ids
