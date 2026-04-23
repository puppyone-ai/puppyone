"""Regression tests for bugs identified in mut-bug-checklist.md.

Each test class maps to a specific priority tier (P0, P1, P2).
Tests are designed to run against in-memory fakes — no database or S3 needed.

All identifiers in these tests are ``commit_id`` (16-hex SHA256 digests)
rather than integer version numbers.
"""

from __future__ import annotations

import json
import threading
from unittest.mock import MagicMock, patch

import pytest
from mut.core.object_store import ObjectStore
from mut.core.protocol import PROTOCOL_VERSION, PushResponse, RollbackResponse
from mut.core.scope import check_path_permission
from tests.mut_engine._handlers import handle_clone, handle_push, handle_rollback

from tests.mut_engine.test_server_repo import (
    FakeAuditManager,
    FakeHistoryManager,
)


# ══════════════════════════════════════════════════
# Shared fixtures & helpers
# ══════════════════════════════════════════════════

@pytest.fixture
def memory_store(tmp_path):
    obj_dir = tmp_path / "objects"
    obj_dir.mkdir()
    return ObjectStore(obj_dir)


@pytest.fixture
def server_repo(memory_store):
    from src.mut_engine.server.server_repo import PuppyOneServerRepo
    from mut.server.scope_manager import ScopeManager

    history = FakeHistoryManager()
    audit = FakeAuditManager()

    class FakeScopeBackend:
        def __init__(self):
            self._scopes = {}

        def get(self, sid):
            return self._scopes.get(sid)

        def put(self, sid, scope):
            self._scopes[sid] = scope

        def delete(self, sid):
            return self._scopes.pop(sid, None) is not None

        def list_all(self):
            return list(self._scopes.values())

    return PuppyOneServerRepo(
        project_id="test-proj",
        project_name="Test Project",
        store=memory_store,
        history=history,
        audit=audit,
        scopes=ScopeManager(FakeScopeBackend()),
    )


def _rw_auth(scope_path=""):
    return {
        "agent": "test-agent",
        "_scope": {
            "id": "test-scope",
            "path": scope_path,
            "exclude": [],
            "mode": "rw",
        },
    }


def _push_file(
    repo,
    auth,
    files: dict[str, bytes],
    base_commit_id: str = "",
) -> dict:
    """Push files through the MUT protocol handler and return the raw result."""
    from mut.foundation.hash import hash_bytes
    import base64

    objects: dict[str, bytes] = {}
    nested: dict = {}
    for path, content in files.items():
        blob_hash = hash_bytes(content)
        objects[blob_hash] = content
        parts = path.split("/")
        d = nested
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        d[parts[-1]] = ("B", blob_hash)

    def _build(node: dict) -> str:
        entries = {}
        for name, val in sorted(node.items()):
            if isinstance(val, tuple):
                entries[name] = list(val)
            else:
                entries[name] = ["T", _build(val)]
        data = json.dumps(entries, sort_keys=True).encode()
        h = hash_bytes(data)
        objects[h] = data
        return h

    root = _build(nested)
    objects_b64 = {h: base64.b64encode(d).decode() for h, d in objects.items()}
    body = {
        "protocol_version": PROTOCOL_VERSION,
        "base_commit_id": base_commit_id,
        "snapshots": [{
            "id": 1, "root": root, "message": "test",
            "who": "test", "time": "2026-01-01T00:00:00",
        }],
        "objects": objects_b64,
    }
    return handle_push(repo, auth, body)


# ══════════════════════════════════════════════════
# P0 — Data Safety (backend-side)
# ══════════════════════════════════════════════════

class TestP0_1_RollbackBehavior:
    """P0-1: Rollback basic behaviour — already-at-commit guard, new commits forward."""

    def test_rollback_already_at_commit(self, server_repo):
        auth = _rw_auth()
        r1 = _push_file(server_repo, auth, {"a.txt": b"v1"})
        result = handle_rollback(
            server_repo, auth, {"target_commit_id": r1["commit_id"]},
        )
        assert result["status"] == "already-at-commit"

    def test_rollback_creates_new_commit(self, server_repo):
        auth = _rw_auth()
        r1 = _push_file(server_repo, auth, {"a.txt": b"v1"})
        r2 = _push_file(
            server_repo, auth, {"a.txt": b"v2"},
            base_commit_id=r1["commit_id"],
        )
        assert r1["commit_id"] != r2["commit_id"]

        result = handle_rollback(
            server_repo, auth, {"target_commit_id": r1["commit_id"]},
        )
        assert result["status"] == "rolled-back"
        assert result["new_commit_id"]
        assert result["new_commit_id"] != r1["commit_id"]
        assert result["new_commit_id"] != r2["commit_id"]

    def test_rollback_invalid_commit_raises(self, server_repo):
        auth = _rw_auth()
        _push_file(server_repo, auth, {"a.txt": b"v1"})
        with pytest.raises(ValueError, match="not found"):
            handle_rollback(
                server_repo, auth, {"target_commit_id": "0000000000000000"},
            )


class TestP0_2_S3PutReRaise:
    """P0-2: S3StorageBackend.put must re-raise on failure."""

    def test_put_raises_on_failure(self):
        from src.mut_engine.server.backends.s3_storage import S3StorageBackend

        mock_s3 = MagicMock()
        backend = S3StorageBackend(mock_s3, "proj-1")

        async def fail_upload(*a, **kw):
            raise ConnectionError("S3 down")

        backend._do_put = MagicMock(side_effect=fail_upload)

        with pytest.raises(Exception):
            backend.put("abc123", b"data")


class TestP0_3_PushAndFinalize:
    """P0-3: push_and_finalize must call post-push hook after successful push."""

    @pytest.mark.asyncio
    async def test_hook_called_on_success(self):
        from src.mut_engine.services.hooks import push_and_finalize

        mock_client = MagicMock()
        mock_client.push.return_value = {
            "status": "ok",
            "commit_id": "deadbeefdeadbeef",
            "root": "abc",
        }

        mock_rm = MagicMock()

        with patch("src.mut_engine.services.hooks.run_post_push_hook") as mock_hook:
            result = await push_and_finalize(
                mock_client, "proj-1",
                repo_manager=mock_rm,
                modified={"a.txt": b"data"},
                message="test",
            )

        assert result["status"] == "ok"
        mock_hook.assert_called_once_with("proj-1", mock_rm, result)

    @pytest.mark.asyncio
    async def test_hook_not_called_on_failure(self):
        from src.mut_engine.services.hooks import push_and_finalize

        mock_client = MagicMock()
        mock_client.push.return_value = {"status": "conflict"}

        with patch("src.mut_engine.services.hooks.run_post_push_hook") as mock_hook:
            result = await push_and_finalize(
                mock_client, "proj-1",
                modified={"a.txt": b"data"},
            )

        assert result["status"] == "conflict"
        mock_hook.assert_not_called()

    @pytest.mark.asyncio
    async def test_hook_failure_does_not_propagate(self):
        from src.mut_engine.services.hooks import push_and_finalize

        mock_client = MagicMock()
        mock_client.push.return_value = {
            "status": "ok",
            "commit_id": "deadbeefdeadbeef",
            "root": "abc",
        }

        mock_rm = MagicMock()

        with patch("src.mut_engine.services.hooks.run_post_push_hook",
                    side_effect=RuntimeError("hook boom")):
            result = await push_and_finalize(
                mock_client, "proj-1",
                repo_manager=mock_rm,
                modified={"a.txt": b"data"},
            )

        assert result["status"] == "ok"


