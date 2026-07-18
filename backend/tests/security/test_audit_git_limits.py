"""ISSUE-014 — git transport input-size limits & subprocess timeout.

Hermetic: uses a fake Request (no ASGI server, no Supabase). The run_git
happy-path test shells out to the local `git` binary only.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException


class _FakeStreamRequest:
    """Minimal stand-in for starlette Request supporting async .stream()."""

    def __init__(self, chunks: list[bytes]):
        self._chunks = chunks

    async def stream(self):
        for chunk in self._chunks:
            yield chunk


class _FakeBodyRequest:
    def __init__(self, body: bytes, headers: dict | None = None):
        self._body = body
        self.headers = headers or {}

    async def body(self) -> bytes:
        return self._body


def _router():
    from src.version_engine.entrypoints.git import router
    return router


# ── _spool_git_request_body ─────────────────────────────────────────────────

def test_spool_rejects_body_over_cap_and_cleans_up(tmp_path, monkeypatch):
    router = _router()
    # Force spool files into tmp so we can assert cleanup.
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    monkeypatch.setenv("TEMP", str(tmp_path))
    monkeypatch.setenv("TMP", str(tmp_path))

    req = _FakeStreamRequest([b"a" * 600, b"b" * 600])  # 1200 bytes total

    with pytest.raises(HTTPException) as ei:
        asyncio.run(router._spool_git_request_body(req, max_body_bytes=1000))
    assert ei.value.status_code == 413
    # No partial spool file should be left behind.
    leftover = list(tmp_path.glob("puppyone-git-rpc-*"))
    assert leftover == [], f"partial spool not cleaned: {leftover}"


def test_spool_accepts_body_within_cap(tmp_path):
    router = _router()
    req = _FakeStreamRequest([b"hello ", b"world"])
    path = asyncio.run(router._spool_git_request_body(req, max_body_bytes=1000))
    try:
        assert Path(path).read_bytes() == b"hello world"
    finally:
        router._unlink_temp(Path(path))


def test_spool_unbounded_when_no_cap(tmp_path):
    router = _router()
    req = _FakeStreamRequest([b"x" * 5000])
    path = asyncio.run(router._spool_git_request_body(req, max_body_bytes=None))
    try:
        assert Path(path).stat().st_size == 5000
    finally:
        router._unlink_temp(Path(path))


# ── _read_capped_body ───────────────────────────────────────────────────────

def test_read_capped_rejects_declared_content_length():
    router = _router()
    req = _FakeBodyRequest(b"", headers={"content-length": "99999"})
    with pytest.raises(HTTPException) as ei:
        asyncio.run(router._read_capped_body(req, 1024))
    assert ei.value.status_code == 413


def test_read_capped_rejects_oversized_actual_body():
    router = _router()
    # Lies about / omits content-length but the real body is over the cap.
    req = _FakeBodyRequest(b"z" * 2000, headers={})
    with pytest.raises(HTTPException) as ei:
        asyncio.run(router._read_capped_body(req, 1024))
    assert ei.value.status_code == 413


def test_read_capped_allows_small_body():
    router = _router()
    req = _FakeBodyRequest(b"negotiation", headers={"content-length": "11"})
    body = asyncio.run(router._read_capped_body(req, 1024))
    assert body == b"negotiation"


# ── run_git timeout parameter ───────────────────────────────────────────────

def test_run_git_happy_path_with_timeout():
    """The new timeout kwarg must not break a normal fast git invocation."""
    from src.version_engine.adapters.git.protocol import run_git

    out = run_git(["--version"], timeout=30)
    assert b"git version" in out


def test_run_git_times_out(monkeypatch):
    """A tiny timeout on a hanging git process surfaces as RuntimeError."""
    import subprocess

    from src.version_engine.adapters.git import protocol

    def _boom(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="git", timeout=kwargs.get("timeout", 0))

    monkeypatch.setattr(protocol.subprocess, "run", _boom)
    with pytest.raises(RuntimeError, match="timed out"):
        protocol.run_git(["gc"], timeout=1)
