"""End-to-end integration test: Mut handlers running on PuppyOneServerRepo.

Simulates the full flow a local Mut client would do when connecting to
PuppyOne as the server. Uses real Mut handler code + PuppyOneServerRepo
with in-memory object store (no S3/PG needed).
"""

import base64
import json
import pytest

from mut.core import tree as tree_mod
from mut.server.handlers import (
    handle_clone, handle_push, handle_pull,
    handle_negotiate, handle_rollback, handle_pull_version,
)
from mut.server.history import HistoryManager


# Reuse fixtures from test_server_repo
from tests.mut_engine.test_server_repo import (
    FakeHistoryManager, FakeAuditManager, memory_store,
)


@pytest.fixture
def repo(memory_store):
    """PuppyOneServerRepo wired with real Mut handlers."""
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

    scopes = ScopeManager(FakeScopeBackend())
    scopes.add("scope-all", "/")

    r = PuppyOneServerRepo(
        project_id="test-proj",
        project_name="Integration Test",
        store=memory_store,
        history=history,
        audit=audit,
        scopes=scopes,
    )

    # Record initial version (like server init)
    history.record(0, "server", "initial state", "/", [])
    return r


@pytest.fixture
def auth():
    return {
        "agent": "test-agent",
        "_scope": {"id": "scope-all", "path": "/", "exclude": [], "mode": "rw"},
    }


def _make_push_body(store, files: dict, base_version: int = 0) -> dict:
    """Build a valid push body with Merkle tree + objects."""
    nested = {}
    for path, content in files.items():
        parts = path.split("/")
        d = nested
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        blob_hash = store.put(content)
        d[parts[-1]] = ("B", blob_hash)

    def write_nested(node):
        entries = {}
        for name, val in sorted(node.items()):
            if isinstance(val, tuple):
                entries[name] = list(val)
            else:
                sub_hash = write_nested(val)
                entries[name] = ["T", sub_hash]
        return store.put(json.dumps(entries, sort_keys=True).encode())

    root_hash = write_nested(nested)
    reachable = tree_mod.collect_reachable_hashes(store, root_hash)
    objects_b64 = {h: base64.b64encode(store.get(h)).decode() for h in reachable}

    return {
        "base_version": base_version,
        "snapshots": [{"id": 1, "root": root_hash, "message": "test push",
                       "who": "test-agent", "time": ""}],
        "objects": objects_b64,
    }


# ── Clone ──────────────────────────────────────

class TestClone:
    def test_clone_empty(self, repo, auth):
        result = handle_clone(repo, auth, {})
        assert result["project"] == "Integration Test"
        assert result["agent_id"] == "test-agent"
        assert isinstance(result["files"], dict)

    def test_clone_with_files(self, repo, auth):
        # Push a file first
        body = _make_push_body(repo.store, {"hello.txt": b"Hello World"})
        handle_push(repo, auth, body)

        result = handle_clone(repo, auth, {})
        assert "hello.txt" in result["files"]
        content = base64.b64decode(result["files"]["hello.txt"])
        assert content == b"Hello World"


# ── Push ───────────────────────────────────────

class TestPush:
    def test_push_creates_version(self, repo, auth):
        body = _make_push_body(repo.store, {"a.txt": b"aaa"})
        result = handle_push(repo, auth, body)
        assert result["status"] == "ok"
        assert result["version"] == 1
        # Scope version tracked internally (not in PushResponse for compat)
        assert repo.get_scope_version("") > 0
        assert repo.get_scope_hash("") != ""

    def test_push_increments_version(self, repo, auth):
        body1 = _make_push_body(repo.store, {"a.txt": b"v1"})
        r1 = handle_push(repo, auth, body1)

        body2 = _make_push_body(repo.store, {"a.txt": b"v2"}, base_version=1)
        r2 = handle_push(repo, auth, body2)

        assert r1["version"] == 1
        assert r2["version"] == 2

    def test_push_triggers_merge(self, repo, auth):
        """Push with stale base_version triggers three-way merge."""
        body1 = _make_push_body(repo.store, {"a.txt": b"v1"})
        handle_push(repo, auth, body1)

        # Push v2 based on v0 (stale) — should auto-merge
        body2 = _make_push_body(repo.store, {"b.txt": b"new-file"}, base_version=0)
        r2 = handle_push(repo, auth, body2)
        assert r2["version"] == 2

        # Both files should exist
        files = repo.list_scope_files(auth["_scope"])
        assert "a.txt" in files
        assert "b.txt" in files

    def test_push_readonly_rejected(self, repo):
        ro_auth = {
            "agent": "reader",
            "_scope": {"id": "scope-all", "path": "/", "exclude": [], "mode": "r"},
        }
        body = _make_push_body(repo.store, {"x.txt": b"data"})
        from mut.foundation.error import PermissionDenied
        with pytest.raises(PermissionDenied):
            handle_push(repo, ro_auth, body)


# ── Pull ───────────────────────────────────────

class TestPull:
    def test_pull_up_to_date(self, repo, auth):
        result = handle_pull(repo, auth, {"since_version": 0})
        assert result["status"] == "up-to-date"

    def test_pull_after_push(self, repo, auth):
        body = _make_push_body(repo.store, {"doc.md": b"# Hello"})
        handle_push(repo, auth, body)

        result = handle_pull(repo, auth, {"since_version": 0})
        assert result["status"] == "updated"
        assert "doc.md" in result["files"]
        assert result["version"] == 1


