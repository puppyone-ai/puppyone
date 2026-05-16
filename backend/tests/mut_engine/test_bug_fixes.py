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
    import base64
    from mut.core import tree as tree_mod
    from mut.foundation.git_format import MODE_DIR, MODE_FILE, TreeEntry, encode_tree

    nested: dict = {}
    for path, content in files.items():
        blob_hash = repo.store.put_blob(content)
        parts = path.split("/")
        d = nested
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        d[parts[-1]] = ("B", blob_hash)

    def _build(node: dict) -> str:
        entries: list[TreeEntry] = []
        for name, val in sorted(node.items()):
            if isinstance(val, tuple):
                entries.append(TreeEntry(name=name, mode=MODE_FILE, sha1_hex=val[1]))
            else:
                entries.append(TreeEntry(name=name, mode=MODE_DIR, sha1_hex=_build(val)))
        return repo.store.put_tree(encode_tree(entries))

    root = _build(nested)
    reachable = tree_mod.collect_reachable_hashes(repo.store, root)
    objects_b64 = {
        h: base64.b64encode(repo.store.get_loose(h)).decode()
        for h in reachable
    }
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

        from src.mut_engine.adapters.mut.push_adapter import submit_mut_push

        async def mock_merge_push(repo_manager_arg, project_id_arg, auth_arg, body):
            result = await submit_mut_push(repo_manager_arg, project_id_arg, auth_arg, body)
            result["merged"] = True
            return result

        with patch(
            "src.mut_engine.services.ephemeral_client.submit_mut_push",
            side_effect=mock_merge_push,
        ):
            client.push(modified={"b.txt": b"new"}, message="test merge")

        assert pull_called, \
            "client.pull() should be called when push result has merged=True"

    def test_hash_cache_refreshes_when_server_head_advanced(self, server_repo):
        """A cached lite client must refresh after a non-conflict rebase."""
        from src.mut_engine.services.ephemeral_client import MutEphemeralClient
        from src.mut_engine.server.repo_manager import MutRepoManager

        repo_manager = MagicMock(spec=MutRepoManager)
        repo_manager.get_server_repo.return_value = server_repo

        auth = _rw_auth()
        first = _push_file(server_repo, auth, {"a.txt": b"v1"})

        client = MutEphemeralClient(repo_manager, "test-proj", auth)
        client.clone_lite()
        assert client._file_hashes is not None
        assert set(client._file_hashes) == {"a.txt"}

        _push_file(
            server_repo, auth,
            {"a.txt": b"v1", "external.txt": b"server"},
            base_commit_id=first["commit_id"],
        )

        result = client.push(modified={"mine.txt": b"client"}, message="add mine")

        assert result["status"] == "ok"
        assert client._file_hashes is not None
        assert set(client._file_hashes) == {
            "a.txt", "external.txt", "mine.txt",
        }


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


@pytest.mark.skip(
    reason=(
        "Legacy contract removed by access-point-redesign-2026-05-02. "
        "In the new model, scope is the access_key's row itself (repo_scopes), "
        "so 'missing scope on a valid AP' is no longer a representable state — "
        "if the access_key resolves, the scope is present by construction."
    )
)
class TestP1_2_ScopeFailClosed:
    """P1-2: Scope fallback must fail closed, not grant full access.

    DEPRECATED: this test exercises the access_points.config.scope JSONB
    fallback path, which the redesign removed. New scope storage in
    repo_scopes.path/exclude/mode columns has no fallback mode — the row
    either exists or auth fails earlier.
    """

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


@pytest.mark.skip(
    reason=(
        "Test mocks `access_points.status` / `access_points.revoked_at` columns. "
        "After access-point-redesign-2026-05-02, keys live on repo_scopes with "
        "the field renamed to access_key_revoked_at. Revocation IS still tested "
        "live via the scope router's regenerate-key endpoint and the new code "
        "path in auth._try_access_key (covered by tests/security/)."
    )
)
class TestP1_6_AccessKeyStatusCheck:
    """P1-6: Revoked or disabled access keys must be rejected.

    DEPRECATED: assumes the legacy access_points.status / revoked_at fields.
    New revocation lives on repo_scopes.access_key_revoked_at; coverage moved
    to the security regression suite.
    """

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

        with patch("src.mut_engine.server.auth.settings") as mock_settings:
            mock_settings.SKIP_AUTH = False
            with pytest.raises(HTTPException) as exc_info:
                authenticator.authenticate("some-key", "proj-1")
        assert exc_info.value.status_code == 401
        assert "revoked" in exc_info.value.detail.lower()


