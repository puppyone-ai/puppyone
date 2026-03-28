"""Multi-repo stress tests — PuppyOne hosting multiple MUT repos.

Simulates realistic production scenarios:
  - Multiple projects (repos) running concurrently
  - PuppyOne as server + client (MutOps internal), local CLIs as external clients
  - Different scopes with different auth levels (r/rw)
  - Concurrent conflicting and non-conflicting edits
  - Access Point routing across projects
  - Scope isolation, auth rejection, rollback under concurrency

Each test creates isolated in-memory repos — no DB or S3 needed.
"""

import asyncio
import base64
import json
import threading
import time
import pytest

from mut.core import tree as tree_mod
from mut.server.handlers import (
    handle_clone, handle_push, handle_pull,
    handle_negotiate, handle_rollback, handle_pull_version,
)
from mut.foundation.error import PermissionDenied

from tests.mut_engine.test_server_repo import (
    FakeHistoryManager, FakeAuditManager,
)


# ── Fixtures ──────────────────────────────────────────────────

class RepoFactory:
    """Creates isolated PuppyOneServerRepo instances for each project."""

    def __init__(self, tmp_path):
        self._tmp = tmp_path
        self._repos = {}

    def create(self, project_id: str, project_name: str = ""):
        from mut.core.object_store import ObjectStore
        from src.mut_engine.server_repo import PuppyOneServerRepo
        from mut.server.scope_manager import ScopeManager

        obj_dir = self._tmp / project_id / "objects"
        obj_dir.mkdir(parents=True)
        store = ObjectStore(obj_dir)
        history = FakeHistoryManager()
        audit = FakeAuditManager()

        class MemScopeBackend:
            def __init__(self):
                self._s = {}
            def get(self, sid):
                return self._s.get(sid)
            def put(self, sid, scope):
                self._s[sid] = scope
            def delete(self, sid):
                return self._s.pop(sid, None) is not None
            def list_all(self):
                return list(self._s.values())

        scopes = ScopeManager(MemScopeBackend())
        repo = PuppyOneServerRepo(
            project_id=project_id,
            project_name=project_name or project_id,
            store=store, history=history, audit=audit, scopes=scopes,
        )
        history.record(0, "server", "init", "/", [])
        self._repos[project_id] = repo
        return repo

    def get(self, project_id):
        return self._repos[project_id]


@pytest.fixture
def factory(tmp_path):
    return RepoFactory(tmp_path)


def _push(store, files, base=0):
    nested = {}
    for path, content in files.items():
        parts = path.split("/")
        d = nested
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        d[parts[-1]] = ("B", store.put(content))

    def build(node):
        entries = {}
        for name, val in sorted(node.items()):
            if isinstance(val, tuple):
                entries[name] = list(val)
            else:
                entries[name] = ["T", build(val)]
        return store.put(json.dumps(entries, sort_keys=True).encode())

    root = build(nested)
    reachable = tree_mod.collect_reachable_hashes(store, root)
    return {
        "base_version": base,
        "snapshots": [{"id": 1, "root": root, "message": "push",
                       "who": "test", "time": ""}],
        "objects": {h: base64.b64encode(store.get(h)).decode()
                    for h in reachable},
    }


def _auth(agent, scope_path="/", mode="rw", excludes=None):
    return {
        "agent": agent,
        "_scope": {
            "id": f"scope-{scope_path.strip('/') or 'root'}",
            "path": scope_path,
            "exclude": excludes or [],
            "mode": mode,
        },
    }


# ══════════════════════════════════════════════════════════════
# 1. Multi-Project Isolation
# ══════════════════════════════════════════════════════════════

