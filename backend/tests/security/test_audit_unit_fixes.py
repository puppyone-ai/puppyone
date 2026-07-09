"""Hermetic unit tests for the audit fixes (ISSUE-007/009/011/013 + 002 helpers).

None of these touch Supabase, the network, or any external service — they
exercise pure functions, temp dirs, and in-process token crypto only. Safe to
run against any environment (including one whose .env points at a cloud DB
branch) because no DB client is ever constructed.
"""

from __future__ import annotations

import asyncio
import os
import time

import jwt
import pytest


# ── ISSUE-009: shared sandbox command policy ────────────────────────────────

class TestCommandPolicy:
    def _mod(self):
        from src.infra.sandbox import command_policy
        return command_policy

    @pytest.mark.parametrize("cmd", [
        "sudo rm -rf /",
        "cat /etc/passwd",
        "head /proc/self/environ",
        "ls /sys/",
        "cat /dev/mem",
        "curl http://169.254.169.254/latest/meta-data/",
        "mount /dev/sda1 /mnt",
        "reboot",
        "mkfs.ext4 /dev/sdb",
    ])
    def test_forbidden_commands_are_rejected(self, cmd):
        cp = self._mod()
        with pytest.raises(cp.SandboxCommandRejected):
            cp.assert_command_allowed(cmd)

    @pytest.mark.parametrize("cmd", [
        "jq '.' /workspace/data.json",
        "ls -la /workspace",
        "python3 process.py",
        "echo hello",
        "cat /workspace/notes.md",
    ])
    def test_benign_commands_are_allowed(self, cmd):
        cp = self._mod()
        cp.assert_command_allowed(cmd)  # must not raise

    def test_non_string_is_ignored(self):
        cp = self._mod()
        cp.assert_command_allowed(None)  # type: ignore[arg-type]


# ── ISSUE-013: CAS retry backoff ────────────────────────────────────────────

class TestCasBackoff:
    def test_first_attempt_does_not_sleep(self, monkeypatch):
        from src.version_engine.write_engine import cas_backoff as cb

        slept: list[float] = []

        async def fake_sleep(seconds):
            slept.append(seconds)

        monkeypatch.setattr(cb.asyncio, "sleep", fake_sleep)
        asyncio.run(cb.cas_backoff(0))
        assert slept == []  # attempt 0 => no delay

    def test_later_attempts_sleep_within_bounds(self, monkeypatch):
        from src.version_engine.write_engine import cas_backoff as cb

        slept: list[float] = []

        async def fake_sleep(seconds):
            slept.append(seconds)

        monkeypatch.setattr(cb.asyncio, "sleep", fake_sleep)
        for attempt in range(1, 6):
            asyncio.run(cb.cas_backoff(attempt))

        assert len(slept) == 5
        ceiling_s = cb._CAS_BACKOFF_MAX_MS / 1000.0
        for delay in slept:
            assert 0.0 <= delay <= ceiling_s + 1e-9


# ── ISSUE-007: MCP token expiry ─────────────────────────────────────────────

class TestMcpTokenExpiry:
    def _service(self):
        from src.infra.mcp_server.service import McpService
        # Token methods use only settings + jwt; the repo is never touched.
        return McpService(instance_repo=None)  # type: ignore[arg-type]

    def test_token_carries_exp_by_default(self, monkeypatch):
        from src.config import settings

        monkeypatch.setattr(settings, "MCP_TOKEN_TTL_SECONDS", 3600, raising=False)
        monkeypatch.setattr(settings, "JWT_SECRET", "x" * 40, raising=False)
        token = self._service().generate_mcp_token("u1", "p1", "t1", "")

        claims = jwt.decode(token, "x" * 40, algorithms=[settings.JWT_ALGORITHM])
        assert "exp" in claims
        assert "iat" in claims
        # exp ~ now + ttl (allow generous skew)
        assert abs(claims["exp"] - (time.time() + 3600)) < 120

    def test_ttl_zero_disables_expiry(self, monkeypatch):
        from src.config import settings

        monkeypatch.setattr(settings, "MCP_TOKEN_TTL_SECONDS", 0, raising=False)
        monkeypatch.setattr(settings, "JWT_SECRET", "x" * 40, raising=False)
        token = self._service().generate_mcp_token("u1", "p1", "t1", "")
        claims = jwt.decode(token, "x" * 40, algorithms=[settings.JWT_ALGORITHM])
        assert "exp" not in claims

    def test_expired_token_is_rejected(self, monkeypatch):
        from src.config import settings
        from src.exceptions import AuthException

        monkeypatch.setattr(settings, "JWT_SECRET", "x" * 40, raising=False)
        # Craft an already-expired token directly.
        expired = jwt.encode(
            {"user_id": "u", "project_id": "p", "table_id": "t",
             "json_pointer": "", "exp": int(time.time()) - 10},
            "x" * 40, algorithm=settings.JWT_ALGORITHM,
        )
        with pytest.raises(AuthException):
            self._service().decode_mcp_token(expired)


