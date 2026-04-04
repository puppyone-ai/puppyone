"""
Context Publish Data Access Layer

Provides CRUD operations for the public.context_publish table.
"""

from __future__ import annotations

from datetime import datetime

from supabase import Client

from src.context_publish.supabase_schemas import (
    ContextPublishCreate,
    ContextPublishResponse,
    ContextPublishUpdate,
)
from src.infra.supabase.exceptions import handle_supabase_error


class ContextPublishRepository:
    def __init__(self, client: Client):
        self._client = client

    def _normalize_payload(self, payload: dict) -> dict:
        """
        Supabase/PostgREST JSON body must be JSON-serializable.
        Normalizes types like datetime to ISO strings.
        """
        expires_at = payload.get("expires_at")
        if isinstance(expires_at, datetime):
            payload["expires_at"] = expires_at.isoformat()
        return payload

    def create(self, data: ContextPublishCreate) -> ContextPublishResponse:
        try:
            payload = data.model_dump(exclude_none=True)
            payload.pop("id", None)
            payload.pop("created_at", None)
            payload.pop("updated_at", None)
            payload = self._normalize_payload(payload)
            response = self._client.table("context_publishes").insert(payload).execute()
            return ContextPublishResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "create ContextPublish")

    def get_by_id(self, publish_id: int) -> ContextPublishResponse | None:
        response = (
            self._client.table("context_publishes")
            .select("*")
            .eq("id", publish_id)
            .execute()
        )
        if response.data:
            return ContextPublishResponse(**response.data[0])
        return None

    def get_by_publish_key(self, publish_key: str) -> ContextPublishResponse | None:
        response = (
            self._client.table("context_publishes")
            .select("*")
            .eq("publish_key", publish_key)
            .execute()
        )
        if response.data:
            return ContextPublishResponse(**response.data[0])
        return None

    def get_list(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        created_by: str | None = None,
    ) -> list[ContextPublishResponse]:
        query = self._client.table("context_publishes").select("*")
        if created_by is not None:
            query = query.eq("created_by", created_by)
        response = query.range(skip, skip + limit - 1).execute()
        return [ContextPublishResponse(**item) for item in response.data]

    def update(
        self, publish_id: int, data: ContextPublishUpdate
    ) -> ContextPublishResponse | None:
        try:
            payload = data.model_dump(exclude_none=True)
            if not payload:
                return self.get_by_id(publish_id)
            payload.pop("id", None)
            payload.pop("created_at", None)
            payload.pop("updated_at", None)
            payload = self._normalize_payload(payload)
            response = (
                self._client.table("context_publishes")
                .update(payload)
                .eq("id", publish_id)
                .execute()
            )
            if response.data:
                return ContextPublishResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "update ContextPublish")

    def delete(self, publish_id: int) -> bool:
        response = (
            self._client.table("context_publishes")
            .delete()
            .eq("id", publish_id)
            .execute()
        )
        return len(response.data) > 0