class TestMultiProjectIsolation:
    """Changes in one project don't affect another."""

    def test_two_projects_independent(self, factory):
        repo_a = factory.create("proj-a", "Project A")
        repo_b = factory.create("proj-b", "Project B")
        auth_a = _auth("user-a")
        auth_b = _auth("user-b")

        # Push to project A
        handle_push(repo_a, auth_a, _push(repo_a.store, {"a.txt": b"A data"}))

        # Push to project B
        handle_push(repo_b, auth_b, _push(repo_b.store, {"b.txt": b"B data"}))

        # Project A doesn't see B's files
        files_a = repo_a.list_scope_files(auth_a["_scope"])
        assert "a.txt" in files_a
        assert "b.txt" not in files_a

        # Project B doesn't see A's files
        files_b = repo_b.list_scope_files(auth_b["_scope"])
        assert "b.txt" in files_b
        assert "a.txt" not in files_b

    def test_version_numbers_independent(self, factory):
        repo_a = factory.create("proj-a")
        repo_b = factory.create("proj-b")
        auth = _auth("admin")

        # Push 5 times to A
        for i in range(5):
            handle_push(repo_a, auth, _push(repo_a.store, {f"f{i}.txt": b"x"}, base=i))

        # Push 2 times to B
        for i in range(2):
            handle_push(repo_b, auth, _push(repo_b.store, {f"g{i}.txt": b"y"}, base=i))

        assert repo_a.get_latest_version() == 5
        assert repo_b.get_latest_version() == 2

    def test_three_projects_concurrent_pushes(self, factory):
        repos = [factory.create(f"proj-{i}") for i in range(3)]
        auths = [_auth(f"user-{i}") for i in range(3)]

        for i, (repo, auth) in enumerate(zip(repos, auths)):
            handle_push(repo, auth, _push(repo.store, {f"file-{i}.txt": f"data-{i}".encode()}))

        for i, repo in enumerate(repos):
            assert repo.get_latest_version() == 1
            files = repo.list_scope_files(auths[i]["_scope"])
            assert f"file-{i}.txt" in files


# ══════════════════════════════════════════════════════════════
# 2. Concurrent Edits — Same Project, Same Scope
# ══════════════════════════════════════════════════════════════

class TestConcurrentSameScope:
    """Multiple clients editing the same scope concurrently."""

    def test_5_clients_different_files_merge(self, factory):
        """5 clients each add a unique file — all should merge cleanly."""
        repo = factory.create("collab")
        repo.scopes.add("scope-root", "/")

        all_files = {}
        for i in range(5):
            auth = _auth(f"client-{i}")
            all_files[f"client-{i}.txt"] = f"data-{i}".encode()
            body = _push(repo.store, dict(all_files), base=i)
            r = handle_push(repo, auth, body)
            assert r["status"] == "ok"

        files = repo.list_scope_files(_auth("any")["_scope"])
        for i in range(5):
            assert f"client-{i}.txt" in files

    def test_same_file_lww(self, factory):
        """Two clients edit the same file — second writer wins via merge."""
        repo = factory.create("conflict")
        auth_a = _auth("alice")
        auth_b = _auth("bob")

        body_a = _push(repo.store, {"shared.txt": b"alice-version"})
        body_b = _push(repo.store, {"shared.txt": b"bob-version"})

        handle_push(repo, auth_a, body_a)
        handle_push(repo, auth_b, body_b)

        files = repo.list_scope_files(auth_a["_scope"])
        assert b"bob-version" in files["shared.txt"]

    def test_20_sequential_pushes(self, factory):
        repo = factory.create("rapid")
        auth = _auth("bot")
        all_files = {}

        for i in range(20):
            all_files["counter.txt"] = f"count={i}".encode()
            body = _push(repo.store, dict(all_files), base=i)
            r = handle_push(repo, auth, body)
            assert r["version"] == i + 1

        assert repo.get_latest_version() == 20


# ══════════════════════════════════════════════════════════════
# 3. Concurrent Edits — Same Project, Different Scopes
# ══════════════════════════════════════════════════════════════

