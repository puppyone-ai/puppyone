"""ISSUE-006 — login brute-force throttle (account-keyed, failed-attempts only).

Hermetic: exercises the limiter directly with the in-process fallback
(RATELIMIT_REDIS_URL unset) — no Supabase, no Redis, no network.
"""

from __future__ import annotations

import inspect


def _auth():
    from src.platform.auth import router
    return router


def test_over_limit_increments_and_trips():
    r = _auth()
    r._rate_hits.clear()
    over = [r._over_limit("t", "acct-a", 3, 60) for _ in range(4)]
    assert over == [False, False, False, True]


def test_over_limit_is_per_value():
    r = _auth()
    r._rate_hits.clear()
    assert r._over_limit("t", "acct-a", 1, 60) is False
    assert r._over_limit("t", "acct-a", 1, 60) is True   # a's 2nd trips
    assert r._over_limit("t", "acct-b", 1, 60) is False  # b independent


def test_over_limit_uses_redis_when_available(monkeypatch):
    r = _auth()
    r._rate_hits.clear()
    counters: dict = {}

    def fake_script(keys, args):          # mimics the INCR+EXPIRE Lua, returns count
        counters[keys[0]] = counters.get(keys[0], 0) + 1
        return counters[keys[0]]

    monkeypatch.setattr(r, "_get_rl_redis", lambda: (object(), fake_script))
    over = [r._over_limit("t", "acct-r", 2, 60) for _ in range(3)]
    assert over == [False, False, True]   # counts 1,2 ok; 3 over


def test_over_limit_fails_open_to_in_process_on_redis_error(monkeypatch):
    r = _auth()
    r._rate_hits.clear()

    def boom(keys, args):
        raise RuntimeError("redis down")

    # A Redis failure must NOT block auth — it degrades to the in-process window.
    monkeypatch.setattr(r, "_get_rl_redis", lambda: (object(), boom))
    over = [r._over_limit("t", "acct-f", 1, 60) for _ in range(2)]
    assert over == [False, True]


def test_register_login_failure_throttles_per_account():
    r = _auth()
    r._rate_hits.clear()
    email = "victim@example.com"
    results = [r._register_login_failure(email) for _ in range(r._LOGIN_FAIL_MAX + 1)]
    assert all(x is False for x in results[:r._LOGIN_FAIL_MAX])
    assert results[-1] is True
    # A different account is unaffected — no cross-account lockout.
    assert r._register_login_failure("someone-else@example.com") is False


def test_failure_key_is_hashed_no_plaintext_email():
    r = _auth()
    h = r._hash_key("user@example.com")
    assert "user@example.com" not in h
    assert len(h) == 24


def test_login_counts_failures_and_refresh_is_not_limited():
    """Regression guards for the security design:
      - login must throttle on FAILED attempts (not block success);
      - refresh must NOT be rate-limited (avoid throttling legit clients);
      - neither may key on client IP (proxy-shared / spoofable)."""
    r = _auth()
    login_src = inspect.getsource(r.login)
    refresh_src = inspect.getsource(r.refresh_token)
    assert "_register_login_failure(body.email)" in login_src
    assert "_over_limit" not in refresh_src
    assert "_register_login_failure" not in refresh_src
    assert "_client_ip" not in login_src and "_client_ip" not in refresh_src


def test_missing_email_does_not_crash():
    r = _auth()
    r._rate_hits.clear()
    # Empty / None account still resolves to a stable bucket, never raises.
    assert r._register_login_failure("") is False
