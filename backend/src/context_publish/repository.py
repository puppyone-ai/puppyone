from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional

from src.context_publish.models import ContextPublish
from src.supabase.context_publish.schemas import (
    ContextPublishCreate as SbContextPublishCreate,
    ContextPublishUpdate as SbContextPublishUpdate,
)
from src.supabase.repository import SupabaseRepository


class ContextPublishRepositoryBase(ABC):
    @abstractmethod
    def create(self, data: SbContextPublishCreate) -> ContextPublish:
        raise NotImplementedError

    @abstractmethod
    def get_by_id(self, publish_id: int) -> Optional[ContextPublish]:
        raise NotImplementedError

    @abstractmethod
    def get_by_key(self, publish_key: str) -> Optional[ContextPublish]:
        raise NotImplementedError

    @abstractmethod
    def list_by_user_id(
        self, user_id: str, *, skip: int = 0, limit: int = 100
    ) -> List[ContextPublish]:
        raise NotImplementedError

    @abstractmethod
    def update(self, publish_id: int, data: SbContextPublishUpdate) -> Optional[ContextPublish]:
        raise NotImplementedError

    @abstractmethod
    def delete(self, publish_id: int) -> bool:
        raise NotImplementedError


class ContextPublishRepositorySupabase(ContextPublishRepositoryBase):
    def __init__(self, supabase_repo: SupabaseRepository):
        self._repo = supabase_repo

    def _to_model(self, resp) -> ContextPublish:
        return ContextPublish(
            id=resp.id,
            created_at=resp.created_at,
            updated_at=resp.updated_at,
            user_id=str(resp.user_id) if resp.user_id else "",
            table_id=int(resp.table_id or 0),
            json_path=resp.json_path or "",
            publish_key=resp.publish_key or "",
            status=bool(resp.status),
            expires_at=resp.expires_at,
        )

    def create(self, data: SbContextPublishCreate) -> ContextPublish:
        resp = self._repo.create_context_publish(data)
        return self._to_model(resp)

    def get_by_id(self, publish_id: int) -> Optional[ContextPublish]:
        resp = self._repo.get_context_publish(publish_id)
        if not resp:
            return None
        return self._to_model(resp)

    def get_by_key(self, publish_key: str) -> Optional[ContextPublish]:
        resp = self._repo.get_context_publish_by_key(publish_key)
        if not resp:
            return None
        return self._to_model(resp)

    def list_by_user_id(
        self, user_id: str, *, skip: int = 0, limit: int = 100
    ) -> List[ContextPublish]:
        resps = self._repo.get_context_publish_list(skip=skip, limit=limit, user_id=user_id)
        return [self._to_model(r) for r in resps]

    def update(self, publish_id: int, data: SbContextPublishUpdate) -> Optional[ContextPublish]:
        resp = self._repo.update_context_publish(publish_id, data)
        if not resp:
            return None
        return self._to_model(resp)

    def delete(self, publish_id: int) -> bool:
        return self._repo.delete_context_publish(publish_id)


