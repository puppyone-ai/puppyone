"""Fail-closed short-lived storage for Desktop OAuth transactions.

Hosted deployments use Redis so the browser completion and native code
exchange can be served by different API workers. Development and tests may use
the lock-protected in-memory implementation when no Redis URL is configured.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from typing import Any, Protocol

from redis import Redis
from redis.exceptions import RedisError


class DesktopAuthStoreUnavailable(RuntimeError):
    """The configured transaction store could not complete an operation."""


class DesktopAuthStore(Protocol):
    def create_state(self, state: str, value: dict[str, Any], ttl_seconds: int) -> bool: ...

    def read_state(self, state: str) -> dict[str, Any] | None: ...

    def replace_state(self, state: str, value: dict[str, Any]) -> bool: ...

    def consume_state(self, state: str) -> dict[str, Any] | None: ...

    def create_code(self, code: str, value: dict[str, Any], ttl_seconds: int) -> bool: ...

    def consume_code(self, code: str) -> dict[str, Any] | None: ...


@dataclass
class _MemoryEntry:
    value: dict[str, Any]
    expires_at: float


class InMemoryDesktopAuthStore:
    """Process-local store permitted only for development and unit tests."""

    def __init__(self, *, now: Any = time.monotonic):
        self._now = now
        self._lock = threading.RLock()
        self._states: dict[str, _MemoryEntry] = {}
        self._codes: dict[str, _MemoryEntry] = {}

    def create_state(self, state: str, value: dict[str, Any], ttl_seconds: int) -> bool:
        return self._create(self._states, state, value, ttl_seconds)

    def read_state(self, state: str) -> dict[str, Any] | None:
        with self._lock:
            return self._read_locked(self._states, state)

    def replace_state(self, state: str, value: dict[str, Any]) -> bool:
        with self._lock:
            existing = self._states.get(state)
            if not existing or existing.expires_at <= self._now():
                self._states.pop(state, None)
                return False
            existing.value = _copy_record(value)
            return True

    def consume_state(self, state: str) -> dict[str, Any] | None:
        return self._consume(self._states, state)

    def create_code(self, code: str, value: dict[str, Any], ttl_seconds: int) -> bool:
        return self._create(self._codes, code, value, ttl_seconds)

    def consume_code(self, code: str) -> dict[str, Any] | None:
        return self._consume(self._codes, code)

    def _create(
        self,
        bucket: dict[str, _MemoryEntry],
        key: str,
        value: dict[str, Any],
        ttl_seconds: int,
    ) -> bool:
        with self._lock:
            existing = bucket.get(key)
            if existing and existing.expires_at > self._now():
                return False
            bucket[key] = _MemoryEntry(
                value=_copy_record(value),
                expires_at=self._now() + max(1, int(ttl_seconds)),
            )
            return True

    def _consume(
        self,
        bucket: dict[str, _MemoryEntry],
        key: str,
    ) -> dict[str, Any] | None:
        with self._lock:
            entry = bucket.pop(key, None)
            if not entry or entry.expires_at <= self._now():
                return None
            return _copy_record(entry.value)

    def _read_locked(
        self,
        bucket: dict[str, _MemoryEntry],
        key: str,
    ) -> dict[str, Any] | None:
        entry = bucket.get(key)
        if not entry or entry.expires_at <= self._now():
            bucket.pop(key, None)
            return None
        return _copy_record(entry.value)


class RedisDesktopAuthStore:
    """Redis-backed store with atomic create and consume operations."""

    def __init__(self, url: str, *, key_prefix: str = "puppyone:desktop-auth:v1"):
        self._redis = Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=1.0,
            socket_timeout=1.0,
            health_check_interval=30,
        )
        self._key_prefix = key_prefix.rstrip(":")

    def create_state(self, state: str, value: dict[str, Any], ttl_seconds: int) -> bool:
        return self._create("state", state, value, ttl_seconds)

    def read_state(self, state: str) -> dict[str, Any] | None:
        return self._read("state", state)

    def replace_state(self, state: str, value: dict[str, Any]) -> bool:
        try:
            result = self._redis.set(
                self._key("state", state),
                _encode_record(value),
                xx=True,
                keepttl=True,
            )
            return bool(result)
        except RedisError as exc:
            raise DesktopAuthStoreUnavailable("Desktop authentication store is unavailable.") from exc

    def consume_state(self, state: str) -> dict[str, Any] | None:
        return self._consume("state", state)

    def create_code(self, code: str, value: dict[str, Any], ttl_seconds: int) -> bool:
        return self._create("code", code, value, ttl_seconds)

    def consume_code(self, code: str) -> dict[str, Any] | None:
        return self._consume("code", code)

    def _create(
        self,
        kind: str,
        identifier: str,
        value: dict[str, Any],
        ttl_seconds: int,
    ) -> bool:
        try:
            result = self._redis.set(
                self._key(kind, identifier),
                _encode_record(value),
                ex=max(1, int(ttl_seconds)),
                nx=True,
            )
            return bool(result)
        except RedisError as exc:
            raise DesktopAuthStoreUnavailable("Desktop authentication store is unavailable.") from exc

    def _read(self, kind: str, identifier: str) -> dict[str, Any] | None:
        try:
            raw = self._redis.get(self._key(kind, identifier))
        except RedisError as exc:
            raise DesktopAuthStoreUnavailable("Desktop authentication store is unavailable.") from exc
        return _decode_record(raw)

    def _consume(self, kind: str, identifier: str) -> dict[str, Any] | None:
        try:
            raw = self._redis.getdel(self._key(kind, identifier))
        except RedisError as exc:
            raise DesktopAuthStoreUnavailable("Desktop authentication store is unavailable.") from exc
        return _decode_record(raw)

    def _key(self, kind: str, identifier: str) -> str:
        digest = hashlib.sha256(identifier.encode("utf-8")).hexdigest()
        return f"{self._key_prefix}:{kind}:{digest}"


def create_desktop_auth_store(*, redis_url: str, app_env: str) -> DesktopAuthStore:
    normalized_url = redis_url.strip()
    if normalized_url:
        return RedisDesktopAuthStore(normalized_url)
    if app_env not in {"development", "test"}:
        raise RuntimeError("DESKTOP_AUTH_REDIS_URL is required for hosted Desktop authentication.")
    return InMemoryDesktopAuthStore()


def _encode_record(value: dict[str, Any]) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _decode_record(raw: str | bytes | None) -> dict[str, Any] | None:
    if raw is None:
        return None
    try:
        decoded = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise DesktopAuthStoreUnavailable("Desktop authentication store returned invalid data.") from exc
    if not isinstance(decoded, dict):
        raise DesktopAuthStoreUnavailable("Desktop authentication store returned invalid data.")
    return decoded


def _copy_record(value: dict[str, Any]) -> dict[str, Any]:
    return json.loads(_encode_record(value))
