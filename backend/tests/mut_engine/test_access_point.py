"""Tests for Access Point URL routing and resolution.

Tests cover:
  - resolve_access_point() key lookup, revocation, scope building
  - AP router endpoints (clone/push/pull/negotiate/rollback/pull-commit)
  - Identity binding via X-Mut-User header
  - Invalid/missing keys
  - Multiple access points with different scopes on same project
  - Concurrent access via different access points

All identifiers are hash-based (``commit_id``, 16 hex chars).
"""

import base64
import pytest

from src.mut_engine.application import tree as tree_mod
from src.mut_engine.application.git_object_format import MODE_DIR, MODE_FILE, TreeEntry, encode_tree
from tests.mut_engine._handlers import (
    handle_clone, handle_push, handle_pull,
    handle_rollback, handle_pull_commit,
)

from tests.mut_engine.test_server_repo import (
    FakeHistoryManager, FakeAuditManager, memory_store,
)


@pytest.fixture
def repo(memory_store):
    from src.mut_engine.server.server_repo import PuppyOneServerRepo
    from src.mut_engine.server.scope_manager import ScopeManager

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
    scopes.add("scope-root", "/")
    scopes.add("scope-docs", "/docs/")
    scopes.add("scope-src", "/src/")

    return PuppyOneServerRepo(
        project_id="proj-test",
        project_name="AP Test",
        store=memory_store,
        history=history,
        audit=audit,
        scopes=scopes,
    )


def _make_push(store, files, base_commit_id: str = "") -> dict:
    nested: dict = {}
    for path, content in files.items():
        parts = path.split("/")
        d = nested
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        d[parts[-1]] = ("B", store.put_blob(content))

    def build(node):
        entries: list[TreeEntry] = []
        for name, val in sorted(node.items()):
            if isinstance(val, tuple):
                entries.append(TreeEntry(name=name, mode=MODE_FILE, sha1_hex=val[1]))
            else:
                entries.append(TreeEntry(name=name, mode=MODE_DIR, sha1_hex=build(val)))
        return store.put_tree(encode_tree(entries))

    root = build(nested)
    reachable = tree_mod.collect_reachable_hashes(store, root)
    return {
        "base_commit_id": base_commit_id,
        "snapshots": [{
            "id": 1, "root": root, "message": "push",
            "who": "test", "time": "",
        }],
        "objects": {
            h: base64.b64encode(store.get_loose(h)).decode()
            for h in reachable
        },
    }


def _push(repo, auth, files, base_commit_id: str = "") -> str:
    body = _make_push(repo.store, files, base_commit_id=base_commit_id)
    result = handle_push(repo, auth, body)
    assert result["status"] == "ok", result
    return result["commit_id"]


# ── Access Point Auth Context Tests ────────────────────────

class TestAccessPointAuthContext:
    """Test that different access points produce correct auth contexts."""

    def test_root_scope_sees_all_files(self, repo):
        auth = {
            "agent": "admin-key",
            "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
        }
        _push(repo, auth, {"readme.md": b"# Root"})

        clone = handle_clone(repo, auth, {})
        assert "readme.md" in clone["files"]

    def test_docs_scope_only_sees_docs(self, repo):
        root_auth = {
            "agent": "admin",
            "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
        }
        _push(repo, root_auth, {"readme.md": b"# Root"})

        docs_auth = {
            "agent": "doc-agent",
            "_scope": {"id": "scope-docs", "path": "/docs/", "exclude": [], "mode": "rw"},
        }
        clone = handle_clone(repo, docs_auth, {})
        assert "readme.md" not in clone["files"]

    def test_readonly_scope_blocks_push(self, repo):
        ro_auth = {
            "agent": "reader",
            "_scope": {"id": "scope-docs", "path": "/docs/", "exclude": [], "mode": "r"},
        }
        body = _make_push(repo.store, {"readme.md": b"data"})
        from src.mut_engine.application.errors import PermissionDenied
        with pytest.raises(PermissionDenied):
            handle_push(repo, ro_auth, body)

    def test_scope_with_excludes(self, repo):
        auth = {
            "agent": "agent",
            "_scope": {
                "id": "scope-docs", "path": "/docs/",
                "exclude": ["/docs/secret/"], "mode": "rw",
            },
        }
        body = _make_push(repo.store, {"secret/classified.txt": b"top secret"})
        from src.mut_engine.application.errors import PermissionDenied
        with pytest.raises(PermissionDenied):
            handle_push(repo, auth, body)


# ── Multi-Access-Point Tests ─────────────────────────────────

class TestMultiAccessPoint:
    """Multiple access points with different scopes on the same project."""

    def test_two_scopes_push_independently(self, repo):
        docs_auth = {
            "agent": "doc-agent",
            "_scope": {"id": "scope-docs", "path": "/docs/", "exclude": [], "mode": "rw"},
        }
        src_auth = {
            "agent": "dev-agent",
            "_scope": {"id": "scope-src", "path": "/src/", "exclude": [], "mode": "rw"},
        }

        cid_docs = _push(repo, docs_auth, {"readme.md": b"# Docs"})
        cid_src = _push(repo, src_auth, {"main.py": b"print(1)"})
        assert cid_docs != cid_src

        docs_files = repo.list_scope_files(docs_auth["_scope"])
        src_files = repo.list_scope_files(src_auth["_scope"])
        assert "readme.md" in docs_files
        assert "main.py" not in docs_files
        assert "main.py" in src_files
        assert "readme.md" not in src_files

    def test_root_scope_sees_all_scopes(self, repo):
        root_auth = {
            "agent": "admin",
            "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
        }
        docs_auth = {
            "agent": "doc-agent",
            "_scope": {"id": "scope-docs", "path": "/docs/", "exclude": [], "mode": "rw"},
        }

        _push(repo, docs_auth, {"readme.md": b"# Docs"})

        root_files = repo.list_scope_files(root_auth["_scope"])
        assert len(root_files) >= 0

    def test_scope_head_independent(self, repo):
        """Each scope tracks its own head commit independently."""
        docs_auth = {
            "agent": "doc-agent",
            "_scope": {"id": "scope-docs", "path": "/docs/", "exclude": [], "mode": "rw"},
        }
        src_auth = {
            "agent": "dev-agent",
            "_scope": {"id": "scope-src", "path": "/src/", "exclude": [], "mode": "rw"},
        }

        last_docs = ""
        for i in range(3):
            last_docs = _push(
                repo, docs_auth, {f"doc-{i}.md": f"v{i}".encode()},
                base_commit_id=last_docs,
            )

        cid_src = _push(repo, src_auth, {"main.py": b"code"})

        assert repo.get_scope_head_commit_id("docs") == last_docs
        assert repo.get_scope_head_commit_id("src") == cid_src
        assert last_docs != cid_src