class TestP0_4_EphemeralClientMergeConsume:
    """P0-4: After server merge, EphemeralClient should call pull to refresh."""

    def test_push_updates_files_on_success(self, server_repo):
        """Basic push updates client files when no merge needed."""
        from src.mut_engine.services.ephemeral_client import MutEphemeralClient
        from src.mut_engine.server.repo_manager import MutRepoManager

        repo_manager = MagicMock(spec=MutRepoManager)
        repo_manager.get_server_repo.return_value = server_repo

        auth = _rw_auth()
        _push_file(server_repo, auth, {"initial.txt": b"init"})

        client = MutEphemeralClient(repo_manager, "test-proj", auth)
        client.clone()
        assert "initial.txt" in client.files

        result = client.push(modified={"mine.txt": b"my change"}, message="add mine")
        assert result.get("status") == "ok"
        assert "mine.txt" in client.files
        assert "initial.txt" in client.files

    def test_pull_called_when_merged(self, server_repo):
        """When push result has merged=True, client calls pull() to refresh."""
        from src.mut_engine.services.ephemeral_client import MutEphemeralClient
        from src.mut_engine.server.repo_manager import MutRepoManager

        repo_manager = MagicMock(spec=MutRepoManager)
        repo_manager.get_server_repo.return_value = server_repo

        auth = _rw_auth()
        _push_file(server_repo, auth, {"a.txt": b"v1"})

        client = MutEphemeralClient(repo_manager, "test-proj", auth)
        client.clone()

        original_pull = client.pull
        pull_called = False

        def tracking_pull():
            nonlocal pull_called
            pull_called = True
            return original_pull()

        client.pull = tracking_pull

        repo = server_repo
        original_handle_push = handle_push

        def mock_merge_push(r, a, body):
            result = original_handle_push(r, a, body)
            result["merged"] = True
            return result

        with patch(
            "src.mut_engine.services.ephemeral_client.handle_push",
            side_effect=mock_merge_push,
        ):
            client.push(modified={"b.txt": b"new"}, message="test merge")

        assert pull_called, \
            "client.pull() should be called when push result has merged=True"


# ══════════════════════════════════════════════════
# P1 — Security (backend-side)
# ══════════════════════════════════════════════════

class TestP1_1_ViewerRoleCannotWrite:
    """P1-1: ensure_write_access rejects viewer role."""

    def test_viewer_rejected(self):
        from src.mut_engine.routers._content_helpers import ensure_write_access
        from fastapi import HTTPException

        mock_svc = MagicMock()
        mock_svc.verify_project_access.return_value = "viewer"
        mock_user = MagicMock()
        mock_user.user_id = "u1"

        with pytest.raises(HTTPException) as exc_info:
            ensure_write_access(mock_svc, mock_user, "proj-1")
        assert exc_info.value.status_code == 403

    def test_editor_allowed(self):
        from src.mut_engine.routers._content_helpers import ensure_write_access

        mock_svc = MagicMock()
        mock_svc.verify_project_access.return_value = "editor"
        mock_user = MagicMock()
        mock_user.user_id = "u1"

        role = ensure_write_access(mock_svc, mock_user, "proj-1")
        assert role == "editor"

    def test_admin_allowed(self):
        from src.mut_engine.routers._content_helpers import ensure_write_access

        mock_svc = MagicMock()
        mock_svc.verify_project_access.return_value = "admin"
        mock_user = MagicMock()
        mock_user.user_id = "u1"

        role = ensure_write_access(mock_svc, mock_user, "proj-1")
        assert role == "admin"


class TestP1_2_ScopeFailClosed:
    """P1-2: Scope fallback must fail closed, not grant full access."""

    def test_missing_scope_raises_403(self):
        from src.mut_engine.server.auth import PuppyOneAuthenticator
        from fastapi import HTTPException

        authenticator = PuppyOneAuthenticator.__new__(PuppyOneAuthenticator)
        authenticator._client = MagicMock()

        conn = {"id": "conn-1", "config": {}}

        mock_manager = MagicMock()
        mock_manager.get_by_id.return_value = None

        with patch("mut.server.scope_manager.ScopeManager", return_value=mock_manager):
            with patch(
                "src.mut_engine.server.backends.supabase_scope.SupabaseScopeBackend"
            ):
                with patch("src.infra.supabase.client.SupabaseClient"):
                    with pytest.raises(HTTPException) as exc_info:
                        authenticator._resolve_scope(conn, "proj-1")
                    assert exc_info.value.status_code == 403

    def test_scope_with_config_fallback(self):
        """When ScopeManager returns None but config has scope, use it."""
        from src.mut_engine.server.auth import PuppyOneAuthenticator

        authenticator = PuppyOneAuthenticator.__new__(PuppyOneAuthenticator)
        authenticator._client = MagicMock()

        conn = {
            "id": "conn-1",
            "config": {"scope": {"path": "docs", "exclude": [], "mode": "r"}},
        }

        mock_manager = MagicMock()
        mock_manager.get_by_id.return_value = None

        with patch("mut.server.scope_manager.ScopeManager", return_value=mock_manager):
            with patch(
                "src.mut_engine.server.backends.supabase_scope.SupabaseScopeBackend"
            ):
                with patch("src.infra.supabase.client.SupabaseClient"):
                    scope = authenticator._resolve_scope(conn, "proj-1")
                    assert scope["path"] == "docs"
                    assert scope["mode"] == "r"