class TestConcurrentDifferentScopes:
    """Clients in different scopes operate independently."""

    def test_docs_and_src_parallel(self, factory):
        repo = factory.create("multi-scope")
        repo.scopes.add("scope-docs", "/docs/")
        repo.scopes.add("scope-src", "/src/")

        auth_docs = _auth("doc-bot", "/docs/")
        auth_src = _auth("dev-bot", "/src/")

        r1 = handle_push(repo, auth_docs, _push(repo.store, {"readme.md": b"# Docs"}))
        r2 = handle_push(repo, auth_src, _push(repo.store, {"main.py": b"code"}))

        assert r1["status"] == "ok"
        assert r2["status"] == "ok"
        assert r1["version"] != r2["version"]

        docs_files = repo.list_scope_files(auth_docs["_scope"])
        src_files = repo.list_scope_files(auth_src["_scope"])
        assert "readme.md" in docs_files
        assert "main.py" not in docs_files
        assert "main.py" in src_files

    def test_scope_version_tracking(self, factory):
        repo = factory.create("scope-ver")
        repo.scopes.add("scope-docs", "/docs/")
        repo.scopes.add("scope-src", "/src/")

        auth_docs = _auth("doc", "/docs/")
        auth_src = _auth("dev", "/src/")

        for i in range(3):
            handle_push(repo, auth_docs, _push(repo.store, {f"d{i}.md": b"x"}, base=i))

        handle_push(repo, auth_src, _push(repo.store, {"m.py": b"y"}, base=3))

        assert repo.get_scope_version("docs") == 3
        assert repo.get_scope_version("src") == 1


# ══════════════════════════════════════════════════════════════
# 4. Auth & Scope Enforcement
# ══════════════════════════════════════════════════════════════

class TestAuthScopeEnforcement:
    """Auth level enforcement across different scenarios."""

    def test_readonly_cannot_push(self, factory):
        repo = factory.create("auth-test")
        ro_auth = _auth("reader", "/", mode="r")

        with pytest.raises(PermissionDenied, match="read-only"):
            handle_push(repo, ro_auth, _push(repo.store, {"x.txt": b"data"}))

    def test_readonly_can_clone_and_pull(self, factory):
        repo = factory.create("auth-test2")
        rw_auth = _auth("admin")
        ro_auth = _auth("reader", "/", mode="r")

        handle_push(repo, rw_auth, _push(repo.store, {"doc.md": b"# Hello"}))

        clone = handle_clone(repo, ro_auth, {})
        assert "doc.md" in clone["files"]

        pull = handle_pull(repo, ro_auth, {"since_version": 0})
        assert pull["status"] == "updated"

    def test_scope_excludes_enforced(self, factory):
        repo = factory.create("exclude-test")
        auth = _auth("agent", "/docs/", excludes=["/docs/secret/"])

        body = _push(repo.store, {"secret/classified.txt": b"top secret"})
        with pytest.raises(PermissionDenied, match="paths outside scope"):
            handle_push(repo, auth, body)

    def test_different_auth_levels_on_same_project(self, factory):
        repo = factory.create("mixed-auth")

        rw_auth = _auth("editor", "/docs/")
        ro_auth = _auth("viewer", "/docs/", mode="r")

        # Editor pushes
        body = _push(repo.store, {"notes.md": b"# Notes"})
        handle_push(repo, rw_auth, body)

        # Viewer can read
        clone = handle_clone(repo, ro_auth, {})
        assert "notes.md" in clone["files"]

        # Viewer cannot push
        body2 = _push(repo.store, {"hack.txt": b"nope"})
        with pytest.raises(PermissionDenied):
            handle_push(repo, ro_auth, body2)

    def test_cross_scope_isolation(self, factory):
        """Push to docs scope, pull as src scope — should see nothing."""
        repo = factory.create("cross-scope")
        repo.scopes.add("scope-docs", "/docs/")
        repo.scopes.add("scope-src", "/src/")

        docs_auth = _auth("doc", "/docs/")
        src_auth = _auth("dev", "/src/")

        handle_push(repo, docs_auth, _push(repo.store, {"readme.md": b"docs"}))

        pull = handle_pull(repo, src_auth, {"since_version": 0})
        assert "readme.md" not in pull.get("files", {})


# ══════════════════════════════════════════════════════════════
# 5. Rollback Under Concurrency
# ══════════════════════════════════════════════════════════════

