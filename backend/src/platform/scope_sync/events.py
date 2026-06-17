"""Upstream event channel (M3) — path-scoped "SoT advanced" events.

On publish (and parent/child projection, M4) the server appends one event per
affected scope, carrying the changed paths in that scope's coordinates. Sidecars
poll events since a cursor and classify each with the pure policy: auto-integrate
(disjoint) vs hold+notify (overlap). This replaces blind periodic fetch with a
lazy, path-scoped pull.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from src.platform.scope_sync.policy import SyncAction, SyncPolicyConfig, decide_upstream


@dataclass(frozen=True)
class UpstreamEvent:
    id: int                       # cursor (monotonic)
    project_id: str
    scope_id: str
    head_version: str
    affected_paths: tuple[str, ...]
    source: str = "publish"       # publish | scope-sync
    origin_user: str | None = None
    created_at: float = 0.0


class EventStore(Protocol):
    def append(self, *, project_id: str, scope_id: str, head_version: str,
               affected_paths: list[str], source: str, origin_user: str | None) -> UpstreamEvent: ...

    def since(self, project_id: str, scope_id: str, cursor: int, *, limit: int = 200) -> list[UpstreamEvent]: ...

    def recent(self, project_id: str, scope_id: str, *, limit: int = 20) -> list[UpstreamEvent]:
        """Most recent events first (observability / activity feed)."""
        ...


class InMemoryEventStore:
    """Process-local store for dev/tests."""

    def __init__(self) -> None:
        self._events: list[UpstreamEvent] = []
        self._seq = 0

    def append(self, *, project_id, scope_id, head_version, affected_paths, source, origin_user) -> UpstreamEvent:
        self._seq += 1
        ev = UpstreamEvent(
            id=self._seq, project_id=project_id, scope_id=scope_id, head_version=head_version,
            affected_paths=tuple(affected_paths), source=source, origin_user=origin_user,
        )
        self._events.append(ev)
        return ev

    def since(self, project_id, scope_id, cursor, *, limit=200) -> list[UpstreamEvent]:
        return [
            e for e in self._events
            if e.project_id == project_id and e.scope_id == scope_id and e.id > cursor
        ][:limit]

    def recent(self, project_id, scope_id, *, limit=20) -> list[UpstreamEvent]:
        scoped = [e for e in self._events if e.project_id == project_id and e.scope_id == scope_id]
        return list(reversed(scoped))[:limit]


@dataclass
class ClassifiedEvent:
    event: UpstreamEvent
    actions: tuple[SyncAction, ...]


def classify_events(
    events: list[UpstreamEvent],
    dirty_paths: set[str],
    policy: SyncPolicyConfig,
    *,
    self_user: str | None = None,
) -> list[ClassifiedEvent]:
    """Decide what the client should do for each event (skipping ones it caused).
    Pure — the sidecar applies AUTO_INTEGRATE / HOLD / NOTIFY accordingly."""
    out: list[ClassifiedEvent] = []
    for e in events:
        if self_user is not None and e.origin_user == self_user:
            continue  # don't react to your own publish
        actions = decide_upstream(set(e.affected_paths), dirty_paths, policy)
        out.append(ClassifiedEvent(event=e, actions=actions))
    return out


# ── Supabase-backed store (deployable) ────────────────────────────────

TABLE = "scope_sync_events"


def _row_to_event(row: dict) -> UpstreamEvent:
    import datetime as _dt

    created = row.get("created_at")
    ts = 0.0
    if isinstance(created, str):
        try:
            ts = _dt.datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
        except ValueError:
            ts = 0.0
    return UpstreamEvent(
        id=int(row["id"]),
        project_id=row["project_id"],
        scope_id=row["scope_id"],
        head_version=row["head_version"],
        affected_paths=tuple(row.get("affected_paths") or []),
        source=row.get("source", "publish"),
        origin_user=row.get("origin_user"),
        created_at=ts,
    )


class SupabaseEventStore:
    def __init__(self, supabase_client=None) -> None:
        if supabase_client is None:
            from src.infra.supabase.client import SupabaseClient
            supabase_client = SupabaseClient()
        self._client = supabase_client.get_client()

    def append(self, *, project_id, scope_id, head_version, affected_paths, source, origin_user) -> UpstreamEvent:
        resp = self._client.table(TABLE).insert({
            "project_id": project_id, "scope_id": scope_id, "head_version": head_version,
            "affected_paths": list(affected_paths), "source": source, "origin_user": origin_user,
        }).execute()
        return _row_to_event((resp.data or [{}])[0])

    def since(self, project_id, scope_id, cursor, *, limit=200) -> list[UpstreamEvent]:
        resp = (
            self._client.table(TABLE).select("*")
            .eq("project_id", project_id).eq("scope_id", scope_id).gt("id", cursor)
            .order("id").limit(limit).execute()
        )
        return [_row_to_event(r) for r in (resp.data or [])]

    def recent(self, project_id, scope_id, *, limit=20) -> list[UpstreamEvent]:
        resp = (
            self._client.table(TABLE).select("*")
            .eq("project_id", project_id).eq("scope_id", scope_id)
            .order("id", desc=True).limit(limit).execute()
        )
        return [_row_to_event(r) for r in (resp.data or [])]


def build_event_store(name: str) -> EventStore:
    if name == "supabase":
        return SupabaseEventStore()
    return InMemoryEventStore()
