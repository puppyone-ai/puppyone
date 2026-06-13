"""Per-scope sync settings store (M5): persona + auto_sync, one row per scope."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

_VALID_PERSONA = {"non_dev", "dev", "reviewer"}


@dataclass(frozen=True)
class SyncSettings:
    persona: str = "dev"
    auto_sync: bool = True

    def normalized(self) -> "SyncSettings":
        per = self.persona if self.persona in _VALID_PERSONA else "dev"
        return SyncSettings(persona=per, auto_sync=bool(self.auto_sync))


class SettingsStore(Protocol):
    def get(self, project_id: str, scope_id: str) -> SyncSettings | None: ...
    def put(self, project_id: str, scope_id: str, settings: SyncSettings) -> None: ...


class InMemorySettingsStore:
    def __init__(self) -> None:
        self._d: dict[tuple[str, str], SyncSettings] = {}

    def get(self, project_id, scope_id):
        return self._d.get((project_id, scope_id))

    def put(self, project_id, scope_id, settings):
        self._d[(project_id, scope_id)] = settings.normalized()


TABLE = "scope_sync_settings"


class SupabaseSettingsStore:
    def __init__(self, supabase_client=None) -> None:
        if supabase_client is None:
            from src.infra.supabase.client import SupabaseClient
            supabase_client = SupabaseClient()
        self._client = supabase_client.get_client()

    def get(self, project_id, scope_id):
        resp = (self._client.table(TABLE).select("*")
                .eq("project_id", project_id).eq("scope_id", scope_id).limit(1).execute())
        rows = resp.data or []
        if not rows:
            return None
        r = rows[0]
        return SyncSettings(persona=r.get("persona", "dev"), auto_sync=bool(r.get("auto_sync", True)))

    def put(self, project_id, scope_id, settings):
        s = settings.normalized()
        self._client.table(TABLE).upsert(
            {"project_id": project_id, "scope_id": scope_id,
             "persona": s.persona, "auto_sync": s.auto_sync},
            on_conflict="project_id,scope_id",
        ).execute()


def build_settings_store(name: str) -> SettingsStore:
    if name == "supabase":
        return SupabaseSettingsStore()
    return InMemorySettingsStore()
