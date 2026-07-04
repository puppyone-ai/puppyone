"""ISSUE-006 — sensitive auth endpoints are rate-limited (login/refresh).

Hermetic: exercises the in-process limiter directly (no Supabase, no network).
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException


def _auth():
    from src.platform.auth import router
    return router


def test_rate_limit_blocks_after_max_hits():
    r = _auth()
    r._rate_hits.clear()
    ip = "203.0.113.7"
    # First N allowed, N+1 blocked with 429 + Retry-After.
    for _ in range(5):
        r._rate_limit("unit-test", ip, max_hits=5, window_s=60)
    with pytest.raises(HTTPException) as ei:
        r._rate_limit("unit-test", ip, max_hits=5, window_s=60)
    assert ei.value.status_code == 429
    assert "Retry-After" in (ei.value.headers or {})


def test_rate_limit_is_per_ip_and_per_bucket():
    r = _auth()
    r._rate_hits.clear()
    # Exhaust one IP...
    for _ in range(3):
        r._rate_limit("login", "10.0.0.1", max_hits=3, window_s=60)
    with pytest.raises(HTTPException):
        r._rate_limit("login", "10.0.0.1", max_hits=3, window_s=60)
    # ...a different IP is unaffected...
    r._rate_limit("login", "10.0.0.2", max_hits=3, window_s=60)
    # ...and a different bucket for the same IP is independent.
    r._rate_limit("refresh", "10.0.0.1", max_hits=3, window_s=60)


def test_login_and_refresh_are_wired_to_limiter():
    """Guard against regressions: both sensitive endpoints must apply a limit."""
    import inspect
    r = _auth()
    login_src = inspect.getsource(r.login)
    refresh_src = inspect.getsource(r.refresh_token)
    assert "_rate_limit(" in login_src, "login must be rate-limited (ISSUE-006)"
    assert "_rate_limit(" in refresh_src, "refresh must be rate-limited (ISSUE-006)"
