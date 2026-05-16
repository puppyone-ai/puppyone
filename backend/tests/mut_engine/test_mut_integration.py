"""End-to-end integration test: Mut handlers running on PuppyOneServerRepo.

Simulates the full flow a local Mut client would do when connecting to
PuppyOne as the server. Uses real Mut handler code + PuppyOneServerRepo
with an in-memory object store (no S3/PG needed).

Commits are identified by git object IDs (``commit_id``, 40-hex SHA-1).
"""

import base64
import pytest

from src.mut_engine.application import tree as tree_mod
from src.mut_engine.application.git_object_format import MODE_DIR, MODE_FILE, TreeEntry, encode_tree
from tests.mut_engine._handlers import (
    handle_clone, handle_push, handle_pull,
    handle_negotiate, handle_rollback, handle_pull_commit,
)

from tests.mut_engine.test_server_repo import (
    FakeHistoryManager, FakeAuditManager, memory_store,
)


@pytest.fixture
def repo(memory_store):
    """PuppyOneServerRepo wired with real Mut handlers."""
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
    scopes.add("scope-all", "/")

    return PuppyOneServerRepo(
        project_id="test-proj",
        project_name="Integration Test",
        store=memory_store,
        history=history,
        audit=audit,
        scopes=scopes,
    )


@pytest.fixture
def auth():
    return {
        "agent": "test-agent",
        "_scope": {"id": "scope-all", "path": "/", "exclude": [], "mode": "rw"},
    }


def _make_push_body(store, files: dict, base_commit_id: str = "") -> dict:
    """Build a valid push body with a Merkle tree + all reachable objects."""
    nested: dict = {}
    for path, content in files.items():
        parts = path.split("/")
        d = nested
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        blob_hash = store.put_blob(content)
        d[parts[-1]] = ("B", blob_hash)

    def write_nested(node):
        entries: list[TreeEntry] = []
        for name, val in sorted(node.items()):
            if isinstance(val, tuple):
                entries.append(TreeEntry(name=name, mode=MODE_FILE, sha1_hex=val[1]))
            else:
                sub_hash = write_nested(val)
                entries.append(TreeEntry(name=name, mode=MODE_DIR, sha1_hex=sub_hash))
        return store.put_tree(encode_tree(entries))

    root_hash = write_nested(nested)
    reachable = tree_mod.collect_reachable_hashes(store, root_hash)
    objects_b64 = {h: base64.b64encode(store.get_loose(h)).decode() for h in reachable}

    return {
        "base_commit_id": base_commit_id,
        "snapshots": [{
            "id": 1, "root": root_hash, "message": "test push",
            "who": "test-agent", "time": "",
        }],
        "objects": objects_b64,
    }


# ── Clone ──────────────────────────────────────

class TestClone:
    def test_clone_empty(self, repo, auth):
        result = handle_clone(repo, auth, {})
        assert result["project"] == "Integration Test"
        assert result["head_commit_id"] == ""
        assert isinstance(result["files"], dict)

    def test_clone_with_files(self, repo, auth):
        body = _make_push_body(repo.store, {"hello.txt": b"Hello World"})
        handle_push(repo, auth, body)

        result = handle_clone(repo, auth, {})
        assert "hello.txt" in result["files"]
        content = base64.b64decode(result["files"]["hello.txt"])
        assert content == b"Hello World"


# ── Push ───────────────────────────────────────