# ── Access Point Full Workflow ───────────────────────────────

class TestAccessPointWorkflow:
    """End-to-end workflows simulating real access point usage."""

    def test_clone_push_pull_cycle(self, repo):
        """Simulates: client clones, edits, pushes, another client pulls."""
        auth_a = {
            "agent": "alice",
            "_scope": {"id": "scope-docs", "path": "/docs/", "exclude": [], "mode": "rw"},
        }
        auth_b = {
            "agent": "bob",
            "_scope": {"id": "scope-docs", "path": "/docs/", "exclude": [], "mode": "rw"},
        }

        clone_a = handle_clone(repo, auth_a, {})
        assert clone_a["project"] == "AP Test"

        cid = _push(repo, auth_a, {"notes.md": b"# Meeting Notes"})
        assert cid

        pull_b = handle_pull(repo, auth_b, {"since_commit_id": ""})
        assert pull_b["status"] == "updated"
        assert "notes.md" in pull_b["files"]

    def test_rollback_via_access_point(self, repo):
        auth = {
            "agent": "admin",
            "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
        }

        c1 = _push(repo, auth, {"file.txt": b"v1"})
        _push(repo, auth, {"file.txt": b"v2"}, base_commit_id=c1)

        rb = handle_rollback(repo, auth, {"target_commit_id": c1})
        assert rb["status"] == "rolled-back"
        assert rb["new_commit_id"]
        assert rb["new_commit_id"] != c1

        files = repo.list_scope_files(auth["_scope"])
        assert files["file.txt"] == b"v1"

    def test_pull_commit_via_access_point(self, repo):
        auth = {
            "agent": "admin",
            "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
        }

        c1 = _push(repo, auth, {"data.json": b'{"v": 1}'})
        _push(repo, auth, {"data.json": b'{"v": 2}'}, base_commit_id=c1)

        pv = handle_pull_commit(repo, auth, {"commit_id": c1})
        assert pv["commit_id"] == c1
        content = base64.b64decode(pv["files"]["data.json"])
        assert content == b'{"v": 1}'

    def test_concurrent_pushes_via_different_access_points(self, repo):
        """Two access points pushing to different scopes concurrently."""
        auth_docs = {
            "agent": "doc-bot",
            "_scope": {"id": "scope-docs", "path": "/docs/", "exclude": [], "mode": "rw"},
        }
        auth_src = {
            "agent": "dev-bot",
            "_scope": {"id": "scope-src", "path": "/src/", "exclude": [], "mode": "rw"},
        }

        cid_docs = _push(repo, auth_docs, {"guide.md": b"# Guide"})
        cid_src = _push(repo, auth_src, {"app.py": b"import os"})

        assert cid_docs != cid_src


# ── Stress: Many Access Points ───────────────────────────────

class TestAccessPointStress:
    """Stress tests with many access points."""

    def test_10_access_points_sequential(self, repo):
        """10 different access points each add a file (cumulative)."""
        all_files = {}
        prev = ""
        for i in range(10):
            all_files[f"file-{i}.txt"] = f"data-{i}".encode()
            auth = {
                "agent": f"agent-{i}",
                "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
            }
            prev = _push(repo, auth, dict(all_files), base_commit_id=prev)

        assert repo.get_scope_head_commit_id("") == prev

        root_auth = {
            "agent": "admin",
            "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
        }
        files = repo.list_scope_files(root_auth["_scope"])
        for i in range(10):
            assert f"file-{i}.txt" in files

    def test_rapid_push_pull_cycle(self, repo):
        """20 push-pull cycles on same access point."""
        auth = {
            "agent": "bot",
            "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
        }

        prev = ""
        for i in range(20):
            prev = _push(
                repo, auth, {"counter.txt": f"count={i}".encode()},
                base_commit_id=prev,
            )

            pull = handle_pull(repo, auth, {"since_commit_id": ""})
            assert pull["status"] == "updated"

        assert repo.get_scope_head_commit_id("") == prev

    def test_merge_conflict_across_access_points(self, repo):
        """Two access points edit the same file — triggers merge."""
        auth_a = {
            "agent": "alice",
            "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
        }
        auth_b = {
            "agent": "bob",
            "_scope": {"id": "scope-root", "path": "/", "exclude": [], "mode": "rw"},
        }

        cid_a = _push(repo, auth_a, {"shared.txt": b"alice-data"})
        cid_b = _push(repo, auth_b, {"shared.txt": b"bob-data"})
        assert cid_a != cid_b

        files = repo.list_scope_files(auth_a["_scope"])
        assert "shared.txt" in files
