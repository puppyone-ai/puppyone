"""Tests for PuppyOneServerRepo — scope versioning, global counter, file ops."""

import json
import pytest
from unittest.mock import MagicMock, patch

from mut.core.object_store import ObjectStore


class FakeHistoryManager:
    """In-memory mock for SupabaseHistoryManager."""

    def __init__(self):
        self._version = 0
        self._root_hash = ""
        self._scope_versions: dict[str, int] = {}
        self._scope_hashes: dict[str, str] = {}
        self._entries: dict[int, dict] = {}

    def get_latest_version(self) -> int:
        return self._version

    def set_latest_version(self, v: int) -> None:
        self._version = v

    def get_root_hash(self) -> str:
        return self._root_hash

    def set_root_hash(self, h: str) -> None:
        self._root_hash = h

    def get_scope_version(self, scope_path: str) -> int:
        return self._scope_versions.get(scope_path.strip("/"), 0)

    def set_scope_version(self, scope_path: str, version: int) -> None:
        self._scope_versions[scope_path.strip("/")] = version

    def get_scope_hash(self, scope_path: str) -> str:
        return self._scope_hashes.get(scope_path.strip("/"), "")

    def set_scope_hash(self, scope_path: str, h: str) -> None:
        self._scope_hashes[scope_path.strip("/")] = h

    def record(self, version, who, message, scope_path, changes,
               conflicts=None, root_hash="", scope_hash="", scope_version=""):
        self._entries[version] = {
            "version": version, "who": who, "message": message,
            "scope_path": scope_path, "changes": changes,
            "root_hash": root_hash, "scope_hash": scope_hash,
            "scope_version": scope_version, "root": root_hash,
        }

    def get_entry(self, version: int) -> dict | None:
        return self._entries.get(version)

    def get_since(self, since_version, scope_path=None, limit=0):
        entries = [e for v, e in sorted(self._entries.items()) if v > since_version]
        if scope_path:
            entries = [e for e in entries if e.get("scope_path") == scope_path]
        if limit > 0:
            entries = entries[-limit:]
        return entries


class FakeAuditManager:
    def __init__(self):
        self.events = []

    def record(self, event_type, agent_id, detail):
        self.events.append({"type": event_type, "agent": agent_id, "detail": detail})


@pytest.fixture
def memory_store(tmp_path):
    """Real ObjectStore backed by temp filesystem."""
    from mut.core.object_store import ObjectStore
    obj_dir = tmp_path / "objects"
    obj_dir.mkdir()
    return ObjectStore(obj_dir)


@pytest.fixture
def server_repo(memory_store):
    from src.mut_engine.server_repo import PuppyOneServerRepo
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

    return PuppyOneServerRepo(
        project_id="test-proj",
        project_name="Test Project",
        store=memory_store,
        history=history,
        audit=audit,
        scopes=scopes,
    )


class TestNextGlobalVersion:
    def test_increments_from_zero(self, server_repo):
        assert server_repo.next_global_version() == 1
        assert server_repo.next_global_version() == 2
        assert server_repo.next_global_version() == 3

    def test_reads_current_on_first_call(self, server_repo):
        server_repo.history.set_latest_version(10)
        assert server_repo.next_global_version() == 11

    def test_persists_to_history(self, server_repo):
        server_repo.next_global_version()
        assert server_repo.get_latest_version() == 1

    def test_thread_safety(self, server_repo):
        """Multiple threads incrementing should produce unique values."""
        import threading
        results = []

        def increment():
            results.append(server_repo.next_global_version())

        threads = [threading.Thread(target=increment) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(set(results)) == 20  # all unique
        assert sorted(results) == list(range(1, 21))


class TestScopeVersioning:
    def test_get_set_scope_version(self, server_repo):
        assert server_repo.get_scope_version("docs") == 0
        server_repo.set_scope_version("docs", 5)
        assert server_repo.get_scope_version("docs") == 5

    def test_get_set_scope_hash(self, server_repo):
        assert server_repo.get_scope_hash("docs") == ""
        server_repo.set_scope_hash("docs", "abc123")
        assert server_repo.get_scope_hash("docs") == "abc123"

    def test_scopes_independent(self, server_repo):
        server_repo.set_scope_version("docs", 3)
        server_repo.set_scope_version("src", 7)
        assert server_repo.get_scope_version("docs") == 3
        assert server_repo.get_scope_version("src") == 7


class TestRecordHistory:
    def test_record_with_scope_fields(self, server_repo):
        server_repo.record_history(
            version=1, who="alice", message="test",
            scope_path="docs", changes=[],
            scope_hash="hash123", scope_version="docs/1",
        )
        entry = server_repo.get_history_entry(1)
        assert entry["scope_hash"] == "hash123"
        assert entry["scope_version"] == "docs/1"


class TestListScopeFiles:
    def test_empty_scope(self, server_repo):
        scope = {"id": "s1", "path": "/docs/", "exclude": [], "mode": "rw"}
        files = server_repo.list_scope_files(scope)
        assert files == {}

    def test_with_scope_hash(self, server_repo, memory_store):
        """list_scope_files prefers scope_hash when available."""
        # Build a tree with one file
        blob_hash = memory_store.put(b"hello world")
        tree = json.dumps({"readme.md": ["B", blob_hash]}, sort_keys=True).encode()
        tree_hash = memory_store.put(tree)

        # Set scope hash
        server_repo.set_scope_hash("docs", tree_hash)

        scope = {"id": "s1", "path": "/docs/", "exclude": [], "mode": "rw"}
        files = server_repo.list_scope_files(scope)
        assert "readme.md" in files
        assert files["readme.md"] == b"hello world"


class TestWriteAndBuildScopeTree:
    def test_write_then_build(self, server_repo, memory_store):
        scope = {"id": "s1", "path": "/docs/", "exclude": [], "mode": "rw"}
        server_repo.write_scope_files(scope, {"a.txt": b"content-a"})
        tree_hash = server_repo.build_scope_tree(scope)

        # Verify tree is valid
        from mut.core.tree import tree_to_flat
        flat = tree_to_flat(memory_store, tree_hash)
        assert "a.txt" in flat
        content = memory_store.get(flat["a.txt"])
        assert content == b"content-a"
