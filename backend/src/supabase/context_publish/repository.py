"""
Context Publish 数据访问层

提供针对 public.context_publish 表的增删改查操作。
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from supabase import Client

from src.supabase.context_publish.schemas import (
    ContextPublishCreate,
    ContextPublishResponse,
    ContextPublishUpdate,
)
from src.supabase.exceptions import handle_supabase_error


class ContextPublishRepository:
    def __init__(self, client: Client):
        self._client = client

    def _normalize_payload(self, payload: dict) -> dict:
        """
        Supabase/PostgREST 的 JSON body 需要是 JSON-serializable。
        这里将 datetime 等类型规范化为 ISO 字符串。
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
            response = self._client.table("context_publish").insert(payload).execute()
            return ContextPublishResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建 ContextPublish")

    def get_by_id(self, publish_id: int) -> Optional[ContextPublishResponse]:
        response = (
            self._client.table("context_publish").select("*").eq("id", publish_id).execute()
        )
        if response.data:
            return ContextPublishResponse(**response.data[0])
        return None

    def get_by_publish_key(self, publish_key: str) -> Optional[ContextPublishResponse]:
        response = (
            self._client.table("context_publish")
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
        user_id: Optional[str] = None,
    ) -> List[ContextPublishResponse]:
        query = self._client.table("context_publish").select("*")
        if user_id is not None:
            query = query.eq("user_id", user_id)
        response = query.range(skip, skip + limit - 1).execute()
        return [ContextPublishResponse(**item) for item in response.data]

    def update(self, publish_id: int, data: ContextPublishUpdate) -> Optional[ContextPublishResponse]:
        try:
            payload = data.model_dump(exclude_none=True)
            if not payload:
                return self.get_by_id(publish_id)
            payload.pop("id", None)
            payload.pop("created_at", None)
            payload.pop("updated_at", None)
            payload = self._normalize_payload(payload)
            response = (
                self._client.table("context_publish")
                .update(payload)
                .eq("id", publish_id)
                .execute()
            )
            if response.data:
                return ContextPublishResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新 ContextPublish")

    def delete(self, publish_id: int) -> bool:
        response = self._client.table("context_publish").delete().eq("id", publish_id).execute()
        return len(response.data) > 0