class TestPush:
    def test_push_returns_commit_id(self, repo, auth):
        body = _make_push_body(repo.store, {"a.txt": b"aaa"})
        result = handle_push(repo, auth, body)
        assert result["status"] == "ok"
        assert result["commit_id"]
        assert len(result["commit_id"]) == 40
        assert repo.get_scope_head_commit_id("") == result["commit_id"]
        assert repo.get_scope_hash("") != ""

    def test_push_chains_commits(self, repo, auth):
        body1 = _make_push_body(repo.store, {"a.txt": b"v1"})
        r1 = handle_push(repo, auth, body1)

        body2 = _make_push_body(
            repo.store, {"a.txt": b"v2"}, base_commit_id=r1["commit_id"],
        )
        r2 = handle_push(repo, auth, body2)

        assert r1["commit_id"] != r2["commit_id"]
        assert repo.get_scope_head_commit_id("") == r2["commit_id"]

    def test_push_stale_base_triggers_merge(self, repo, auth):
        """Pushing against a stale base_commit_id auto-merges with HEAD.

        Three-way merge only fires when both the client's ``base_commit_id``
        and the server's head are non-empty and different. So we seed a
        shared base commit first, advance HEAD on top of it, then push a
        different file from the stale seed — the server must merge the
        two branches and keep both files.
        """
        # 1. Seed the scope with an initial commit (empty base → no merge).
        seed_body = _make_push_body(repo.store, {"seed.txt": b"seed"})
        seed = handle_push(repo, auth, seed_body)["commit_id"]

        # 2. Advance HEAD on top of seed by adding a.txt.
        body1 = _make_push_body(
            repo.store, {"seed.txt": b"seed", "a.txt": b"v1"},
            base_commit_id=seed,
        )
        handle_push(repo, auth, body1)

        # 3. Concurrent client still sees "seed" as its base and adds b.txt
        #    instead. Base (seed) != HEAD → three-way merge path.
        body2 = _make_push_body(
            repo.store, {"seed.txt": b"seed", "b.txt": b"new-file"},
            base_commit_id=seed,
        )
        r2 = handle_push(repo, auth, body2)
        assert r2["commit_id"]

        files = repo.list_scope_files(auth["_scope"])
        assert "a.txt" in files
        assert "b.txt" in files

    def test_push_readonly_rejected(self, repo):
        ro_auth = {
            "agent": "reader",
            "_scope": {"id": "scope-all", "path": "/", "exclude": [], "mode": "r"},
        }
        body = _make_push_body(repo.store, {"x.txt": b"data"})
        from src.mut_engine.application.errors import PermissionDenied
        with pytest.raises(PermissionDenied):
            handle_push(repo, ro_auth, body)


# ── Pull ───────────────────────────────────────

class TestPull:
    def test_pull_up_to_date(self, repo, auth):
        body = _make_push_body(repo.store, {"doc.md": b"# Hello"})
        r1 = handle_push(repo, auth, body)

        result = handle_pull(repo, auth, {"since_commit_id": r1["commit_id"]})
        assert result["status"] == "up-to-date"

    def test_pull_from_scratch(self, repo, auth):
        body = _make_push_body(repo.store, {"doc.md": b"# Hello"})
        handle_push(repo, auth, body)

        result = handle_pull(repo, auth, {"since_commit_id": ""})
        assert result["status"] == "updated"
        assert "doc.md" in result["files"]


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
    def test_rollback_to_earlier_commit(self, repo, auth):
        body1 = _make_push_body(repo.store, {"a.txt": b"version-1"})
        r1 = handle_push(repo, auth, body1)

        body2 = _make_push_body(
            repo.store, {"a.txt": b"version-2"}, base_commit_id=r1["commit_id"],
        )
        r2 = handle_push(repo, auth, body2)

        result = handle_rollback(
            repo, auth, {"target_commit_id": r1["commit_id"]},
        )
        assert result["status"] == "rolled-back"
        assert result["new_commit_id"]
        assert result["new_commit_id"] not in (r1["commit_id"], r2["commit_id"])
        assert result["target_commit_id"] == r1["commit_id"]

        files = repo.list_scope_files(auth["_scope"])
        assert files["a.txt"] == b"version-1"

    def test_rollback_already_at_commit(self, repo, auth):
        body = _make_push_body(repo.store, {"a.txt": b"data"})
        r1 = handle_push(repo, auth, body)

        result = handle_rollback(
            repo, auth, {"target_commit_id": r1["commit_id"]},
        )
        assert result["status"] == "already-at-commit"

    def test_rollback_unknown_commit(self, repo, auth):
        body = _make_push_body(repo.store, {"a.txt": b"data"})
        handle_push(repo, auth, body)

        with pytest.raises(ValueError, match="not found"):
            handle_rollback(repo, auth, {"target_commit_id": "0000000000000000"})


