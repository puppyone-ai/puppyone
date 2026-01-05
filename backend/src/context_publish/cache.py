from __future__ import annotations

import time
from dataclasses import dataclass
from threading import RLock
from typing import Optional

from src.context_publish.models import ContextPublish


@dataclass(frozen=True)
class _CacheItem:
    value: ContextPublish
    expires_at_ts: float


class PublishCache:
    """
    进程内缓存（best-effort）。

    - 以 publish_key 为 key 缓存 publish 记录，减少 DB 查询
    - TTL 到期自动失效
    - update/revoke/delete 时由上层主动失效
    """

    def __init__(self, *, ttl_seconds: int):
        self._ttl_seconds = max(0, int(ttl_seconds))
        self._lock = RLock()
        self._store: dict[str, _CacheItem] = {}

    def get(self, publish_key: str) -> Optional[ContextPublish]:
        if not publish_key:
            return None
        now = time.time()
        with self._lock:
            item = self._store.get(publish_key)
            if not item:
                return None
            if item.expires_at_ts < now:
                self._store.pop(publish_key, None)
                return None
            return item.value

    def set(self, publish_key: str, value: ContextPublish) -> None:
        if not publish_key:
            return
        now = time.time()
        with self._lock:
            self._store[publish_key] = _CacheItem(
                value=value, expires_at_ts=now + float(self._ttl_seconds)
            )

    def invalidate(self, publish_key: str) -> None:
        if not publish_key:
            return
        with self._lock:
            self._store.pop(publish_key, None)