class TestP1_6_AccessKeyStatusCheck:
    """P1-6: Revoked or disabled access keys must be rejected."""

    def test_revoked_key_rejected(self):
        from src.mut_engine.server.auth import PuppyOneAuthenticator
        from fastapi import HTTPException

        authenticator = PuppyOneAuthenticator.__new__(PuppyOneAuthenticator)
        authenticator._client = MagicMock()
        authenticator._try_jwt = MagicMock(return_value=None)
        authenticator._try_access_key = MagicMock(return_value={
            "id": "conn-1",
            "revoked_at": "2026-01-01T00:00:00Z",
            "config": {},
        })

        # Force SKIP_AUTH off so we exercise the real auth branch — without
        # this, a developer with SKIP_AUTH=true in their .env would see this
        # test silently take the mock path and never test the revoke check.
        with patch("src.mut_engine.server.auth.settings") as mock_settings:
            mock_settings.SKIP_AUTH = False
            with pytest.raises(HTTPException) as exc_info:
                authenticator.authenticate("some-key", "proj-1")
            assert exc_info.value.status_code == 401
            assert "revoked" in exc_info.value.detail.lower()


class TestP1_7_SkipAuthGuard:
    """P1-7: SKIP_AUTH must never be honored outside development/test.

    Defense in depth, three layers:
      1. ``Settings.enforce_skip_auth_safety`` crashes startup if SKIP_AUTH=True
         in staging/production.
      2. ``mut_engine.server.auth.PuppyOneAuthenticator.authenticate`` raises 500
         if it ever observes SKIP_AUTH with non-dev APP_ENV (e.g., bypassed validator).
      3. ``platform.auth.dependencies._assert_skip_auth_safe`` does the same
         for the platform JWT pipeline.

    The original test was a "false green" — it mocked ``settings.ENVIRONMENT``,
    an attribute that doesn't exist (the real field is ``APP_ENV``). So the
    env check always saw an empty string and SKIP_AUTH actually returned the
    mock unconditionally. These tests use the correct attribute.
    """

    def test_skip_auth_returns_mock_in_dev(self):
        from src.mut_engine.server.auth import PuppyOneAuthenticator

        authenticator = PuppyOneAuthenticator.__new__(PuppyOneAuthenticator)
        authenticator._client = MagicMock()

        with patch("src.mut_engine.server.auth.settings") as mock_settings:
            mock_settings.SKIP_AUTH = True
            mock_settings.APP_ENV = "development"
            result = authenticator.authenticate("any", "proj-1")
            assert result["agent"] == "user:mock"
            assert result["_scope"]["mode"] == "rw"

    def test_skip_auth_returns_mock_in_test_env(self):
        from src.mut_engine.server.auth import PuppyOneAuthenticator

        authenticator = PuppyOneAuthenticator.__new__(PuppyOneAuthenticator)
        authenticator._client = MagicMock()

        with patch("src.mut_engine.server.auth.settings") as mock_settings:
            mock_settings.SKIP_AUTH = True
            mock_settings.APP_ENV = "test"
            result = authenticator.authenticate("any", "proj-1")
            assert result["agent"] == "user:mock"

    @pytest.mark.parametrize("env", ["staging", "production"])
    def test_mut_auth_refuses_skip_auth_in_non_dev_env(self, env):
        """Deep defense: even if config validator was bypassed (e.g., monkey-patched
        for a test), the MUT authenticate path itself must refuse to mock auth in
        a non-dev environment.
        """
        from fastapi import HTTPException

        from src.mut_engine.server.auth import PuppyOneAuthenticator

        authenticator = PuppyOneAuthenticator.__new__(PuppyOneAuthenticator)
        authenticator._client = MagicMock()

        with patch("src.mut_engine.server.auth.settings") as mock_settings:
            mock_settings.SKIP_AUTH = True
            mock_settings.APP_ENV = env
            with pytest.raises(HTTPException) as exc_info:
                authenticator.authenticate("any", "proj-1")
            assert exc_info.value.status_code == 500
            assert "SKIP_AUTH" in exc_info.value.detail

    @pytest.mark.parametrize("env", ["staging", "production"])
    def test_platform_auth_refuses_skip_auth_in_non_dev_env(self, env):
        """Deep defense for platform JWT pipeline: same guarantee for
        ``get_current_user`` / ``get_current_user_optional``.
        """
        from fastapi import HTTPException

        from src.platform.auth.dependencies import _assert_skip_auth_safe

        with patch("src.platform.auth.dependencies.settings") as mock_settings:
            mock_settings.SKIP_AUTH = True
            mock_settings.APP_ENV = env
            with pytest.raises(HTTPException) as exc_info:
                _assert_skip_auth_safe()
            assert exc_info.value.status_code == 500
            assert "SKIP_AUTH" in exc_info.value.detail

    @pytest.mark.parametrize("env", ["staging", "production"])
    def test_settings_refuses_to_boot_with_skip_auth_in_non_dev(self, env, monkeypatch):
        """Layer 1 (the strongest): Settings refuses to construct at all."""
        for var in ("SKIP_AUTH", "APP_ENV", "ENVIRONMENT"):
            monkeypatch.delenv(var, raising=False)
        monkeypatch.setenv("SKIP_AUTH", "true")
        monkeypatch.setenv("APP_ENV", env)

        from src.config import Settings

        with pytest.raises(ValueError, match="SKIP_AUTH"):
            Settings(_env_file=None)

    @pytest.mark.parametrize("env", ["development", "test"])
    def test_settings_allows_skip_auth_in_dev_test(self, env, monkeypatch):
        for var in ("SKIP_AUTH", "APP_ENV", "ENVIRONMENT"):
            monkeypatch.delenv(var, raising=False)
        monkeypatch.setenv("SKIP_AUTH", "true")
        monkeypatch.setenv("APP_ENV", env)

        from src.config import Settings

        s = Settings(_env_file=None)
        assert s.SKIP_AUTH is True
        assert s.APP_ENV == env


