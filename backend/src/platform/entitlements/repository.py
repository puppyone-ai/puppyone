from __future__ import annotations

from datetime import datetime
from typing import Any

from src.infra.supabase.client import SupabaseClient
from src.platform.entitlements.models import EntitlementSnapshot, EntitlementUpsert
from src.utils.logger import log_warning


def _serialize_dt(value: datetime | None) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


class EntitlementRepository:
    TABLE = "organization_entitlements"
    EVENTS_TABLE = "organization_entitlement_events"

    def __init__(self, supabase_client: SupabaseClient | None = None):
        self._client = (supabase_client or SupabaseClient()).get_client()

    def get_by_org_id(self, org_id: str) -> EntitlementSnapshot | None:
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("org_id", org_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return EntitlementSnapshot(**rows[0]) if rows else None

    def upsert(self, payload: EntitlementUpsert) -> EntitlementSnapshot:
        existing = self.get_by_org_id(payload.org_id)
        row: dict[str, Any] = {
            "org_id": payload.org_id,
            "plan_id": payload.plan_id,
            "status": payload.status,
            "source": payload.source,
            "entitlements": payload.entitlements,
            "current_period_end": _serialize_dt(payload.current_period_end),
            "effective_until": _serialize_dt(payload.effective_until),
        }
        resp = (
            self._client.table(self.TABLE)
            .upsert(row, on_conflict="org_id")
            .execute()
        )
        snapshot = EntitlementSnapshot(**resp.data[0])
        self._record_event(payload, existing, snapshot)
        return snapshot

    def _record_event(
        self,
        payload: EntitlementUpsert,
        existing: EntitlementSnapshot | None,
        snapshot: EntitlementSnapshot,
    ) -> None:
        event_row = {
            "org_id": payload.org_id,
            "source": payload.source,
            "source_event_id": payload.source_event_id,
            "event_type": payload.event_type,
            "old_plan_id": existing.plan_id if existing else None,
            "new_plan_id": snapshot.plan_id,
            "old_entitlements": existing.entitlements if existing else None,
            "new_entitlements": snapshot.entitlements,
        }
        try:
            self._client.table(self.EVENTS_TABLE).insert(event_row).execute()
        except Exception as exc:
            # Snapshot upsert is the source used by enforcement. Event writes are
            # audit-only, so duplicate webhook retries should not fail billing sync.
            log_warning(
                "[entitlements] failed to record entitlement event "
                f"org={payload.org_id} source_event={payload.source_event_id}: {exc}"
            )