# ── Negotiate ──────────────────────────────────

class TestNegotiate:
    def test_negotiate_all_missing(self, repo, auth):
        result = handle_negotiate(repo, auth, {"hashes": ["abc", "def"]})
        assert set(result["missing"]) == {"abc", "def"}

    def test_negotiate_some_present(self, repo, auth):
        h = repo.store.put(b"known data")
        result = handle_negotiate(repo, auth, {"hashes": [h, "unknown"]})
        assert "unknown" in result["missing"]
        assert h not in result["missing"]


# ── Rollback ───────────────────────────────────

class TestRollback:
    def test_rollback_to_v1(self, repo, auth):
        # Push v1
        body1 = _make_push_body(repo.store, {"a.txt": b"version-1"})
        handle_push(repo, auth, body1)

        # Push v2
        body2 = _make_push_body(repo.store, {"a.txt": b"version-2"}, base_version=1)
        handle_push(repo, auth, body2)

        # Rollback to v1
        result = handle_rollback(repo, auth, {"target_version": 1})
        assert result["status"] == "rolled-back"
        assert result["new_version"] == 3
        assert result["target_version"] == 1

        # Verify content
        files = repo.list_scope_files(auth["_scope"])
        assert files["a.txt"] == b"version-1"

    def test_rollback_already_at_version(self, repo, auth):
        body = _make_push_body(repo.store, {"a.txt": b"data"})
        handle_push(repo, auth, body)

        result = handle_rollback(repo, auth, {"target_version": 1})
        assert result["status"] == "already-at-version"

    def test_rollback_invalid_version(self, repo, auth):
        body = _make_push_body(repo.store, {"a.txt": b"data"})
        handle_push(repo, auth, body)

        with pytest.raises(ValueError, match="invalid"):
            handle_rollback(repo, auth, {"target_version": 999})


# ── Pull Version ───────────────────────────────

class TestPullVersion:
    def test_pull_historical_version(self, repo, auth):
        body1 = _make_push_body(repo.store, {"a.txt": b"v1-content"})
        handle_push(repo, auth, body1)

        body2 = _make_push_body(repo.store, {"a.txt": b"v2-content"}, base_version=1)
        handle_push(repo, auth, body2)

        result = handle_pull_version(repo, auth, {"version": 1})
        assert result["status"] == "ok"
        assert result["version"] == 1
        content = base64.b64decode(result["files"]["a.txt"])
        assert content == b"v1-content"

    def test_pull_version_invalid(self, repo, auth):
        body = _make_push_body(repo.store, {"a.txt": b"data"})
        handle_push(repo, auth, body)

        with pytest.raises(ValueError, match="invalid"):
            handle_pull_version(repo, auth, {"version": 0})


# ── Full Workflow ──────────────────────────────

class TestFullWorkflow:
    def test_push_rollback_push_pull(self, repo, auth):
        """Simulate: push v1 → push v2 → rollback to v1 → push v3 → pull."""
        # v1
        body1 = _make_push_body(repo.store, {"doc.md": b"# Version 1"})
        r1 = handle_push(repo, auth, body1)
        assert r1["version"] == 1

        # v2
        body2 = _make_push_body(repo.store, {"doc.md": b"# Version 2"}, base_version=1)
        r2 = handle_push(repo, auth, body2)
        assert r2["version"] == 2

        # Rollback to v1 → creates v3
        rb = handle_rollback(repo, auth, {"target_version": 1})
        assert rb["new_version"] == 3

        # Push v4 on top of rollback
        body4 = _make_push_body(repo.store, {"doc.md": b"# Version 4"}, base_version=3)
        r4 = handle_push(repo, auth, body4)
        assert r4["version"] == 4

        # Pull latest
        pull = handle_pull(repo, auth, {"since_version": 0})
        assert pull["status"] == "updated"
        assert pull["version"] == 4
        content = base64.b64decode(pull["files"]["doc.md"])
        assert content == b"# Version 4"

    def test_multi_file_merge(self, repo, auth):
        """Two pushes with different files merge cleanly."""
        body_a = _make_push_body(repo.store, {"a.txt": b"file-a"})
        handle_push(repo, auth, body_a)

        body_b = _make_push_body(repo.store, {"b.txt": b"file-b"}, base_version=0)
        handle_push(repo, auth, body_b)

        files = repo.list_scope_files(auth["_scope"])
        assert "a.txt" in files
        assert "b.txt" in files
        assert files["a.txt"] == b"file-a"
        assert files["b.txt"] == b"file-b"

    def test_scope_version_tracked(self, repo, auth):
        """Each push increments scope version independently."""
        body = _make_push_body(repo.store, {"x.txt": b"data"})
        handle_push(repo, auth, body)

        # Verify scope state is tracked
        assert repo.get_scope_version("") == 1
        assert repo.get_scope_hash("") != ""

        # Second push increments
        body2 = _make_push_body(repo.store, {"y.txt": b"data2"}, base_version=1)
        handle_push(repo, auth, body2)
        assert repo.get_scope_version("") == 2