class TestP1_8_UserIdentityRequired:
    """P1-8: When user_identity is configured, X-Mut-User header is mandatory."""

    def test_bound_identity_requires_header(self):
        from src.mut_engine.server.auth import PuppyOneAuthenticator
        from fastapi import HTTPException

        authenticator = PuppyOneAuthenticator.__new__(PuppyOneAuthenticator)
        authenticator._client = MagicMock()

        conn = {
            "id": "conn-1",
            "revoked_at": None,
            "config": {"user_identity": "alice@example.com"},
        }

        authenticator._try_jwt = MagicMock(return_value=None)
        authenticator._try_access_key = MagicMock(return_value=conn)

        with patch("src.mut_engine.server.auth.settings") as mock_settings:
            mock_settings.SKIP_AUTH = False
            with pytest.raises(HTTPException) as exc_info:
                authenticator.authenticate("some-key", "proj-1", user_identity="")
            assert exc_info.value.status_code == 401
            assert "X-Mut-User" in exc_info.value.detail

    def test_mismatched_identity_rejected(self):
        from src.mut_engine.server.auth import PuppyOneAuthenticator
        from fastapi import HTTPException

        authenticator = PuppyOneAuthenticator.__new__(PuppyOneAuthenticator)
        authenticator._client = MagicMock()

        conn = {
            "id": "conn-1",
            "revoked_at": None,
            "config": {"user_identity": "alice@example.com"},
        }

        authenticator._try_jwt = MagicMock(return_value=None)
        authenticator._try_access_key = MagicMock(return_value=conn)

        with patch("src.mut_engine.server.auth.settings") as mock_settings:
            mock_settings.SKIP_AUTH = False
            with pytest.raises(HTTPException) as exc_info:
                authenticator.authenticate(
                    "some-key", "proj-1", user_identity="bob@example.com",
                )
            assert exc_info.value.status_code == 401
            assert "mismatch" in exc_info.value.detail.lower()


# ══════════════════════════════════════════════════
# P2 — Robustness & Performance (backend-side)
# ══════════════════════════════════════════════════

class TestP2_1_CacheThreadSafety:
    """P2-1: CachedStorageBackend must be thread-safe."""

    def test_concurrent_get_put(self):
        from src.mut_engine.server.backends.s3_storage import CachedStorageBackend
        from mut.core.object_store import StorageBackend

        class MemoryBackend(StorageBackend):
            def __init__(self):
                self._data = {}
            def get(self, h):
                return self._data[h]
            def put(self, h, data):
                self._data[h] = data
            def exists(self, h):
                return h in self._data
            def all_hashes(self):
                return list(self._data.keys())
            def count(self):
                return len(self._data), 0
            def delete(self, h):
                self._data.pop(h, None)
                return True

        inner = MemoryBackend()
        cached = CachedStorageBackend(inner)

        errors = []

        def writer(idx):
            try:
                h = f"hash_{idx:04d}"
                data = f"data_{idx}".encode()
                inner._data[h] = data
                cached.put(h, data)
                result = cached.get(h)
                assert result == data
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(i,)) for i in range(50)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert not errors, f"Thread safety errors: {errors}"


class TestP2_5_ReadFileNavigates:
    """P2-5: read_file should navigate O(depth), not flatten O(total files)."""

    def test_read_uses_navigation(self, memory_store):
        from src.mut_engine.services.tree_reader import MutTreeReader
        from src.mut_engine.server.repo_manager import MutRepoManager

        blob_hash = memory_store.put(b"hello")
        inner_tree = json.dumps({"file.md": ["B", blob_hash]}, sort_keys=True).encode()
        inner_hash = memory_store.put(inner_tree)
        root_tree = json.dumps({"docs": ["T", inner_hash]}, sort_keys=True).encode()
        root_hash = memory_store.put(root_tree)

        mock_history = FakeHistoryManager()
        mock_history.set_root_hash(root_hash)

        class FakeProjectRepo:
            store = memory_store
            history = mock_history

        mock_repos = MagicMock(spec=MutRepoManager)
        mock_repos.get_repo.return_value = FakeProjectRepo()

        reader = MutTreeReader(mock_repos)
        content = reader.read_file("test-proj", "docs/file.md")
        assert content == b"hello"

    def test_read_nonexistent_returns_none(self, memory_store):
        from src.mut_engine.services.tree_reader import MutTreeReader
        from src.mut_engine.server.repo_manager import MutRepoManager

        root_tree = json.dumps({}, sort_keys=True).encode()
        root_hash = memory_store.put(root_tree)

        mock_history = FakeHistoryManager()
        mock_history.set_root_hash(root_hash)

        class FakeProjectRepo:
            store = memory_store
            history = mock_history

        mock_repos = MagicMock(spec=MutRepoManager)
        mock_repos.get_repo.return_value = FakeProjectRepo()

        reader = MutTreeReader(mock_repos)
        with pytest.raises(FileNotFoundError):
            reader.read_file("test-proj", "ghost.txt")


class TestP2_7_TrashReturns404:
    """P2-7: Trashing a nonexistent file should raise FileNotFoundError."""

    @pytest.mark.asyncio
    async def test_trash_missing_path_raises(self, server_repo):
        from src.mut_engine.services.ops import MutOps
        from src.mut_engine.server.repo_manager import MutRepoManager

        mock_repos = MagicMock(spec=MutRepoManager)
        mock_repos.get_server_repo.return_value = server_repo

        ops = MutOps(mock_repos)
        with pytest.raises(FileNotFoundError):
            await ops.trash("test-proj", "nonexistent.txt", who="test")


class TestP2_10_HookExceptionLogging:
    """P2-10: MutOps _run_post_push_hook must log exceptions with context.

    Failures here mean the global ``root_hash`` did not get the new scope's
    subtree grafted in — a data-consistency drift, not a transient annoyance.
    The hook logs at ERROR with project_id, commit_id, scope_path and a
    full stack trace so the drift can be diagnosed from logs alone.
    """

    def test_hook_logs_error_with_context_on_failure(self, server_repo):
        from src.mut_engine.services.ops import MutOps
        from src.mut_engine.server.repo_manager import MutRepoManager

        mock_repos = MagicMock(spec=MutRepoManager)
        mock_repos.get_server_repo.return_value = server_repo

        ops = MutOps(mock_repos)

        push_result = {
            "status": "ok",
            "commit_id": "deadbeefdeadbeef",
            "scope_path": "docs",
            "root": "abc",
        }

        with patch(
            "src.mut_engine.services.hooks.run_post_push_hook",
            side_effect=RuntimeError("graft failed"),
        ):
            with patch("src.utils.logger.log_error") as mock_log:
                ops._run_post_push_hook("proj-1", push_result)
                joined = "\n".join(str(c) for c in mock_log.call_args_list)
                assert "graft failed" in joined, "log must include the error message"
                assert "proj-1" in joined, "log must include project_id"
                assert "deadbeefdeadbeef" in joined, "log must include commit_id"
                assert "docs" in joined, "log must include scope_path"
                assert "Traceback" in joined, "log must include a stack trace"


# ══════════════════════════════════════════════════
# Hooks module — internal helpers
# ══════════════════════════════════════════════════

