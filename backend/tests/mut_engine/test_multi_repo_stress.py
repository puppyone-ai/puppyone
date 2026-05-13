"""Multi-repo stress tests — PuppyOne hosting multiple MUT repos.

Simulates realistic production scenarios:
  - Multiple projects (repos) running concurrently
  - PuppyOne as server + client (MutOps internal), local CLIs as external clients
  - Different scopes with different auth levels (r/rw)
  - Concurrent conflicting and non-conflicting edits
  - Access Point routing across projects
  - Scope isolation, auth rejection, rollback under concurrency

Each test creates isolated in-memory repos — no DB or S3 needed. All commit
identifiers are git object IDs (``commit_id``, 40 hex chars).
"""

import base64
import json
import pytest

from mut.core import tree as tree_mod
from mut.core.protocol import PROTOCOL_VERSION
from mut.foundation.git_format import MODE_DIR, MODE_FILE, TreeEntry, encode_tree
from tests.mut_engine._handlers import (
    handle_clone, handle_push, handle_pull,
    handle_negotiate, handle_rollback, handle_pull_commit,
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
        from src.mut_engine.server.server_repo import PuppyOneServerRepo
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
        self._repos[project_id] = repo
        return repo

    def get(self, project_id):
        return self._repos[project_id]


@pytest.fixture
def factory(tmp_path):
    return RepoFactory(tmp_path)


def _push_body(store, files, base_commit_id: str = "") -> dict:
    """Build a valid push body (Merkle root + reachable objects)."""
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
        "protocol_version": PROTOCOL_VERSION,
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
    """Convenience: push + return the resulting commit_id."""
    body = _push_body(repo.store, files, base_commit_id=base_commit_id)
    result = handle_push(repo, auth, body)
    assert result["status"] == "ok", result
    return result["commit_id"]


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

        _push(repo_a, auth_a, {"a.txt": b"A data"})
        _push(repo_b, auth_b, {"b.txt": b"B data"})

        files_a = repo_a.list_scope_files(auth_a["_scope"])
        assert "a.txt" in files_a
        assert "b.txt" not in files_a

        files_b = repo_b.list_scope_files(auth_b["_scope"])
        assert "b.txt" in files_b
        assert "a.txt" not in files_b

    def test_commit_ids_independent(self, factory):
        repo_a = factory.create("proj-a")
        repo_b = factory.create("proj-b")
        auth = _auth("admin")

        prev_a = ""
        for i in range(5):
            prev_a = _push(repo_a, auth, {f"f{i}.txt": b"x"}, base_commit_id=prev_a)

        prev_b = ""
        for i in range(2):
            prev_b = _push(repo_b, auth, {f"g{i}.txt": b"y"}, base_commit_id=prev_b)

        assert repo_a.get_scope_head_commit_id("") == prev_a
        assert repo_b.get_scope_head_commit_id("") == prev_b
        assert prev_a != prev_b

    def test_three_projects_concurrent_pushes(self, factory):
        repos = [factory.create(f"proj-{i}") for i in range(3)]
        auths = [_auth(f"user-{i}") for i in range(3)]

        cids = []
        for i, (repo, auth) in enumerate(zip(repos, auths)):
            cid = _push(repo, auth, {f"file-{i}.txt": f"data-{i}".encode()})
            cids.append(cid)

        for i, repo in enumerate(repos):
            assert repo.get_scope_head_commit_id("") == cids[i]
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
        prev = ""
        for i in range(5):
            auth = _auth(f"client-{i}")
            all_files[f"client-{i}.txt"] = f"data-{i}".encode()
            prev = _push(repo, auth, dict(all_files), base_commit_id=prev)

        files = repo.list_scope_files(_auth("any")["_scope"])
        for i in range(5):
            assert f"client-{i}.txt" in files

    def test_same_file_lww(self, factory):
        """Two clients edit the same file — second writer wins via merge."""
        repo = factory.create("conflict")
        auth_a = _auth("alice")
        auth_b = _auth("bob")

        _push(repo, auth_a, {"shared.txt": b"alice-version"})
        _push(repo, auth_b, {"shared.txt": b"bob-version"})

        files = repo.list_scope_files(auth_a["_scope"])
        assert b"bob-version" in files["shared.txt"]

    def test_20_sequential_pushes(self, factory):
        repo = factory.create("rapid")
        auth = _auth("bot")
        all_files = {}

        prev = ""
        for i in range(20):
            all_files["counter.txt"] = f"count={i}".encode()
            prev = _push(repo, auth, dict(all_files), base_commit_id=prev)

        assert repo.get_scope_head_commit_id("") == prev


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

        cid_docs = _push(repo, auth_docs, {"readme.md": b"# Docs"})
        cid_src = _push(repo, auth_src, {"main.py": b"code"})

        assert cid_docs != cid_src

        docs_files = repo.list_scope_files(auth_docs["_scope"])
        src_files = repo.list_scope_files(auth_src["_scope"])
        assert "readme.md" in docs_files
        assert "main.py" not in docs_files
        assert "main.py" in src_files

    def test_scope_head_tracking(self, factory):
        repo = factory.create("scope-head")
        repo.scopes.add("scope-docs", "/docs/")
        repo.scopes.add("scope-src", "/src/")

        auth_docs = _auth("doc", "/docs/")
        auth_src = _auth("dev", "/src/")

        last_docs = ""
        for i in range(3):
            last_docs = _push(
                repo, auth_docs, {f"d{i}.md": b"x"}, base_commit_id=last_docs,
            )

        last_src = _push(repo, auth_src, {"m.py": b"y"})

        assert repo.get_scope_head_commit_id("docs") == last_docs
        assert repo.get_scope_head_commit_id("src") == last_src


# ══════════════════════════════════════════════════════════════
# 4. Auth & Scope Enforcement
# ══════════════════════════════════════════════════════════════

class TestAuthScopeEnforcement:
    """Auth level enforcement across different scenarios."""

    def test_readonly_cannot_push(self, factory):
        repo = factory.create("auth-test")
        ro_auth = _auth("reader", "/", mode="r")

        with pytest.raises(PermissionDenied, match="read-only"):
            handle_push(repo, ro_auth, _push_body(repo.store, {"x.txt": b"data"}))

    def test_readonly_can_clone_and_pull(self, factory):
        repo = factory.create("auth-test2")
        rw_auth = _auth("admin")
        ro_auth = _auth("reader", "/", mode="r")

        _push(repo, rw_auth, {"doc.md": b"# Hello"})

        clone = handle_clone(repo, ro_auth, {})
        assert "doc.md" in clone["files"]

        pull = handle_pull(repo, ro_auth, {"since_commit_id": ""})
        assert pull["status"] == "updated"

    def test_scope_excludes_enforced(self, factory):
        repo = factory.create("exclude-test")
        auth = _auth("agent", "/docs/", excludes=["/docs/secret/"])

        body = _push_body(repo.store, {"secret/classified.txt": b"top secret"})
        with pytest.raises(PermissionDenied, match="paths outside scope"):
            handle_push(repo, auth, body)

    def test_different_auth_levels_on_same_project(self, factory):
        repo = factory.create("mixed-auth")

        rw_auth = _auth("editor", "/docs/")
        ro_auth = _auth("viewer", "/docs/", mode="r")

        _push(repo, rw_auth, {"notes.md": b"# Notes"})

        clone = handle_clone(repo, ro_auth, {})
        assert "notes.md" in clone["files"]

        body2 = _push_body(repo.store, {"hack.txt": b"nope"})
        with pytest.raises(PermissionDenied):
            handle_push(repo, ro_auth, body2)

    def test_cross_scope_isolation(self, factory):
        """Push to docs scope, pull as src scope — should see nothing."""
        repo = factory.create("cross-scope")
        repo.scopes.add("scope-docs", "/docs/")
        repo.scopes.add("scope-src", "/src/")

        docs_auth = _auth("doc", "/docs/")
        src_auth = _auth("dev", "/src/")

        _push(repo, docs_auth, {"readme.md": b"docs"})

        pull = handle_pull(repo, src_auth, {"since_commit_id": ""})
        assert "readme.md" not in pull.get("files", {})


# ══════════════════════════════════════════════════════════════
# 5. Rollback Under Concurrency
# ══════════════════════════════════════════════════════════════

class TestRollbackConcurrency:
    """Rollback while other operations are happening."""

    def test_rollback_then_push(self, factory):
        repo = factory.create("rollback-test")
        auth = _auth("admin")

        c1 = _push(repo, auth, {"f.txt": b"v1"})
        c2 = _push(repo, auth, {"f.txt": b"v2"}, base_commit_id=c1)
        assert c1 != c2

        rb = handle_rollback(repo, auth, {"target_commit_id": c1})
        assert rb["status"] == "rolled-back"
        rollback_cid = rb["new_commit_id"]

        c4 = _push(repo, auth, {"f.txt": b"v4"}, base_commit_id=rollback_cid)
        assert repo.get_scope_head_commit_id("") == c4

        files = repo.list_scope_files(auth["_scope"])
        assert files["f.txt"] == b"v4"

    def test_rollback_preserves_all_history(self, factory):
        repo = factory.create("rb-history")
        auth = _auth("admin")

        cids = []
        prev = ""
        for i in range(1, 4):
            prev = _push(
                repo, auth, {"f.txt": f"v{i}".encode()}, base_commit_id=prev,
            )
            cids.append(prev)

        rb = handle_rollback(repo, auth, {"target_commit_id": cids[0]})
        cids.append(rb["new_commit_id"])

        for cid in cids:
            entry = repo.get_history_entry(cid)
            assert entry is not None, f"commit {cid} missing from history"

    def test_pull_commit_after_rollback(self, factory):
        repo = factory.create("rb-pv")
        auth = _auth("admin")

        c1 = _push(repo, auth, {"f.txt": b"original"})
        c2 = _push(repo, auth, {"f.txt": b"changed"}, base_commit_id=c1)
        handle_rollback(repo, auth, {"target_commit_id": c1})

        # Pull the pre-rollback commit — should still show "changed"
        pv = handle_pull_commit(repo, auth, {"commit_id": c2})
        content = base64.b64decode(pv["files"]["f.txt"])
        assert content == b"changed"


# ══════════════════════════════════════════════════════════════
# 6. PuppyOne as Both Server and Client (MutOps Simulation)
# ══════════════════════════════════════════════════════════════

class TestPuppyOneAsClient:
    """Simulates PuppyOne's internal MutOps writing to repos alongside external clients."""

    def test_internal_and_external_interleaved(self, factory):
        """PuppyOne internal write (MutOps) + external CLI push with merge.

        Internal writer (MutOps) advances HEAD with ``config.json``; an
        external CLI push from the same stale seed base brings in
        ``readme.md``. Three-way merge keeps both files.
        """
        repo = factory.create("mixed-clients")
        internal_auth = _auth("system:web-ui")
        external_auth = _auth("cli:user-123")

        seed = _push(repo, internal_auth, {"seed": b"s"})
        _push(repo, internal_auth,
              {"seed": b"s", "config.json": b'{"v": 1}'},
              base_commit_id=seed)

        _push(repo, external_auth,
              {"seed": b"s", "readme.md": b"# Hello"},
              base_commit_id=seed)

        files = repo.list_scope_files(internal_auth["_scope"])
        assert "config.json" in files
        assert "readme.md" in files

    def test_connector_sync_write(self, factory):
        """Simulates connector (Gmail/Notion) writing via MutOps."""
        repo = factory.create("connector-sync")
        sync_auth = _auth("sync:gmail:inbox")

        _push(repo, sync_auth, {
            "inbox.json": json.dumps({"emails": [{"subject": "Hello"}]}).encode(),
        })

        files = repo.list_scope_files(sync_auth["_scope"])
        data = json.loads(files["inbox.json"])
        assert data["emails"][0]["subject"] == "Hello"

    def test_agent_sandbox_writeback(self, factory):
        """Simulates agent sandbox executing code and writing back results."""
        repo = factory.create("agent-sandbox")
        repo.scopes.add("scope-data", "/data/")
        agent_auth = _auth("agent:research-bot", "/data/")

        _push(repo, agent_auth, {
            "output.json": b'{"analysis": "complete", "score": 0.95}',
        })

        files = repo.list_scope_files(agent_auth["_scope"])
        output = json.loads(files["output.json"])
        assert abs(output["score"] - 0.95) < 1e-9


# ══════════════════════════════════════════════════════════════
# 7. Stress: High Volume
# ══════════════════════════════════════════════════════════════

class TestHighVolumeStress:
    """Push many versions rapidly to test stability."""

    def test_50_commits_single_project(self, factory):
        repo = factory.create("high-vol")
        auth = _auth("bot")

        files: dict[str, bytes] = {}
        prev = ""
        for i in range(50):
            files[f"file-{i % 10}.txt"] = f"iteration-{i}".encode()
            prev = _push(repo, auth, dict(files), base_commit_id=prev)

        assert repo.get_scope_head_commit_id("") == prev

    def test_5_projects_10_pushes_each(self, factory):
        """5 projects each get 10 pushes — total 50 operations."""
        repos = [factory.create(f"stress-{i}") for i in range(5)]

        final_cids = []
        for proj_idx, repo in enumerate(repos):
            auth = _auth(f"agent-{proj_idx}")
            prev = ""
            for v in range(10):
                prev = _push(
                    repo, auth,
                    {f"p{proj_idx}-v{v}.txt": b"data"},
                    base_commit_id=prev,
                )
            final_cids.append(prev)

        for i, repo in enumerate(repos):
            assert repo.get_scope_head_commit_id("") == final_cids[i]

    def test_negotiate_with_many_hashes(self, factory):
        """Negotiate with 100 hashes — some present, some missing."""
        repo = factory.create("negotiate-stress")
        auth = _auth("admin")

        _push(repo, auth, {"big.txt": b"x" * 10000})

        known_hashes = repo.store.all_hashes()
        fake_hashes = [f"fake{i:040d}" for i in range(50)]
        all_hashes = known_hashes[:50] + fake_hashes

        result = handle_negotiate(repo, auth, {"hashes": all_hashes})
        missing = set(result["missing"])

        for fh in fake_hashes:
            assert fh in missing
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
        result = handle_push(
            repo, auth,
            {"base_commit_id": "", "snapshots": [], "objects": {}},
        )
        assert result["status"] == "ok"

    def test_clone_empty_project(self, factory):
        repo = factory.create("empty-clone")
        auth = _auth("admin")
        clone = handle_clone(repo, auth, {})
        assert clone["files"] == {}

    def test_pull_up_to_date_on_empty(self, factory):
        repo = factory.create("up-to-date")
        auth = _auth("admin")
        pull = handle_pull(repo, auth, {"since_commit_id": ""})
        # Empty project: either "up-to-date" or "updated" with no files.
        assert pull["status"] in {"up-to-date", "updated"}

    def test_rollback_unknown_commit(self, factory):
        repo = factory.create("rb-invalid")
        auth = _auth("admin")
        _push(repo, auth, {"f.txt": b"x"})

        with pytest.raises(ValueError, match="not found"):
            handle_rollback(repo, auth, {"target_commit_id": "0000000000000000"})

    def test_pull_commit_unknown(self, factory):
        repo = factory.create("pv-missing")
        auth = _auth("admin")
        _push(repo, auth, {"f.txt": b"x"})

        with pytest.raises(ValueError, match="not found"):
            handle_pull_commit(repo, auth, {"commit_id": "0000000000000000"})

    def test_push_with_binary_content(self, factory):
        repo = factory.create("binary")
        auth = _auth("admin")
        binary_data = bytes(range(256)) * 100

        _push(repo, auth, {"image.bin": binary_data})

        files = repo.list_scope_files(auth["_scope"])
        assert files["image.bin"] == binary_data

    def test_unicode_filenames_and_content(self, factory):
        repo = factory.create("unicode")
        auth = _auth("admin")

        content = "# 文档标题\n\n这是中文内容。\n日本語テスト。".encode("utf-8")
        _push(repo, auth, {"docs/readme.md": content})

        files = repo.list_scope_files(auth["_scope"])
        assert "docs/readme.md" in files
        assert "文档标题" in files["docs/readme.md"].decode("utf-8")