# ── ISSUE-002: credential masking helpers (pure) ────────────────────────────

class TestAccessListMaskingHelpers:
    def _mod(self):
        from src.connectors.manager import router
        return router

    def test_mask_key(self):
        r = self._mod()
        assert r._mask_key(None) == (False, None)
        assert r._mask_key("") == (False, None)
        has, last4 = r._mask_key("cli_abcdefgh1234")
        assert has is True and last4 == "1234"

    def test_redact_config_strips_secrets(self):
        r = self._mod()
        cfg = {
            "mcp_api_key": "secret",
            "api_key": "secret",
            "access_key": "secret",
            "token": "secret",
            "sync_url": "https://example.com",  # non-secret, kept
            "name": "my connector",             # kept
        }
        out = r._redact_config(cfg)
        assert "sync_url" in out and "name" in out
        for secret_key in ("mcp_api_key", "api_key", "access_key", "token"):
            assert secret_key not in out


# ── ISSUE-011: git view cache LRU prune ─────────────────────────────────────

class TestViewCachePrune:
    def _make_view(self, root, project, view_id, *, mtime, size_bytes=1024):
        view_dir = root / project / view_id
        view_dir.mkdir(parents=True, exist_ok=True)
        (view_dir / "view.json").write_text("{}", encoding="utf-8")
        (view_dir / "blob.bin").write_bytes(b"0" * size_bytes)
        # Control recency via view.json mtime.
        os.utime(view_dir / "view.json", (mtime, mtime))
        return view_dir

    def test_prunes_oldest_beyond_max_views(self, tmp_path, monkeypatch):
        from src.version_engine.adapters.git import view_cache
        from src.config import settings

        root = tmp_path / "cache"
        oldest = self._make_view(root, "projA", "v_old", mtime=1_000)
        middle = self._make_view(root, "projA", "v_mid", mtime=2_000)
        newest = self._make_view(root, "projA", "v_new", mtime=3_000)

        monkeypatch.setattr(view_cache, "git_view_cache_root", lambda: root)
        monkeypatch.setattr(settings, "GIT_VIEW_CACHE_MAX_VIEWS", 2, raising=False)
        monkeypatch.setattr(settings, "GIT_VIEW_CACHE_MAX_BYTES", 0, raising=False)

        view_cache.prune_git_view_cache(keep=newest)

        assert not oldest.exists(), "oldest view should be evicted"
        assert middle.exists()
        assert newest.exists(), "the just-written (keep) view must survive"

    def test_keep_dir_never_evicted_even_if_oldest(self, tmp_path, monkeypatch):
        from src.version_engine.adapters.git import view_cache
        from src.config import settings

        root = tmp_path / "cache"
        keep_old = self._make_view(root, "projA", "v_keep", mtime=1_000)  # oldest
        newer = self._make_view(root, "projA", "v_newer", mtime=5_000)

        monkeypatch.setattr(view_cache, "git_view_cache_root", lambda: root)
        monkeypatch.setattr(settings, "GIT_VIEW_CACHE_MAX_VIEWS", 1, raising=False)
        monkeypatch.setattr(settings, "GIT_VIEW_CACHE_MAX_BYTES", 0, raising=False)

        view_cache.prune_git_view_cache(keep=keep_old)

        assert keep_old.exists(), "keep dir must not be evicted"
        assert not newer.exists(), "non-keep view should be evicted to meet cap"

    def test_zero_caps_disable_pruning(self, tmp_path, monkeypatch):
        from src.version_engine.adapters.git import view_cache
        from src.config import settings

        root = tmp_path / "cache"
        v1 = self._make_view(root, "projA", "v1", mtime=1_000)
        v2 = self._make_view(root, "projA", "v2", mtime=2_000)

        monkeypatch.setattr(view_cache, "git_view_cache_root", lambda: root)
        monkeypatch.setattr(settings, "GIT_VIEW_CACHE_MAX_VIEWS", 0, raising=False)
        monkeypatch.setattr(settings, "GIT_VIEW_CACHE_MAX_BYTES", 0, raising=False)

        view_cache.prune_git_view_cache(keep=None)
        assert v1.exists() and v2.exists()