class TestHooksHelpers:
    """Test hook utility functions in hooks.py."""

    def test_path_matches_any_exact(self):
        from src.mut_engine.services.hooks import _path_matches_any
        assert _path_matches_any("docs/readme.md", ["docs/readme.md"]) is True

    def test_path_matches_any_child(self):
        from src.mut_engine.services.hooks import _path_matches_any
        assert _path_matches_any("docs/sub/file.md", ["docs"]) is True

    def test_path_matches_any_no_match(self):
        from src.mut_engine.services.hooks import _path_matches_any
        assert _path_matches_any("src/main.py", ["docs"]) is False

    def test_rewrite_path_exact(self):
        from src.mut_engine.services.hooks import _rewrite_path
        assert _rewrite_path("old/path", "old/path", "new/path") == "new/path"

    def test_rewrite_path_child(self):
        from src.mut_engine.services.hooks import _rewrite_path
        assert _rewrite_path("old/path/sub/file", "old/path", "new/loc") == "new/loc/sub/file"

    def test_rewrite_path_no_match(self):
        from src.mut_engine.services.hooks import _rewrite_path
        assert _rewrite_path("other/path", "old/path", "new/path") == "other/path"

    def test_build_move_updates_path(self):
        from src.mut_engine.services.hooks import _build_move_updates
        row = {"path": "docs/readme.md", "config": {}}
        updates = _build_move_updates(row, "docs", "documentation")
        assert updates["path"] == "documentation/readme.md"

    def test_build_move_updates_scope(self):
        from src.mut_engine.services.hooks import _build_move_updates
        row = {
            "path": None,
            "config": {"scope": {"path": "docs/sub", "exclude": []}},
        }
        updates = _build_move_updates(row, "docs", "documentation")
        assert updates["config"]["scope"]["path"] == "documentation/sub"


# ══════════════════════════════════════════════════
# Rollback → hook integration
# ══════════════════════════════════════════════════

class TestRollbackHookIntegration:
    """run_post_push_hook must accept rollback result format and graft root."""

    def test_hook_accepts_rollback_status(self):
        """Hook must not early-return on status='rolled-back'."""
        from src.mut_engine.services.hooks import run_post_push_hook

        mock_repo = MagicMock()
        mock_repo.history.get_entry.return_value = {
            "scope_path": "", "changes": [],
        }
        mock_repo.get_root_hash.return_value = "old_root"
        mock_repo.cas_update_root_hash.return_value = True

        mock_rm = MagicMock()
        mock_rm.get_server_repo.return_value = mock_repo

        rollback_result = {
            "status": "rolled-back",
            "new_commit_id": "cafe000000000003",
            "target_commit_id": "cafe000000000001",
            "root": "new_scope_hash",
        }

        with patch(
            "src.mut_engine.services.hooks._build_root_from_scope_state",
            return_value="new_global_root",
        ):
            run_post_push_hook("proj-1", mock_rm, rollback_result)

        mock_repo.cas_update_root_hash.assert_called_once()

    def test_hook_uses_new_commit_id_field(self):
        """Hook must read new_commit_id (not version) from rollback results."""
        from src.mut_engine.services.hooks import run_post_push_hook

        mock_repo = MagicMock()
        mock_repo.history.get_entry.return_value = {
            "scope_path": "docs", "changes": [],
        }
        mock_repo.get_root_hash.return_value = "old"
        mock_repo.cas_update_root_hash.return_value = True

        mock_rm = MagicMock()
        mock_rm.get_server_repo.return_value = mock_repo

        rollback_result = {
            "status": "rolled-back",
            "new_commit_id": "cafe000000000005",
            "root": "abc",
        }

        with patch(
            "src.mut_engine.services.hooks._build_root_from_scope_state",
            return_value="new",
        ):
            run_post_push_hook("proj-1", mock_rm, rollback_result)

        mock_repo.history.get_entry.assert_called_with("cafe000000000005")

    def test_hook_still_ignores_non_success(self):
        """Hook must still skip non-success statuses."""
        from src.mut_engine.services.hooks import run_post_push_hook

        mock_rm = MagicMock()
        run_post_push_hook("proj-1", mock_rm, {"status": "conflict"})
        mock_rm.get_repo.assert_not_called()

        run_post_push_hook("proj-1", mock_rm, {"status": "already-at-commit"})
        mock_rm.get_repo.assert_not_called()


class TestGraftEmptyRootCAS:
    """CAS must use the actual DB value (empty string), not a fabricated hash."""

    def test_cas_against_empty_string(self):
        from src.mut_engine.services.hooks import _update_global_root

        mock_repo = MagicMock()
        mock_repo.get_root_hash.return_value = ""
        mock_repo.cas_update_root_hash.return_value = True

        push_result = {"commit_id": "cafe000000000001", "root": "scope_hash"}
        mock_repo.history.get_entry.return_value = {
            "scope_path": "", "changes": [],
        }

        with patch(
            "src.mut_engine.services.hooks._build_root_from_scope_state",
            return_value="new_root",
        ):
            _update_global_root(mock_repo, push_result)

        mock_repo.cas_update_root_hash.assert_called_once_with("", "new_root")

    def test_cas_against_existing_hash(self):
        """When root already exists, CAS should use that existing hash."""
        from src.mut_engine.services.hooks import _update_global_root

        mock_repo = MagicMock()
        mock_repo.get_root_hash.return_value = "existing_root"
        mock_repo.cas_update_root_hash.return_value = True

        push_result = {"commit_id": "cafe000000000001", "root": "scope_hash"}
        mock_repo.history.get_entry.return_value = {
            "scope_path": "docs", "changes": [],
        }

        with patch(
            "src.mut_engine.services.hooks._build_root_from_scope_state",
            return_value="new_root",
        ):
            _update_global_root(mock_repo, push_result)

        mock_repo.cas_update_root_hash.assert_called_once_with(
            "existing_root", "new_root",
        )


# ══════════════════════════════════════════════════
# P0-5 (architectural) — DB-authoritative graft
# ══════════════════════════════════════════════════

