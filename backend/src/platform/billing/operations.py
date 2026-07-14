from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from src.infra.supabase.client import SupabaseClient


class BillingOperation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    org_id: str
    kind: str
    status: str
    idempotency_key: str
    actor_user_id: str | None = None
    subject_user_id: str | None = None
    invitation_id: str | None = None
    target_plan_id: str | None = None
    current_seat_quantity: int | None = None
    target_seat_quantity: int | None = None
    quote_id: str | None = None
    confirmed_revision: int | None = None
    request_payload: dict[str, Any] = Field(default_factory=dict)
    response_payload: dict[str, Any] = Field(default_factory=dict)
    attempts: int = 0
    last_error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    completed_at: datetime | None = None


class BillingOperationRepository:
    TABLE = "organization_billing_operations"

    def __init__(self, supabase_client: SupabaseClient | None = None):
        self._client = (supabase_client or SupabaseClient()).get_client()

    def create_or_get(self, values: dict[str, Any]) -> BillingOperation:
        org_id = str(values["org_id"])
        key = str(values["idempotency_key"])
        existing = self.get_by_key(org_id, key)
        if existing is not None:
            return existing
        try:
            response = self._client.table(self.TABLE).insert(values).execute()
        except Exception:
            # A concurrent retry may have won the unique (org_id, key) race.
            existing = self.get_by_key(org_id, key)
            if existing is None:
                raise
            return existing
        return BillingOperation.model_validate(response.data[0])

    def enqueue_entitlement_provisioning(
        self,
        *,
        org_id: str,
        actor_user_id: str | None = None,
    ) -> BillingOperation:
        return self.create_or_get(
            {
                "org_id": org_id,
                "kind": "entitlement_provision",
                "status": "pending",
                "idempotency_key": "entitlement-provision:v1",
                "actor_user_id": actor_user_id,
                "request_payload": {"schema_version": "1.0"},
            }
        )

    def enqueue_missing_entitlement_provisioning(self, *, limit: int = 100) -> int:
        response = self._client.rpc(
            "enqueue_missing_entitlement_provisioning",
            {"p_limit": max(1, min(limit, 1000))},
        ).execute()
        data = response.data
        if isinstance(data, list):
            data = data[0] if data else 0
        return int(data or 0)

    def claim_entitlement_provisioning(
        self,
        *,
        limit: int = 25,
        lease_seconds: int = 60,
    ) -> list[BillingOperation]:
        response = self._client.rpc(
            "claim_entitlement_provisioning_batch",
            {
                "p_limit": max(1, min(limit, 100)),
                "p_lease_seconds": max(10, min(lease_seconds, 3600)),
            },
        ).execute()
        return [BillingOperation.model_validate(row) for row in response.data or []]

    def claim_seat_proposals(
        self,
        *,
        limit: int = 25,
        lease_seconds: int = 60,
    ) -> list[BillingOperation]:
        response = self._client.rpc(
            "claim_seat_proposal_batch",
            {
                "p_limit": max(1, min(limit, 100)),
                "p_lease_seconds": max(10, min(lease_seconds, 3600)),
            },
        ).execute()
        return [BillingOperation.model_validate(row) for row in response.data or []]

    def get_by_key(self, org_id: str, key: str) -> BillingOperation | None:
        response = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("org_id", org_id)
            .eq("idempotency_key", key)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return BillingOperation.model_validate(rows[0]) if rows else None

    def get_by_id(self, org_id: str, operation_id: str) -> BillingOperation | None:
        response = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("org_id", org_id)
            .eq("id", operation_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return BillingOperation.model_validate(rows[0]) if rows else None

    def update(self, operation_id: str, values: dict[str, Any]) -> BillingOperation:
        response = self._client.table(self.TABLE).update(values).eq("id", operation_id).execute()
        return BillingOperation.model_validate(response.data[0])

    def update_claimed_seat_proposal(
        self,
        operation: BillingOperation,
        values: dict[str, Any],
    ) -> BillingOperation | None:
        """Finish a proposal only if no owner/manual flow changed the row.

        `updated_at` is the lease fencing token advanced by the claim RPC. A
        concurrent Desktop quote therefore wins without a background worker
        regressing its newer quote or application state.
        """

        query = (
            self._client.table(self.TABLE)
            .update(values)
            .eq("id", operation.id)
            .in_("status", ["pending", "awaiting_confirmation"])
        )
        if operation.updated_at is not None:
            query = query.eq("updated_at", operation.updated_at.isoformat())
        response = query.execute()
        rows = response.data or []
        return BillingOperation.model_validate(rows[0]) if rows else None

    def list_for_org(self, org_id: str, *, limit: int = 100) -> list[BillingOperation]:
        response = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("org_id", org_id)
            .order("created_at", desc=True)
            .limit(max(1, min(limit, 200)))
            .execute()
        )
        return [BillingOperation.model_validate(row) for row in response.data or []]

    def count_pending(self, org_id: str) -> int:
        response = (
            self._client.table(self.TABLE)
            .select("id", count="exact")
            .eq("org_id", org_id)
            .in_("status", ["pending", "awaiting_confirmation", "quoted", "submitted"])
            .execute()
        )
        return int(response.count or 0)

    def reserve_member_activation(
        self,
        *,
        org_id: str,
        subject_user_id: str,
        actor_user_id: str,
        invitation_id: str | None,
        role: str,
        idempotency_key: str,
    ) -> BillingOperation:
        response = self._client.rpc(
            "reserve_billable_member_activation",
            {
                "p_org_id": org_id,
                "p_subject_user_id": subject_user_id,
                "p_actor_user_id": actor_user_id,
                "p_invitation_id": invitation_id,
                "p_role": role,
                "p_idempotency_key": idempotency_key,
            },
        ).execute()
        data = response.data
        if isinstance(data, list):
            data = data[0] if data else None
        if not isinstance(data, dict):
            raise RuntimeError("seat admission reservation returned an invalid response")
        return BillingOperation.model_validate(data)
