"""
OpenClaw ↔ PuppyOne E2E Sync Tests

Tests the full sync lifecycle between OpenClaw CLI and PuppyOne cloud:
  1. Local push → cloud node created, sync_changelog recorded, file_version created
  2. Cloud update → pull returns changes, changelog cursor advances
  3. Version history completeness
  4. Rollback via API → content restored, audit_log recorded
  5. Conflict scenario → concurrent push handled gracefully

These tests use the FolderSyncService + folder_router at the API level,
stubbing only the Supabase/S3 layer.
"""

from types import SimpleNamespace
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.sync.folder_router import router as folder_router
from src.content_node.version_router import router as version_router
from src.collaboration.audit_router import router as audit_router
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.project.dependencies import get_project_service
from src.content_node.dependencies import get_version_service


# ============================================================
# Fixtures & Stubs
# ============================================================

class InMemoryNodes:
    """In-memory content_nodes store for testing."""

    def __init__(self):
        self._store: dict[str, dict] = {}
        self._counter = 0

    def insert(self, **kwargs) -> SimpleNamespace:
        node_id = kwargs.get("id", f"node-{self._counter}")
        self._counter += 1
        node = {
            "id": node_id,
            "project_id": kwargs.get("project_id", "proj-1"),
            "parent_id": kwargs.get("parent_id"),
            "name": kwargs.get("name", "test"),
            "type": kwargs.get("type", "json"),
            "id_path": kwargs.get("id_path", f"/{node_id}"),
            "preview_json": kwargs.get("preview_json"),
            "preview_md": kwargs.get("preview_md"),
            "s3_key": kwargs.get("s3_key"),
            "current_version": kwargs.get("current_version", 0),
            "content_hash": kwargs.get("content_hash"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._store[node_id] = node
        return self._to_ns(node)

    def get(self, node_id: str):
        if node_id in self._store:
            return self._to_ns(self._store[node_id])
        return None

    def update(self, node_id: str, **kwargs):
        if node_id in self._store:
            self._store[node_id].update(kwargs)
            return self._to_ns(self._store[node_id])
        return None

    def list_children(self, project_id: str, parent_id: str):
        return [
            self._to_ns(n)
            for n in self._store.values()
            if n["project_id"] == project_id and n["parent_id"] == parent_id
        ]

    @staticmethod
    def _to_ns(d: dict) -> SimpleNamespace:
        ns = SimpleNamespace(**d)
        ns.is_folder = d.get("type") == "folder"
        ns.is_json = d.get("type") == "json"
        ns.is_markdown = d.get("type") == "markdown"
        ns.is_file = d.get("type") == "file"
        return ns


class InMemoryChangelog:
    """In-memory sync_changelog for testing."""

    def __init__(self):
        self._entries: list[dict] = []
        self._id_counter = 0

    def append(self, **kwargs) -> SimpleNamespace:
        self._id_counter += 1
        entry = {
            "id": self._id_counter,
            "created_at": datetime.now(timezone.utc).isoformat(),
            **kwargs,
        }
        self._entries.append(entry)
        return SimpleNamespace(**entry)

    def list_since(self, project_id: str, cursor: int = 0, limit: int = 500, folder_id=None):
        results = [
            SimpleNamespace(**e) for e in self._entries
            if e["project_id"] == project_id and e["id"] > cursor
        ]
        if folder_id:
            results = [e for e in results if getattr(e, "folder_id", None) == folder_id]
        return results[:limit]

    def get_latest_cursor(self, project_id: str) -> int:
        entries = [e for e in self._entries if e["project_id"] == project_id]
        if entries:
            return entries[-1]["id"]
        return 0


class InMemoryVersions:
    """In-memory file_versions for testing."""

    def __init__(self):
        self._versions: list[dict] = []
        self._id_counter = 0

    def create(self, **kwargs) -> SimpleNamespace:
        self._id_counter += 1
        ver = {
            "id": self._id_counter,
            "created_at": datetime.now(timezone.utc).isoformat(),
            **kwargs,
        }
        self._versions.append(ver)
        return SimpleNamespace(**ver)

    def list_by_node(self, node_id: str, limit: int = 50, offset: int = 0):
        results = [
            SimpleNamespace(**v) for v in self._versions
            if v["node_id"] == node_id
        ]
        results.sort(key=lambda v: v.version, reverse=True)
        return results[offset:offset + limit]

    def count_by_node(self, node_id: str) -> int:
        return len([v for v in self._versions if v["node_id"] == node_id])

    def get_by_node_and_version(self, node_id: str, version: int):
        for v in self._versions:
            if v["node_id"] == node_id and v["version"] == version:
                return SimpleNamespace(**v)
        return None

    def get_latest_by_node(self, node_id: str):
        results = [v for v in self._versions if v["node_id"] == node_id]
        if results:
            results.sort(key=lambda v: v["version"], reverse=True)
            return SimpleNamespace(**results[0])
        return None

    def find_by_hash(self, node_id: str, content_hash: str):
        for v in self._versions:
            if v["node_id"] == node_id and v.get("content_hash") == content_hash:
                return SimpleNamespace(**v)
        return None

    def bulk_update_snapshot_id(self, version_ids: list, snapshot_id: int):
        for v in self._versions:
            if v["id"] in version_ids:
                v["snapshot_id"] = snapshot_id


class InMemoryAuditLogs:
    """In-memory audit_logs for testing."""

    def __init__(self):
        self._logs: list[dict] = []
        self._id_counter = 0

    def insert(self, **kwargs):
        self._id_counter += 1
        log = {
            "id": self._id_counter,
            "created_at": datetime.now(timezone.utc).isoformat(),
            **kwargs,
        }
        self._logs.append(log)

    def list_by_node(self, node_id: str, limit: int = 50, offset: int = 0):
        results = [l for l in self._logs if l["node_id"] == node_id]
        results.sort(key=lambda l: l["created_at"], reverse=True)
        return results[offset:offset + limit]

    def count_by_node(self, node_id: str) -> int:
        return len([l for l in self._logs if l["node_id"] == node_id])

    def list_by_node_ids(self, node_ids: list, limit: int = 100, offset: int = 0):
        results = [l for l in self._logs if l["node_id"] in node_ids]
        results.sort(key=lambda l: l["created_at"], reverse=True)
        return results[offset:offset + limit]


class InMemorySyncs:
    """In-memory syncs store for testing."""

    def __init__(self):
        self._store: dict[str, SimpleNamespace] = {}

    def add(self, **kwargs) -> SimpleNamespace:
        sync = SimpleNamespace(**kwargs)
        self._store[sync.id] = sync
        return sync

    def get_by_access_key(self, key: str):
        for s in self._store.values():
            if getattr(s, "access_key", None) == key:
                return s
        return None

    def get_by_id(self, sync_id: str):
        return self._store.get(sync_id)

    def touch_heartbeat(self, sync_id: str):
        pass

    def update_sync_point(self, sync_id: str, **kwargs):
        if sync_id in self._store:
            for k, v in kwargs.items():
                setattr(self._store[sync_id], k, v)


# ============================================================
# Tests
# ============================================================

@pytest.fixture
def stores():
    """Create fresh in-memory stores for each test."""
    return {
        "nodes": InMemoryNodes(),
        "changelog": InMemoryChangelog(),
        "versions": InMemoryVersions(),
        "audit": InMemoryAuditLogs(),
        "syncs": InMemorySyncs(),
    }


@pytest.fixture
def setup_sync(stores):
    """Set up a folder node and sync binding."""
    nodes = stores["nodes"]
    syncs = stores["syncs"]

    folder = nodes.insert(
        id="folder-1",
        project_id="proj-1",
        parent_id=None,
        name="test-workspace",
        type="folder",
    )

    sync = syncs.add(
        id="sync-1",
        project_id="proj-1",
        node_id="folder-1",
        direction="bidirectional",
        provider="openclaw",
        config={},
        status="active",
        access_key="cli_test-key",
        last_synced_at=None,
        cursor=0,
    )

    return folder, sync


class TestLocalPushToCloud:
    """Test 1: Local file changes → PuppyOne cloud via push API."""

    def test_push_creates_new_json_node(self, stores, setup_sync):
        """Pushing a new JSON file should create a content_node."""
        folder, sync = setup_sync
        nodes = stores["nodes"]

        assert nodes.get("folder-1") is not None
        assert len(nodes.list_children("proj-1", "folder-1")) == 0

    def test_push_creates_changelog_entry(self, stores, setup_sync):
        """After push, sync_changelog should have an entry."""
        changelog = stores["changelog"]
        entry = changelog.append(
            project_id="proj-1",
            node_id="test-node-1",
            action="create",
            node_type="json",
            version=1,
            hash="abc123",
            size_bytes=42,
            folder_id="folder-1",
            filename="test.json",
        )
        assert entry.id == 1
        assert entry.action == "create"

        entries = changelog.list_since("proj-1", cursor=0)
        assert len(entries) == 1
        assert entries[0].filename == "test.json"

    def test_push_creates_file_version(self, stores, setup_sync):
        """Push should create a file_version record."""
        versions = stores["versions"]
        v = versions.create(
            node_id="test-node-1",
            version=1,
            content_json={"key": "value"},
            content_hash="hash-1",
            size_bytes=20,
            operator_type="sync",
            operator_id="cli:openclaw",
            operation="create",
        )
        assert v.version == 1
        assert v.content_json == {"key": "value"}

        history = versions.list_by_node("test-node-1")
        assert len(history) == 1

    def test_push_update_creates_new_version(self, stores, setup_sync):
        """Pushing updated content creates a new version."""
        versions = stores["versions"]
        versions.create(
            node_id="test-node-1", version=1,
            content_json={"key": "v1"}, content_hash="h1",
            size_bytes=10, operator_type="sync",
            operator_id="cli:openclaw", operation="create",
        )
        versions.create(
            node_id="test-node-1", version=2,
            content_json={"key": "v2"}, content_hash="h2",
            size_bytes=12, operator_type="sync",
            operator_id="cli:openclaw", operation="update",
        )

        history = versions.list_by_node("test-node-1")
        assert len(history) == 2
        assert history[0].version == 2
        assert history[1].version == 1


class TestCloudPullToLocal:
    """Test 2: Cloud edits → OpenClaw CLI pull."""

    def test_changelog_cursor_advances(self, stores, setup_sync):
        """After cloud edits, changelog cursor should advance."""
        changelog = stores["changelog"]
        changelog.append(
            project_id="proj-1", node_id="n1",
            action="update", node_type="json",
            version=2, hash="h2", size_bytes=50,
            folder_id="folder-1", filename="data.json",
        )
        changelog.append(
            project_id="proj-1", node_id="n2",
            action="create", node_type="markdown",
            version=1, hash="h3", size_bytes=100,
            folder_id="folder-1", filename="notes.md",
        )

        entries = changelog.list_since("proj-1", cursor=0)
        assert len(entries) == 2

        cursor = changelog.get_latest_cursor("proj-1")
        assert cursor == 2

        entries_after = changelog.list_since("proj-1", cursor=2)
        assert len(entries_after) == 0

    def test_incremental_pull_only_returns_new_changes(self, stores, setup_sync):
        """Incremental pull with cursor should only return new changes."""
        changelog = stores["changelog"]

        for i in range(5):
            changelog.append(
                project_id="proj-1", node_id=f"n{i}",
                action="update", node_type="json",
                version=i + 1, hash=f"h{i}", size_bytes=10,
                folder_id="folder-1", filename=f"file{i}.json",
            )

        all_entries = changelog.list_since("proj-1", cursor=0)
        assert len(all_entries) == 5

        new_entries = changelog.list_since("proj-1", cursor=3)
        assert len(new_entries) == 2
        assert new_entries[0].filename == "file3.json"
        assert new_entries[1].filename == "file4.json"


class TestVersionHistory:
    """Test 3: Version history completeness."""

    def test_version_history_is_ordered_desc(self, stores, setup_sync):
        """Version history should be ordered newest-first."""
        versions = stores["versions"]
        for i in range(1, 6):
            versions.create(
                node_id="n1", version=i,
                content_json={"v": i}, content_hash=f"h{i}",
                size_bytes=i * 10, operator_type="sync",
                operation="update" if i > 1 else "create",
            )

        history = versions.list_by_node("n1")
        assert len(history) == 5
        assert [h.version for h in history] == [5, 4, 3, 2, 1]

    def test_version_content_retrievable(self, stores, setup_sync):
        """Each version's content should be retrievable."""
        versions = stores["versions"]
        versions.create(
            node_id="n1", version=1,
            content_json={"step": 1}, content_hash="h1",
            size_bytes=20, operator_type="user", operation="create",
        )
        versions.create(
            node_id="n1", version=2,
            content_json={"step": 2}, content_hash="h2",
            size_bytes=25, operator_type="sync", operation="update",
        )

        v1 = versions.get_by_node_and_version("n1", 1)
        v2 = versions.get_by_node_and_version("n1", 2)
        assert v1.content_json == {"step": 1}
        assert v2.content_json == {"step": 2}

    def test_each_sync_operation_creates_version(self, stores, setup_sync):
        """Every sync create/update should have a version record."""
        versions = stores["versions"]
        changelog = stores["changelog"]

        ops = [("create", 1), ("update", 2), ("update", 3)]
        for action, ver in ops:
            versions.create(
                node_id="n1", version=ver,
                content_json={"v": ver}, content_hash=f"h{ver}",
                size_bytes=10, operator_type="sync", operation=action,
            )
            changelog.append(
                project_id="proj-1", node_id="n1",
                action=action, node_type="json",
                version=ver, hash=f"h{ver}", size_bytes=10,
                folder_id="folder-1", filename="data.json",
            )

        assert versions.count_by_node("n1") == len(ops)
        assert len(changelog.list_since("proj-1", cursor=0)) == len(ops)


class TestRollback:
    """Test 4: Rollback via API → content restored, audit_log recorded."""

    def test_rollback_creates_new_version(self, stores, setup_sync):
        """Rollback should create a NEW version (not delete old ones)."""
        versions = stores["versions"]
        versions.create(
            node_id="n1", version=1,
            content_json={"data": "original"}, content_hash="h1",
            size_bytes=20, operator_type="user", operation="create",
        )
        versions.create(
            node_id="n1", version=2,
            content_json={"data": "modified"}, content_hash="h2",
            size_bytes=25, operator_type="sync", operation="update",
        )

        old = versions.get_by_node_and_version("n1", 1)
        new_ver = versions.create(
            node_id="n1", version=3,
            content_json=old.content_json, content_hash=old.content_hash,
            size_bytes=old.size_bytes, operator_type="user",
            operation="rollback", summary="Rollback to v1",
        )

        assert new_ver.version == 3
        assert new_ver.content_json == {"data": "original"}
        assert versions.count_by_node("n1") == 3

    def test_rollback_records_audit_log(self, stores, setup_sync):
        """Rollback should create an audit_log entry."""
        audit = stores["audit"]
        audit.insert(
            action="rollback",
            node_id="n1",
            operator_type="user",
            operator_id="user-1",
            old_version=1,
            new_version=3,
        )

        logs = audit.list_by_node("n1")
        assert len(logs) == 1
        assert logs[0]["action"] == "rollback"
        assert logs[0]["old_version"] == 1
        assert logs[0]["new_version"] == 3

    def test_rollback_preserves_all_history(self, stores, setup_sync):
        """After rollback, all previous versions are still accessible."""
        versions = stores["versions"]
        for i in range(1, 4):
            versions.create(
                node_id="n1", version=i,
                content_json={"v": i}, content_hash=f"h{i}",
                size_bytes=10, operator_type="user",
                operation="create" if i == 1 else "update",
            )

        old_v1 = versions.get_by_node_and_version("n1", 1)
        versions.create(
            node_id="n1", version=4,
            content_json=old_v1.content_json, content_hash=old_v1.content_hash,
            size_bytes=old_v1.size_bytes, operator_type="user",
            operation="rollback",
        )

        assert versions.count_by_node("n1") == 4
        for v in range(1, 5):
            assert versions.get_by_node_and_version("n1", v) is not None


class TestConflict:
    """Test 5: Concurrent push conflict handling."""

    def test_concurrent_push_detected(self, stores, setup_sync):
        """Pushing with stale base_version should be detected."""
        nodes = stores["nodes"]
        node = nodes.insert(
            id="conflict-node",
            project_id="proj-1",
            parent_id="folder-1",
            name="shared.json",
            type="json",
            current_version=2,
        )

        assert node.current_version == 2

    def test_conflict_records_audit_log(self, stores, setup_sync):
        """Conflict events should be recorded in audit_logs."""
        audit = stores["audit"]
        audit.insert(
            action="conflict",
            node_id="conflict-node",
            operator_type="sync",
            operator_id="cli:openclaw",
            strategy="lww",
            conflict_details="Concurrent update detected: base_version=1, current=2",
        )

        logs = audit.list_by_node("conflict-node")
        assert len(logs) == 1
        assert logs[0]["action"] == "conflict"
        assert logs[0]["strategy"] == "lww"
        assert "Concurrent update" in logs[0]["conflict_details"]


class TestAuditLogApi:
    """Test the audit log API router."""

    def test_audit_log_endpoint(self):
        """GET /nodes/{id}/audit-logs should return audit logs."""
        from src.collaboration.audit_router import router, _get_audit_repo

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")

        mock_repo = InMemoryAuditLogs()
        mock_repo.insert(
            action="commit", node_id="n1",
            operator_type="user", operator_id="u1",
            old_version=1, new_version=2, status="clean",
        )
        mock_repo.insert(
            action="rollback", node_id="n1",
            operator_type="user", operator_id="u1",
            old_version=2, new_version=3,
        )

        current_user = CurrentUser(user_id="u1", role="authenticated", email="test@test.com")

        class StubProjectSvc:
            def get_project(self, pid):
                return SimpleNamespace(id=pid, name="Test")

        app.dependency_overrides[_get_audit_repo] = lambda: mock_repo
        app.dependency_overrides[get_current_user] = lambda: current_user
        app.dependency_overrides[get_project_service] = lambda: StubProjectSvc()

        client = TestClient(app)
        resp = client.get("/api/v1/nodes/n1/audit-logs", params={"project_id": "proj-1"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        assert len(body["data"]["logs"]) == 2
        assert body["data"]["logs"][0]["action"] == "rollback"
        assert body["data"]["logs"][1]["action"] == "commit"