class TestGraftFromDBState:
    """``_build_root_from_scope_state`` must rebuild the root tree from
    DB scope state (mut_scope_state) instead of reading the previous
    root tree from S3.

    This closes the silent-overwrite class of bugs: even if the previous
    root tree is missing or partially readable in S3, we recover the
    correct root from the DB SoT.
    """

    def test_empty_state_yields_empty_tree(self, server_repo):
        """No scopes pushed → root is the empty tree object."""
        from src.mut_engine.services.hooks import _build_root_from_scope_state

        new_root = _build_root_from_scope_state(server_repo, "", "")

        assert server_repo.store.exists(new_root)
        assert json.loads(server_repo.store.get(new_root)) == {}

    def test_single_root_scope_uses_root_tree_directly(self, server_repo):
        """When only the root scope exists, graft returns its own tree."""
        from src.mut_engine.services.hooks import _build_root_from_scope_state

        auth = _rw_auth()
        r1 = _push_file(server_repo, auth, {"README.md": b"hello"})

        new_root = _build_root_from_scope_state(server_repo, "", r1["root"])

        assert new_root == r1["root"]

    def test_sibling_scope_overlaid_on_root(self, server_repo):
        """A non-root scope's hash must be spliced into root tree at its path."""
        from mut.core.tree import read_tree
        from src.mut_engine.services.hooks import _build_root_from_scope_state

        root_auth = _rw_auth()
        _push_file(server_repo, root_auth, {"README.md": b"top-level"})

        docs_auth = _rw_auth("docs")
        r_docs = _push_file(server_repo, docs_auth, {"index.md": b"docs"})

        new_root = _build_root_from_scope_state(
            server_repo, "docs", r_docs["root"],
        )

        entries = read_tree(server_repo.store, new_root)
        assert "README.md" in entries, "root scope file must survive"
        assert entries["docs"][1] == r_docs["root"], (
            "docs/ entry must point at the docs scope hash"
        )

    def test_three_scopes_overlay_in_path_depth_order(self, server_repo):
        """Deeper scopes overlay AFTER their parents so the splice lands
        on the freshly grafted parent tree.
        """
        from mut.core.tree import read_tree
        from src.mut_engine.services.hooks import _build_root_from_scope_state

        _push_file(server_repo, _rw_auth(), {"top.txt": b"r"})
        _push_file(server_repo, _rw_auth("src"), {"main.py": b"src"})
        r_front = _push_file(
            server_repo, _rw_auth("src/frontend"), {"app.tsx": b"frontend"},
        )

        new_root = _build_root_from_scope_state(
            server_repo, "src/frontend", r_front["root"],
        )

        root_entries = read_tree(server_repo.store, new_root)
        assert root_entries["top.txt"][0] == "B", "root scope's file persists"

        src_entries = read_tree(server_repo.store, root_entries["src"][1])
        assert "main.py" in src_entries, (
            "src scope's own files must remain after the deeper graft"
        )
        assert src_entries["frontend"][1] == r_front["root"], (
            "src/frontend must point at the frontend scope hash"
        )

    def test_just_pushed_hash_overrides_db_value(self, server_repo):
        """The freshly pushed hash takes precedence over the DB snapshot.

        Models the retry scenario where a sibling scope's CAS races
        between our DB SELECT and our build: we still trust the value
        the push handler just returned for our own scope.
        """
        from mut.core.tree import read_tree
        from src.mut_engine.services.hooks import _build_root_from_scope_state

        _push_file(server_repo, _rw_auth("docs"), {"a.md": b"db-state"})
        fake_new_hash = "deadbeef" * 8

        new_root = _build_root_from_scope_state(
            server_repo, "docs", fake_new_hash,
        )

        entries = read_tree(server_repo.store, new_root)
        assert entries["docs"][1] == fake_new_hash, (
            "freshly pushed hash must override the DB-returned value"
        )

    def test_does_not_read_previous_root_tree_from_s3(self, server_repo):
        """Even if projects.mut_root_hash is corrupt, new root is still
        rebuilt cleanly from DB scope state.

        This is the P0-5 regression: previously, graft followed the
        chain ``projects.mut_root_hash → S3 root tree → splice → new
        root``. A bad read at the S3 step produced a partial tree that
        CAS happily wrote. The new graft never reads ``mut_root_hash``
        from S3 at all.
        """
        from src.mut_engine.services.hooks import _build_root_from_scope_state

        auth = _rw_auth("docs")
        r = _push_file(server_repo, auth, {"hello.md": b"hi"})

        server_repo.history.set_root_hash(
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        )

        new_root = _build_root_from_scope_state(
            server_repo, "docs", r["root"],
        )

        from mut.core.tree import read_tree
        entries = read_tree(server_repo.store, new_root)
        assert entries["docs"][1] == r["root"]


# ══════════════════════════════════════════════════
# P0-5 — Chaos / fault injection
#
# These tests answer "what happens if S3 dies mid-graft?".
# The answer must be: raise loudly, retry, then leave mut_root_hash
# UNCHANGED — never silently overwrite with a partial/empty root.
# (That was the entire bug class P0-5 closes.)
# ══════════════════════════════════════════════════


class _FaultyStoreWrapper:
    """Wrap a real ObjectStore and inject failures on `get`.

    `fail_on(predicate)` lets the test decide which hashes blow up
    and how (e.g. always, first N reads, only on a specific hash).
    Writes (`put`/`exists`) pass through untouched so we can still
    set up state cleanly.
    """

    def __init__(self, real_store, predicate):
        self._real = real_store
        self._predicate = predicate
        self.get_calls: list[str] = []

    def get(self, h: str) -> bytes:
        self.get_calls.append(h)
        if self._predicate(h, len(self.get_calls)):
            raise IOError(
                f"simulated S3 outage on hash {h[:12]}…"
            )
        return self._real.get(h)

    def put(self, data: bytes) -> str:
        return self._real.put(data)

    def exists(self, h: str) -> bool:
        return self._real.exists(h)

    def __getattr__(self, name):
        return getattr(self._real, name)