class TestRollbackConcurrency:
    """Rollback while other operations are happening."""

    def test_rollback_then_push(self, factory):
        repo = factory.create("rollback-test")
        auth = _auth("admin")

        # v1
        handle_push(repo, auth, _push(repo.store, {"f.txt": b"v1"}))
        # v2
        handle_push(repo, auth, _push(repo.store, {"f.txt": b"v2"}, base=1))
        # rollback to v1 → v3
        rb = handle_rollback(repo, auth, {"target_version": 1})
        assert rb["new_version"] == 3

        # push v4 on top of rollback
        handle_push(repo, auth, _push(repo.store, {"f.txt": b"v4"}, base=3))
        assert repo.get_latest_version() == 4

        files = repo.list_scope_files(auth["_scope"])
        assert files["f.txt"] == b"v4"

    def test_rollback_preserves_all_history(self, factory):
        repo = factory.create("rb-history")
        auth = _auth("admin")

        for i in range(1, 4):
            handle_push(repo, auth, _push(repo.store, {"f.txt": f"v{i}".encode()}, base=i-1))

        handle_rollback(repo, auth, {"target_version": 1})

        # All 4 versions accessible
        for v in range(1, 5):
            entry = repo.get_history_entry(v)
            assert entry is not None

    def test_pull_version_after_rollback(self, factory):
        repo = factory.create("rb-pv")
        auth = _auth("admin")

        handle_push(repo, auth, _push(repo.store, {"f.txt": b"original"}))
        handle_push(repo, auth, _push(repo.store, {"f.txt": b"changed"}, base=1))
        handle_rollback(repo, auth, {"target_version": 1})

        # Pull version 2 (before rollback) — should show "changed"
        pv = handle_pull_version(repo, auth, {"version": 2})
        content = base64.b64decode(pv["files"]["f.txt"])
        assert content == b"changed"


# ══════════════════════════════════════════════════════════════
# 6. PuppyOne as Both Server and Client (MutOps Simulation)
# ══════════════════════════════════════════════════════════════

class TestPuppyOneAsClient:
    """Simulates PuppyOne's internal MutOps writing to repos alongside external clients."""

    def test_internal_and_external_interleaved(self, factory):
        """PuppyOne internal write (MutOps) + external CLI push with merge."""
        repo = factory.create("mixed-clients")
        internal_auth = _auth("system:web-ui")
        external_auth = _auth("cli:user-123")

        # Internal write (simulating MutOps.write_file)
        handle_push(repo, internal_auth, _push(repo.store, {"config.json": b'{"v": 1}'}))

        # External push (CLI) — base=0, will trigger merge with v1
        # The merge should preserve config.json from v1 and add readme.md
        handle_push(repo, external_auth,
                    _push(repo.store, {"readme.md": b"# Hello"}, base=0))

        files = repo.list_scope_files(internal_auth["_scope"])
        assert "config.json" in files  # preserved from v1 via merge
        assert "readme.md" in files    # added by external push

    def test_connector_sync_write(self, factory):
        """Simulates connector (Gmail/Notion) writing via MutOps."""
        repo = factory.create("connector-sync")
        sync_auth = _auth("sync:gmail:inbox")

        # Connector syncs email data
        handle_push(repo, sync_auth, _push(repo.store, {
            "inbox.json": json.dumps({"emails": [{"subject": "Hello"}]}).encode(),
        }))

        files = repo.list_scope_files(sync_auth["_scope"])
        data = json.loads(files["inbox.json"])
        assert data["emails"][0]["subject"] == "Hello"

    def test_agent_sandbox_writeback(self, factory):
        """Simulates agent sandbox executing code and writing back results."""
        repo = factory.create("agent-sandbox")
        repo.scopes.add("scope-data", "/data/")
        agent_auth = _auth("agent:research-bot", "/data/")

        # Agent processes data and writes output
        handle_push(repo, agent_auth, _push(repo.store, {
            "output.json": b'{"analysis": "complete", "score": 0.95}',
        }))

        files = repo.list_scope_files(agent_auth["_scope"])
        output = json.loads(files["output.json"])
        assert abs(output["score"] - 0.95) < 1e-9


# ══════════════════════════════════════════════════════════════
# 7. Stress: High Volume
# ══════════════════════════════════════════════════════════════

