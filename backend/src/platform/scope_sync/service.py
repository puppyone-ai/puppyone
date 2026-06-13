"""Server-side resolution of the managed sync policy (#M5).

Users don't configure triggers; the server resolves a preset for a
(scope-role × persona × client-kind) and hands it to the sidecar + frontend.
Scope role is derived from the scope (root vs sub). Persona/client default
sensibly and can be overridden by the caller (later: persisted project setting).
"""

from __future__ import annotations

from dataclasses import asdict

from src.platform.scope_sync.events import EventStore, build_event_store
from src.platform.scope_sync.fanout import fanout_targets, to_abs
from src.platform.scope_sync.settings_store import (
    SettingsStore,
    SyncSettings,
    build_settings_store,
)
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

    def __init__(self, *, scope_lookup=None, scopes_lister=None,
                 event_store: EventStore | None = None,
                 settings_store: SettingsStore | None = None) -> None:
        self._scope_lookup = scope_lookup or (lambda sid: _scope_service().get(sid))
        # lists a project's scopes as [(scope_id, scope_path), ...] for M4 fanout
        self._scopes_lister = scopes_lister or self._default_scopes_lister
        from src.config import settings
        store_name = getattr(settings, "SCOPE_SANDBOX_STORE", "memory")
        self._events = event_store or build_event_store(store_name)
        self._settings = settings_store or build_settings_store(store_name)

    @staticmethod
    def _default_scopes_lister(project_id: str) -> list[tuple[str, str]]:
        scopes = _scope_service().list_for_project(project_id)
        return [(s.id, getattr(s, "path", "") or "") for s in scopes]

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
        stored = self._settings.get(project_id, scope_id)
        # explicit override wins; else the stored persona; else default
        per = _parse_persona(persona or (stored.persona if stored else None))
        ck = _parse_client(client)
        cfg = policy_for(per, ck, role)
        return {
            "persona": per.value,
            "client_kind": ck.value,
            "scope_role": role.value,
            "auto_sync": stored.auto_sync if stored else True,
            "policy": asdict(cfg),
        }

    def get_settings(self, *, project_id: str, scope_id: str) -> dict:
        s = (self._settings.get(project_id, scope_id) or SyncSettings()).normalized()
        return {"persona": s.persona, "auto_sync": s.auto_sync}

    def set_settings(self, *, project_id: str, scope_id: str,
                     persona: str | None = None, auto_sync: bool | None = None) -> dict:
        cur = self._settings.get(project_id, scope_id) or SyncSettings()
        new = SyncSettings(
            persona=persona if persona is not None else cur.persona,
            auto_sync=auto_sync if auto_sync is not None else cur.auto_sync,
        ).normalized()
        self._settings.put(project_id, scope_id, new)
        return {"persona": new.persona, "auto_sync": new.auto_sync}

    # ── upstream event channel (M3) + parent/child fanout (M4) ────────

    def record_publish(
        self,
        *,
        project_id: str,
        scope_path: str,
        changed_paths: list[str],
        head_version: str,
        origin_user: str | None = None,
    ) -> int:
        """A version was published to ``scope_path`` touching ``changed_paths``.
        Fan out a path-scoped upstream event to every project scope whose subtree
        intersects the change (root + ancestors + the scope itself), translated
        into each scope's coordinates. Returns the number of events emitted.
        Best-effort: never raise into the publish path."""
        try:
            abs_paths = to_abs(scope_path, set(changed_paths))
            targets = fanout_targets(abs_paths, self._scopes_lister(project_id))
            for scope_id, paths in targets.items():
                self._events.append(
                    project_id=project_id, scope_id=scope_id, head_version=head_version,
                    affected_paths=paths, source="publish", origin_user=origin_user,
                )
            return len(targets)
        except Exception:  # noqa: BLE001 - eventing must not break a publish
            return 0

    def poll_events(self, *, project_id: str, scope_id: str, cursor: int) -> dict:
        """Events for a scope since ``cursor`` (the sidecar's last seen id)."""
        events = self._events.since(project_id, scope_id, cursor)
        return {
            "cursor": events[-1].id if events else cursor,
            "events": [
                {
                    "id": e.id, "head_version": e.head_version,
                    "affected_paths": list(e.affected_paths),
                    "source": e.source, "origin_user": e.origin_user,
                }
                for e in events
            ],
        }


_SERVICE: ScopeSyncService | None = None


def get_scope_sync_service() -> ScopeSyncService:
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = ScopeSyncService()
    return _SERVICE