class TestGraftFaultInjection:
    """Inject S3 / store failures during graft and assert fail-loud
    behaviour: never overwrite ``mut_root_hash`` with partial data.

    Note on what we inject failures into:
        ``graft_subtree(store, base_root, "docs", scope_hash)`` reads
        ``base_root``'s tree object to find the splice point. It does
        NOT need to read ``scope_hash`` — the hash itself is the proof
        of identity for that subtree (Merkle property). So fault
        injection targets the **base root tree** (i.e. the root scope's
        tree we're overlaying onto), which is the only real S3 read on
        the hot path.
    """

    def test_s3_outage_during_overlay_raises(self, server_repo):
        """If reading the base root tree fails mid-graft, the helper
        must raise — NOT return a partial tree that omits the
        unreadable scope. (Old ``_safe_flatten`` swallowed errors and
        returned ``{}``, which is exactly the silent-overwrite path.)
        """
        from src.mut_engine.services.hooks import _build_root_from_scope_state

        r_root = _push_file(server_repo, _rw_auth(), {"top.txt": b"r"})
        r_docs = _push_file(server_repo, _rw_auth("docs"), {"a.md": b"x"})

        target = r_root["root"]
        server_repo.store = _FaultyStoreWrapper(
            server_repo.store,
            predicate=lambda h, _n: h == target,
        )

        with pytest.raises(IOError, match="simulated S3 outage"):
            _build_root_from_scope_state(server_repo, "docs", r_docs["root"])

    def test_s3_outage_does_not_overwrite_root_hash(self, server_repo):
        """End-to-end: ``_update_global_root`` retries 5× under store
        failure, then logs ERROR — but ``projects.mut_root_hash`` MUST
        keep its previous value. No silent overwrite to empty/partial.

        This is THE regression test for P0-5: under the old graft path,
        a flaky S3 read would silently produce a tree missing every
        scope outside the just-pushed one, and CAS would happily write
        it. Now that path doesn't exist; if S3 misbehaves, we leave
        the root pointer alone and surface the failure.
        """
        from src.mut_engine.services.hooks import (
            _update_global_root,
            run_post_push_hook,
        )
        from src.mut_engine.server.repo_manager import MutRepoManager

        mock_rm = MagicMock(spec=MutRepoManager)
        mock_rm.get_server_repo.return_value = server_repo

        r_root = _push_file(server_repo, _rw_auth(), {"top.txt": b"original"})
        run_post_push_hook("test-proj", mock_rm, r_root)

        healthy_root = server_repo.get_root_hash()
        assert healthy_root, "fixture sanity: first push must set root_hash"

        r_docs = _push_file(server_repo, _rw_auth("docs"), {"a.md": b"new"})

        target = r_root["root"]
        faulty = _FaultyStoreWrapper(
            server_repo.store,
            predicate=lambda h, _n: h == target,
        )
        server_repo.store = faulty

        with patch("src.mut_engine.services.hooks.log_error") as mock_err:
            _update_global_root(
                server_repo,
                {"commit_id": r_docs["commit_id"], "root": r_docs["root"]},
            )

        assert server_repo.get_root_hash() == healthy_root, (
            "FATAL: mut_root_hash was overwritten despite all retries failing — "
            "the silent-overwrite bug (P0-5) is back"
        )

        get_attempts_on_target = sum(1 for h in faulty.get_calls if h == target)
        assert get_attempts_on_target >= 5, (
            f"expected ≥5 retries on the failing read, got "
            f"{get_attempts_on_target} — the retry loop didn't actually run"
        )

        assert mock_err.called, (
            "5 failed retries must surface as a log_error so ops can investigate"
        )
        err_msg = " ".join(str(c) for c in mock_err.call_args_list)
        assert "Graft failed" in err_msg, (
            f"log_error must mention the graft failure; got: {err_msg!r}"
        )

    def test_transient_outage_recovers_on_retry(self, server_repo):
        """First 2 reads of the base root tree fail (transient blip);
        3rd succeeds. ``_update_global_root`` must retry, eventually
        write the correct root, and end up with the scope visible at
        its path — transient failures don't lose data either.
        """
        from mut.core.tree import read_tree
        from src.mut_engine.server.repo_manager import MutRepoManager
        from src.mut_engine.services.hooks import (
            _update_global_root,
            run_post_push_hook,
        )

        mock_rm = MagicMock(spec=MutRepoManager)
        mock_rm.get_server_repo.return_value = server_repo

        r_root = _push_file(server_repo, _rw_auth(), {"top.txt": b"x"})
        run_post_push_hook("test-proj", mock_rm, r_root)

        r_docs = _push_file(server_repo, _rw_auth("docs"), {"a.md": b"new"})

        target = r_root["root"]
        fail_counter = {"hits": 0}

        def predicate(h, _n):
            if h != target:
                return False
            fail_counter["hits"] += 1
            return fail_counter["hits"] <= 2

        faulty = _FaultyStoreWrapper(server_repo.store, predicate)
        server_repo.store = faulty

        _update_global_root(
            server_repo,
            {"commit_id": r_docs["commit_id"], "root": r_docs["root"]},
        )

        new_root = server_repo.get_root_hash()
        real_store = faulty._real
        entries = read_tree(real_store, new_root)
        assert entries["docs"][1] == r_docs["root"], (
            "after recovery, docs scope must be wired into root correctly"
        )
        assert entries["top.txt"][0] == "B", (
            "root scope's own files must survive the retry path too"
        )
        assert fail_counter["hits"] >= 3, (
            f"test invariant: predicate should have been hit at least 3× "
            f"(2 failures + ≥1 success), got {fail_counter['hits']}"
        )


class TestRollbackEndToEnd:
    """Full rollback → graft → clone cycle with in-memory fakes."""

    def test_rollback_grafted_to_global_root(self, server_repo, memory_store):
        from src.mut_engine.services.hooks import run_post_push_hook
        from src.mut_engine.server.repo_manager import MutRepoManager

        mock_rm = MagicMock(spec=MutRepoManager)
        mock_rm.get_server_repo.return_value = server_repo

        auth = _rw_auth()

        r1 = _push_file(server_repo, auth, {"a.txt": b"version-1"})
        run_post_push_hook("test-proj", mock_rm, r1)

        r2 = _push_file(
            server_repo, auth, {"a.txt": b"version-2"},
            base_commit_id=r1["commit_id"],
        )
        run_post_push_hook("test-proj", mock_rm, r2)

        root_before = server_repo.history.get_root_hash()
        assert root_before, "root_hash should be set after push+graft"

        rollback_result = handle_rollback(
            server_repo, auth, {"target_commit_id": r1["commit_id"]},
        )
        assert rollback_result["status"] == "rolled-back"
        assert rollback_result.get("root"), "rollback must return root for grafting"

        run_post_push_hook("test-proj", mock_rm, rollback_result)

        root_after = server_repo.history.get_root_hash()
        assert root_after != root_before, "root_hash must change after rollback graft"

        clone_result = handle_clone(server_repo, auth, {})
        cloned_files = {
            path: __import__("base64").b64decode(b64)
            for path, b64 in clone_result.get("files", {}).items()
        }
        assert cloned_files.get("a.txt") == b"version-1", \
            "After rollback to r1, clone must return version-1 content"


# ══════════════════════════════════════════════════
# Mut library compatibility — basic API surface
# ══════════════════════════════════════════════════