# ── Pull Commit ────────────────────────────────

class TestPullCommit:
    def test_pull_historical_commit(self, repo, auth):
        body1 = _make_push_body(repo.store, {"a.txt": b"v1-content"})
        r1 = handle_push(repo, auth, body1)

        body2 = _make_push_body(
            repo.store, {"a.txt": b"v2-content"}, base_commit_id=r1["commit_id"],
        )
        handle_push(repo, auth, body2)

        result = handle_pull_commit(repo, auth, {"commit_id": r1["commit_id"]})
        assert result["status"] == "ok"
        assert result["commit_id"] == r1["commit_id"]
        content = base64.b64decode(result["files"]["a.txt"])
        assert content == b"v1-content"

    def test_pull_commit_unknown(self, repo, auth):
        body = _make_push_body(repo.store, {"a.txt": b"data"})
        handle_push(repo, auth, body)

        with pytest.raises(ValueError, match="not found"):
            handle_pull_commit(repo, auth, {"commit_id": "0000000000000000"})


# ── Full Workflow ──────────────────────────────

class TestFullWorkflow:
    def test_push_rollback_push_pull(self, repo, auth):
        """Simulate: push v1 → push v2 → rollback to v1 → push v4 → pull."""
        body1 = _make_push_body(repo.store, {"doc.md": b"# Version 1"})
        r1 = handle_push(repo, auth, body1)

        body2 = _make_push_body(
            repo.store, {"doc.md": b"# Version 2"}, base_commit_id=r1["commit_id"],
        )
        r2 = handle_push(repo, auth, body2)
        assert r2["commit_id"] != r1["commit_id"]

        rb = handle_rollback(
            repo, auth, {"target_commit_id": r1["commit_id"]},
        )
        assert rb["status"] == "rolled-back"
        rollback_cid = rb["new_commit_id"]

        body4 = _make_push_body(
            repo.store, {"doc.md": b"# Version 4"}, base_commit_id=rollback_cid,
        )
        r4 = handle_push(repo, auth, body4)

        pull = handle_pull(repo, auth, {"since_commit_id": ""})
        assert pull["status"] == "updated"
        assert pull["head_commit_id"] == r4["commit_id"]
        content = base64.b64decode(pull["files"]["doc.md"])
        assert content == b"# Version 4"

    def test_multi_file_merge(self, repo, auth):
        """Two concurrent pushes on the same base auto-merge cleanly.

        Both writers share a common seed commit as their base. One advances
        HEAD with ``a.txt``; the other still sees seed and adds ``b.txt``.
        Server's three-way merge keeps both.
        """
        seed_body = _make_push_body(repo.store, {"seed.txt": b"seed"})
        seed = handle_push(repo, auth, seed_body)["commit_id"]

        body_a = _make_push_body(
            repo.store, {"seed.txt": b"seed", "a.txt": b"file-a"},
            base_commit_id=seed,
        )
        handle_push(repo, auth, body_a)

        body_b = _make_push_body(
            repo.store, {"seed.txt": b"seed", "b.txt": b"file-b"},
            base_commit_id=seed,
        )
        handle_push(repo, auth, body_b)

        files = repo.list_scope_files(auth["_scope"])
        assert "a.txt" in files
        assert "b.txt" in files
        assert files["a.txt"] == b"file-a"
        assert files["b.txt"] == b"file-b"

    def test_scope_state_advances_on_push(self, repo, auth):
        """Each push updates scope_hash and scope head_commit_id."""
        body = _make_push_body(repo.store, {"x.txt": b"data"})
        r1 = handle_push(repo, auth, body)

        assert repo.get_scope_head_commit_id("") == r1["commit_id"]
        hash_after_1 = repo.get_scope_hash("")
        assert hash_after_1 != ""

        body2 = _make_push_body(
            repo.store, {"y.txt": b"data2"}, base_commit_id=r1["commit_id"],
        )
        r2 = handle_push(repo, auth, body2)
        assert repo.get_scope_head_commit_id("") == r2["commit_id"]
        assert repo.get_scope_hash("") != hash_after_1