class TestP1_7_SkipAuthGuard:
    """P1-7: SKIP_AUTH should be restricted to dev/test environments."""

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


@pytest.mark.skip(
    reason=(
        "user_identity binding-to-key feature removed in access-point-redesign-"
        "2026-05-02. Per-user repo access is now expressed via the new "
        "repo_user_permissions table (denied-overrides-allow), not a "
        "key-bound-to-identity field. The X-Mut-User header parameter "
        "remains on PuppyOneAuthenticator.authenticate() for forward "
        "compatibility but is currently unused."
    )
)
class TestP1_8_UserIdentityRequired:
    """P1-8: When user_identity is configured, X-Mut-User header is mandatory.

    DEPRECATED: user_identity binding moved to repo_user_permissions.
    """

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
        from mut.foundation.git_format import MODE_DIR, MODE_FILE, TreeEntry, encode_tree

        blob_hash = memory_store.put_blob(b"hello")
        inner_hash = memory_store.put_tree(encode_tree([
            TreeEntry(name="file.md", mode=MODE_FILE, sha1_hex=blob_hash),
        ]))
        root_hash = memory_store.put_tree(encode_tree([
            TreeEntry(name="docs", mode=MODE_DIR, sha1_hex=inner_hash),
        ]))

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
        from mut.foundation.git_format import encode_tree

        root_hash = memory_store.put_tree(encode_tree([]))

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


class TestDeleteMissingPath:
    """Deleting a nonexistent path is an idempotent no-op at MutOps level."""

    @pytest.mark.asyncio
    async def test_delete_missing_path_is_noop(self, server_repo):
        from src.mut_engine.services.ops import MutOps
        from src.mut_engine.server.repo_manager import MutRepoManager

        mock_repos = MagicMock(spec=MutRepoManager)
        mock_repos.get_server_repo.return_value = server_repo

        ops = MutOps(mock_repos)
        result = await ops.delete("test-proj", ["nonexistent.txt"], who="test")

        assert result.commit_id == ""


class TestP2_10_HookExceptionLogging:
    """P2-10: MutOps _run_post_push_hook should log exceptions, not silently swallow."""

    def test_hook_logs_warning_on_failure(self, server_repo):
        from src.mut_engine.services.ops import MutOps
        from src.mut_engine.server.repo_manager import MutRepoManager

        mock_repos = MagicMock(spec=MutRepoManager)
        mock_repos.get_server_repo.return_value = server_repo

        ops = MutOps(mock_repos)

        push_result = {
            "status": "ok",
            "commit_id": "deadbeefdeadbeef",
            "root": "abc",
        }

        with patch(
            "src.mut_engine.services.hooks.run_post_push_hook",
            side_effect=RuntimeError("graft failed"),
        ):
            with patch("src.utils.logger.log_error") as mock_log:
                ops._run_post_push_hook("proj-1", push_result)
                assert any(
                    "graft failed" in str(call) for call in mock_log.call_args_list
                ), "Should log error containing the error message"


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
        # hasattr on MagicMock is always True, so _update_global_root calls
        # repo.get_root_hash() and repo.cas_update_root_hash() directly
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

        with patch("src.mut_engine.services.hooks._build_root_from_scope_state", return_value="new_root"):
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

        with patch("src.mut_engine.services.hooks._build_root_from_scope_state", return_value="new_root"):
            _update_global_root(mock_repo, push_result)

        mock_repo.cas_update_root_hash.assert_called_once_with(
            "existing_root", "new_root",
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
        from src.mut_engine.services.hooks import _graft_subtree
        assert callable(_graft_subtree)

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
        from src.mut_engine.application.tree_objects import flatten_tree_to_bytes
        assert callable(flatten_tree_to_bytes)

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

@pytest.mark.skip(
    reason=(
        "Mocks the legacy access_points table layout (config.scope JSONB, "
        "provider field, status field). After access-point-redesign-2026-05-02, "
        "resolve_access_point reads from repo_scopes columns directly — "
        "no JSONB extraction, no separate scope-missing state. Replaced by "
        "the connectors/scope_router test suite + tests/security/."
    )
)
class TestAccessPointFailClosed:
    """access_point.py must fail closed when scope is missing or malformed.

    DEPRECATED: assumes the legacy access_points table layout.
    """

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