class TestMutaiCompat:
    """Verify the installed mut library exposes required APIs."""

    def test_push_response_has_merged_changes(self):
        resp = PushResponse(status="ok", commit_id="cafe000000000001")
        assert isinstance(resp.merged_changes, list)

    def test_push_response_has_root(self):
        resp = PushResponse(status="ok", commit_id="cafe000000000001", root="abc123")
        d = resp.to_dict()
        assert d.get("root") == "abc123"

    def test_push_response_exposes_commit_id(self):
        resp = PushResponse(status="ok", commit_id="cafe000000000001")
        d = resp.to_dict()
        assert d.get("commit_id") == "cafe000000000001"

    def test_graft_or_merge_subtree_exists(self):
        from mut.server.graft import graft_or_merge_subtree
        assert callable(graft_or_merge_subtree)

    def test_push_handler_module_has_cas(self):
        """The handlers module must reference cas_update_scope."""
        import inspect
        from mut.server import handlers as h
        source = inspect.getsource(h)
        assert "cas_update_scope" in source

    def test_rollback_response_has_root(self):
        resp = RollbackResponse(status="ok", root="abc123")
        d = resp.to_dict()
        assert d.get("root") == "abc123"

    def test_rollback_response_exposes_new_commit_id(self):
        resp = RollbackResponse(
            status="rolled-back",
            new_commit_id="cafe000000000002",
            target_commit_id="cafe000000000001",
        )
        d = resp.to_dict()
        assert d.get("new_commit_id") == "cafe000000000002"
        assert d.get("target_commit_id") == "cafe000000000001"

    def test_flatten_tree_exposed(self):
        from mut.server.graft import _flatten_tree
        assert callable(_flatten_tree)

    def test_rollback_uses_cas_not_direct_set(self):
        """handle_rollback should use CAS via _rollback_cas_attempt."""
        import inspect
        from mut.server.handlers import _rollback_cas_attempt
        src = inspect.getsource(_rollback_cas_attempt)
        assert "cas_update_scope" in src
        assert "set_scope_hash" not in src


# ══════════════════════════════════════════════════
# Scope path traversal (depends on mut library)
# ══════════════════════════════════════════════════

class TestScopePathTraversal:
    """P2-8: '..' segments in file paths must not escape scope."""

    def test_dotdot_escape_blocked(self):
        scope = {"path": "src", "exclude": [], "mode": "rw"}
        # normalize_path raises ValueError for '..' segments (P2-8 fix)
        try:
            result = check_path_permission(scope, "src/../secrets/key")
            assert result is False
        except ValueError:
            pass  # ValueError from normalize_path is also acceptable

    def test_within_scope_allowed(self):
        scope = {"path": "src", "exclude": [], "mode": "rw"}
        assert check_path_permission(scope, "src/foo/bar.py") is True

    def test_outside_scope_blocked(self):
        scope = {"path": "src", "exclude": [], "mode": "rw"}
        assert check_path_permission(scope, "docs/readme.md") is False

    def test_exclude_with_dotdot(self):
        scope = {"path": "", "exclude": ["secrets"], "mode": "rw"}
        try:
            result = check_path_permission(scope, "public/../secrets/key")
            assert result is False
        except ValueError:
            pass  # ValueError from normalize_path is also acceptable


# ══════════════════════════════════════════════════
# Access Point auth hardening
# ══════════════════════════════════════════════════

class TestAccessPointFailClosed:
    """access_point.py must fail closed when scope is missing or malformed."""

    def _call_resolve(self, conn_data):
        """Helper: call resolve_access_point with a mocked DB response."""
        from src.mut_engine.routers.access_point import resolve_access_point

        mock_resp = MagicMock()
        mock_resp.data = conn_data

        with patch("src.infra.supabase.client.SupabaseClient") as mock_supa:
            mock_client = MagicMock()
            mock_client.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = mock_resp
            mock_supa.return_value.client = mock_client
            return resolve_access_point("test-key")

    def test_missing_scope_raises_403(self):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            self._call_resolve({
                "id": "conn-1",
                "project_id": "proj-1",
                "provider": "direct",
                "config": {},
                "revoked_at": None,
                "status": "active",
            })
        assert exc_info.value.status_code == 403

    def test_scope_defaults_to_readonly(self):
        """When scope has path but no mode, default should be 'r' not 'rw'."""
        _, auth = self._call_resolve({
            "id": "conn-1",
            "project_id": "proj-1",
            "provider": "direct",
            "config": {"scope": {"path": "docs"}},
            "revoked_at": None,
            "status": "active",
        })
        assert auth["_scope"]["mode"] == "r"


class TestAccessPointIdentityBinding:
    """access_point.py must reject missing X-Mut-User when identity is bound."""

    @pytest.mark.asyncio
    async def test_missing_header_rejected(self):
        from src.mut_engine.routers.access_point import _resolve_and_validate
        from fastapi import HTTPException

        mock_request = MagicMock()
        mock_request.headers = {}

        with patch(
            "src.mut_engine.routers.access_point.resolve_access_point",
            return_value=("proj-1", {
                "agent": "conn-1",
                "_scope": {"path": "", "mode": "rw"},
                "_user_identity": "alice@example.com",
            }),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await _resolve_and_validate("test-key", mock_request)
            assert exc_info.value.status_code == 401
            assert "X-Mut-User" in exc_info.value.detail


# ══════════════════════════════════════════════════
# Protocol-level push size validation
# ══════════════════════════════════════════════════

class TestPushObjectSizeValidation:
    """validate_push_objects must reject oversized blobs at the protocol level."""

    def test_oversized_single_object_rejected(self):
        from src.mut_engine.server.validation import validate_push_objects, MAX_FILE_SIZE
        from fastapi import HTTPException
        import base64

        huge_blob = base64.b64encode(b"x" * (MAX_FILE_SIZE + 1)).decode()
        body = {"objects": {"abc123": huge_blob}}

        with pytest.raises(HTTPException) as exc_info:
            validate_push_objects(body)
        assert exc_info.value.status_code == 413

    def test_too_many_objects_rejected(self):
        from src.mut_engine.server.validation import (
            validate_push_objects, MAX_FILES_PER_PUSH,
        )
        from fastapi import HTTPException

        body = {"objects": {f"hash_{i}": "YQ==" for i in range(MAX_FILES_PER_PUSH + 1)}}

        with pytest.raises(HTTPException) as exc_info:
            validate_push_objects(body)
        assert exc_info.value.status_code == 413

    def test_normal_push_passes(self):
        from src.mut_engine.server.validation import validate_push_objects
        import base64

        body = {"objects": {
            "hash1": base64.b64encode(b"hello").decode(),
            "hash2": base64.b64encode(b"world").decode(),
        }}
        validate_push_objects(body)

    def test_empty_objects_passes(self):
        from src.mut_engine.server.validation import validate_push_objects
        validate_push_objects({"objects": {}})
        validate_push_objects({})