class TestHighVolumeStress:
    """Push many versions rapidly to test stability."""

    def test_50_versions_single_project(self, factory):
        repo = factory.create("high-vol")
        auth = _auth("bot")

        files = {}
        for i in range(50):
            files[f"file-{i % 10}.txt"] = f"iteration-{i}".encode()
            body = _push(repo.store, dict(files), base=i)
            r = handle_push(repo, auth, body)
            assert r["version"] == i + 1

        assert repo.get_latest_version() == 50

    def test_5_projects_10_pushes_each(self, factory):
        """5 projects each get 10 pushes — total 50 operations."""
        repos = [factory.create(f"stress-{i}") for i in range(5)]

        for proj_idx, repo in enumerate(repos):
            auth = _auth(f"agent-{proj_idx}")
            for v in range(10):
                body = _push(repo.store,
                             {f"p{proj_idx}-v{v}.txt": b"data"},
                             base=v)
                handle_push(repo, auth, body)

        for i, repo in enumerate(repos):
            assert repo.get_latest_version() == 10

    def test_negotiate_with_many_hashes(self, factory):
        """Negotiate with 100 hashes — some present, some missing."""
        repo = factory.create("negotiate-stress")
        auth = _auth("admin")

        # Push some data to create known hashes
        handle_push(repo, auth, _push(repo.store, {"big.txt": b"x" * 10000}))

        known_hashes = repo.store.all_hashes()
        fake_hashes = [f"fake{i:040d}" for i in range(50)]
        all_hashes = known_hashes[:50] + fake_hashes

        result = handle_negotiate(repo, auth, {"hashes": all_hashes})
        missing = set(result["missing"])

        # All fake hashes should be missing
        for fh in fake_hashes:
            assert fh in missing
        # Known hashes should NOT be missing
        for kh in known_hashes[:50]:
            assert kh not in missing


# ══════════════════════════════════════════════════════════════
# 8. Edge Cases
# ══════════════════════════════════════════════════════════════

class TestEdgeCases:
    """Unusual but valid scenarios."""

    def test_empty_push(self, factory):
        repo = factory.create("empty")
        auth = _auth("admin")
        result = handle_push(repo, auth, {"base_version": 0, "snapshots": [], "objects": {}})
        assert result["status"] == "ok"

    def test_clone_empty_project(self, factory):
        repo = factory.create("empty-clone")
        auth = _auth("admin")
        clone = handle_clone(repo, auth, {})
        assert clone["files"] == {}
        assert clone["version"] == 0

    def test_pull_up_to_date(self, factory):
        repo = factory.create("up-to-date")
        auth = _auth("admin")
        pull = handle_pull(repo, auth, {"since_version": 0})
        assert pull["status"] == "up-to-date"

    def test_rollback_invalid_version(self, factory):
        repo = factory.create("rb-invalid")
        auth = _auth("admin")
        handle_push(repo, auth, _push(repo.store, {"f.txt": b"x"}))

        with pytest.raises(ValueError, match="invalid"):
            handle_rollback(repo, auth, {"target_version": 999})

    def test_pull_version_zero(self, factory):
        repo = factory.create("pv-zero")
        auth = _auth("admin")
        handle_push(repo, auth, _push(repo.store, {"f.txt": b"x"}))

        with pytest.raises(ValueError, match="invalid"):
            handle_pull_version(repo, auth, {"version": 0})

    def test_push_with_binary_content(self, factory):
        repo = factory.create("binary")
        auth = _auth("admin")
        binary_data = bytes(range(256)) * 100  # 25.6KB binary

        body = _push(repo.store, {"image.bin": binary_data})
        handle_push(repo, auth, body)

        files = repo.list_scope_files(auth["_scope"])
        assert files["image.bin"] == binary_data

    def test_unicode_filenames_and_content(self, factory):
        repo = factory.create("unicode")
        auth = _auth("admin")

        content = "# 文档标题\n\n这是中文内容。\n日本語テスト。".encode("utf-8")
        body = _push(repo.store, {"docs/readme.md": content})
        handle_push(repo, auth, body)

        files = repo.list_scope_files(auth["_scope"])
        assert "docs/readme.md" in files
        assert "文档标题" in files["docs/readme.md"].decode("utf-8")
