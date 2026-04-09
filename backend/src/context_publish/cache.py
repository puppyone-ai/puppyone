from __future__ import annotations

import time
from dataclasses import dataclass
from threading import RLock

from src.context_publish.models import ContextPublish


@dataclass(frozen=True)
class _CacheItem:
    value: ContextPublish
    expires_at_ts: float


class PublishCache:
    """
    In-process cache (best-effort).

    - Caches publish records keyed by publish_key to reduce DB queries
    - Automatically expires when TTL is reached
    - Proactively invalidated by upper layer on update/revoke/delete
    """

    def __init__(self, *, ttl_seconds: int):
        self._ttl_seconds = max(0, int(ttl_seconds))
        self._lock = RLock()
        self._store: dict[str, _CacheItem] = {}

    def get(self, publish_key: str) -> ContextPublish | None:
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
