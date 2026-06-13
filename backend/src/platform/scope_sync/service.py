"""Server-side resolution of the managed sync policy (#M5).

Users don't configure triggers; the server resolves a preset for a
(scope-role × persona × client-kind) and hands it to the sidecar + frontend.
Scope role is derived from the scope (root vs sub). Persona/client default
sensibly and can be overridden by the caller (later: persisted project setting).
"""

from __future__ import annotations

from dataclasses import asdict

from src.platform.scope_sync.policy import (
    ClientKind,
    Persona,
    ScopeRole,
    policy_for,
)


def _parse_persona(value: str | None) -> Persona:
    try:
        return Persona(value) if value else Persona.DEV
    except ValueError:
        return Persona.DEV


def _parse_client(value: str | None) -> ClientKind:
    try:
        return ClientKind(value) if value else ClientKind.UNKNOWN
    except ValueError:
        return ClientKind.UNKNOWN


def _scope_service():
    from src.repo.scope_service import ScopeService
    return ScopeService()


class ScopeSyncService:
    """Resolves the managed :class:`SyncPolicyConfig` for a scope. Injectable
    scope lookup keeps it unit-testable without a DB."""

    def __init__(self, *, scope_lookup=None) -> None:
        self._scope_lookup = scope_lookup or (lambda sid: _scope_service().get(sid))

    def _scope_role(self, project_id: str, scope_id: str) -> ScopeRole:
        scope = self._scope_lookup(scope_id)
        if scope is None or getattr(scope, "project_id", None) != project_id:
            raise LookupError("scope not found in project")
        is_root = getattr(scope, "is_root", None)
        if is_root is None:
            is_root = (getattr(scope, "path", "") or "") == ""
        return ScopeRole.ROOT if is_root else ScopeRole.SUB

    def resolve_policy(
        self,
        *,
        project_id: str,
        scope_id: str,
        persona: str | None = None,
        client: str | None = None,
    ) -> dict:
        role = self._scope_role(project_id, scope_id)
        per = _parse_persona(persona)
        ck = _parse_client(client)
        cfg = policy_for(per, ck, role)
        return {
            "persona": per.value,
            "client_kind": ck.value,
            "scope_role": role.value,
            "policy": asdict(cfg),
        }


_SERVICE: ScopeSyncService | None = None


def get_scope_sync_service() -> ScopeSyncService:
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = ScopeSyncService()
    return _SERVICE
