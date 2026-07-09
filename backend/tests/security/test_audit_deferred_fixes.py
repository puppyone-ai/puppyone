"""Hermetic tests for the previously-deferred fixes: ISSUE-003 (scope access-key
hashing, gated dual-read) and ISSUE-015 (cluster-aware notifications, gated).

No Supabase, no Redis, no network — fake clients / websockets only.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest


# ── ISSUE-003: scope access-key hash lookup (gated dual-read) ───────────────

class _FakeScopeClient:
    """Chainable fake: returns a row only when an .eq() on a "hit" column runs."""

    def __init__(self, hit_columns):
        self.hit_columns = set(hit_columns)
        self.eq_calls: list[tuple] = []
        self._last_eq_col = None

    @property
    def client(self):
        return self

    def table(self, _name):
        return self

    def select(self, *a, **k):
        return self

    def eq(self, col, val):
        self.eq_calls.append((col, val))
        self._last_eq_col = col
        return self

    def limit(self, _n):
        return self

    def is_(self, *a, **k):
        return self

    def execute(self):
        row = {
            "id": "s1", "project_id": "p1", "path": "docs",
            "exclude": [], "mode": "rw", "access_key_revoked_at": None,
        }
        data = [row] if self._last_eq_col in self.hit_columns else []
        return SimpleNamespace(data=data)


def _find():
    from src.version_engine.infrastructure.supabase import scope_repository
    return scope_repository.find_scope_by_access_key


def test_flag_off_uses_plaintext_only(monkeypatch):
    from src.config import settings
    monkeypatch.setattr(settings, "SCOPE_ACCESS_KEY_HASH_LOOKUP", False, raising=False)
    client = _FakeScopeClient(hit_columns={"access_key"})
    row = _find()(client, "cli_secretkey")
    assert row is not None
    cols = [c for c, _ in client.eq_calls]
    assert "access_key" in cols
    assert "access_key_hash" not in cols, "flag off must never touch the hash column"


def test_flag_on_resolves_by_hash(monkeypatch):
    from src.config import settings
    from src.repo.access_credentials import access_token_hash
    monkeypatch.setattr(settings, "SCOPE_ACCESS_KEY_HASH_LOOKUP", True, raising=False)
    client = _FakeScopeClient(hit_columns={"access_key_hash"})
    row = _find()(client, "cli_secretkey")
    assert row is not None
    # First lookup is by hash of the key, not the plaintext.
    assert ("access_key_hash", access_token_hash("cli_secretkey")) in client.eq_calls


def test_flag_on_falls_back_to_plaintext_for_unbackfilled_rows(monkeypatch):
    from src.config import settings
    monkeypatch.setattr(settings, "SCOPE_ACCESS_KEY_HASH_LOOKUP", True, raising=False)
    # Hash lookup misses (row not backfilled); plaintext still resolves it.
    client = _FakeScopeClient(hit_columns={"access_key"})
    row = _find()(client, "cli_secretkey")
    assert row is not None
    cols = [c for c, _ in client.eq_calls]
    assert "access_key_hash" in cols and "access_key" in cols


# ── ISSUE-015: cluster-aware notifications (gated, fail-open) ────────────────

class _FakeWS:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, payload):
        self.sent.append(payload)


class _FakeRedis:
    def __init__(self):
        self.published: list[tuple] = []

    async def publish(self, channel, data):
        self.published.append((channel, data))


def _manager():
    from src.version_engine.derived.notifications import NotificationManager
    return NotificationManager()


def test_local_fanout_delivers_to_subscribed_client():
    async def main():
        m = _manager()
        ws = _FakeWS()
        await m.register(ws, "p1", "docs", agent="agent-a")
        await m.broadcast_commit_update(
            "p1", "docs", commit_id="c1", pushed_by="someone-else", changes=[],
        )
        assert len(ws.sent) == 1
        assert ws.sent[0]["type"] == "commit_update"
        assert ws.sent[0]["commit_id"] == "c1"
    asyncio.run(main())


def test_pubsub_disabled_by_default():
    async def main():
        m = _manager()
        await m._ensure_pubsub_started()
        assert m._redis is None and m._pubsub_task is None
    asyncio.run(main())


def test_broadcast_publishes_with_origin_when_redis_present():
    async def main():
        import json
        m = _manager()
        m._pubsub_started = True          # skip real connect
        m._redis = _FakeRedis()
        await m.broadcast_commit_update(
            "p1", "docs/sub", commit_id="c9", pushed_by="u", changes=[{"path": "a.md"}],
        )
        assert len(m._redis.published) == 1
        _channel, raw = m._redis.published[0]
        msg = json.loads(raw)
        assert msg["origin"] == m._origin_id      # loop-prevention tag
        assert msg["project_id"] == "p1"
        assert msg["scope_norm"] == "docs/sub"
        assert msg["payload"]["commit_id"] == "c9"
    asyncio.run(main())
