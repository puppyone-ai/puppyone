from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
import string
from typing import Any, List, Optional

from src.config import settings
from src.context_publish.cache import PublishCache
from src.context_publish.models import ContextPublish
from src.context_publish.repository import ContextPublishRepositoryBase
from src.exceptions import ErrorCode, NotFoundException, ValidationException
from src.supabase.exceptions import SupabaseDuplicateKeyError, SupabaseException
from src.supabase.context_publish.schemas import (
    ContextPublishCreate as SbContextPublishCreate,
    ContextPublishUpdate as SbContextPublishUpdate,
)
from src.table.service import TableService


_BASE62_ALPHABET = string.ascii_letters + string.digits


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _default_expires_at() -> datetime:
    return _now_utc() + timedelta(days=int(settings.PUBLISH_DEFAULT_EXPIRES_DAYS))


def _generate_publish_key(*, length: int) -> str:
    # 固定长度 base62 随机串：URL-safe、不可猜测
    length = int(length)
    if length <= 0:
        raise ValueError("publish_key length must be positive")
    return "".join(secrets.choice(_BASE62_ALPHABET) for _ in range(length))


class ContextPublishService:
    def __init__(self, *, repo: ContextPublishRepositoryBase, table_service: TableService):
        self.repo = repo
        self.table_service = table_service
        self.cache = PublishCache(ttl_seconds=int(settings.PUBLISH_CACHE_TTL_SECONDS))

    def _invalidate_cache(self, publish_key: str) -> None:
        self.cache.invalidate(publish_key)

    def create(
        self,
        *,
        user_id: str,
        table_id: int,
        json_path: str,
        expires_at: Optional[datetime],
    ) -> ContextPublish:
        # 强校验：table 必须属于当前用户
        self.table_service.get_by_id_with_access_check(table_id, user_id)

        if expires_at is None:
            expires_at = _default_expires_at()

        # 生成 key（全局唯一：只在“唯一冲突”时重试，其他错误应直接暴露真实原因）
        last_dup: Exception | None = None
        for _ in range(10):
            key = _generate_publish_key(length=int(settings.PUBLISH_KEY_LENGTH))
            try:
                created = self.repo.create(
                    SbContextPublishCreate(
                        user_id=user_id,
                        table_id=table_id,
                        json_path=json_path or "",
                        publish_key=key,
                        status=True,
                        expires_at=expires_at,
                    )
                )
                self.cache.set(created.publish_key, created)
                return created
            except SupabaseDuplicateKeyError as e:
                # 只对 publish_key 唯一冲突重试；其他字段冲突不该发生。
                last_dup = e
                continue
            except SupabaseException:
                # 例如：表未创建、RLS/权限、字段/类型不匹配等 —— 直接抛出，避免被“unique 重试”掩盖
                raise
            except Exception:
                raise

        # 极小概率：连续撞 key；这里返回 422（Validation）
        raise ValidationException("Failed to generate unique publish_key") from last_dup

    def list_user_publishes(self, user_id: str, *, skip: int = 0, limit: int = 100) -> List[ContextPublish]:
        return self.repo.list_by_user_id(user_id, skip=skip, limit=limit)

    def get_by_id_with_access_check(self, publish_id: int, user_id: str) -> ContextPublish:
        p = self.repo.get_by_id(publish_id)
        if not p or p.user_id != user_id:
            raise NotFoundException("Publish not found", code=ErrorCode.NOT_FOUND)
        return p

    def update(
        self,
        *,
        publish_id: int,
        user_id: str,
        status: Optional[bool],
        expires_at: Optional[datetime],
    ) -> ContextPublish:
        existing = self.get_by_id_with_access_check(publish_id, user_id)
        updated = self.repo.update(
            publish_id,
            SbContextPublishUpdate(status=status, expires_at=expires_at),
        )
        if not updated:
            raise NotFoundException("Publish not found", code=ErrorCode.NOT_FOUND)
        # 主动失效缓存（按 spec：立即生效）
        self._invalidate_cache(existing.publish_key)
        return updated

    def delete(self, *, publish_id: int, user_id: str) -> None:
        existing = self.get_by_id_with_access_check(publish_id, user_id)
        ok = self.repo.delete(publish_id)
        if not ok:
            raise NotFoundException("Publish not found", code=ErrorCode.NOT_FOUND)
        self._invalidate_cache(existing.publish_key)

    def _get_by_key_cached(self, publish_key: str) -> Optional[ContextPublish]:
        cached = self.cache.get(publish_key)
        if cached:
            return cached
        found = self.repo.get_by_key(publish_key)
        if found:
            self.cache.set(publish_key, found)
        return found

    def get_public_json(self, publish_key: str) -> Any:
        p = self._get_by_key_cached(publish_key)
        if not p:
            raise NotFoundException("Publish not found", code=ErrorCode.NOT_FOUND)
        if not p.status:
            raise NotFoundException("Publish not found", code=ErrorCode.NOT_FOUND)
        if p.expires_at and p.expires_at <= _now_utc():
            # 过期即视为不存在
            raise NotFoundException("Publish not found", code=ErrorCode.NOT_FOUND)

        # 注意：公开读取不做 user 权限校验；publish_key 即访问凭据
        data = self.table_service.get_context_data(table_id=p.table_id, json_pointer_path=p.json_path or "")
        return data


