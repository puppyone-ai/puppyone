"""Git-native transaction-engine contract tests.

These tests mirror the important MUT push semantics from the perspective of
real Git objects: commits, trees, blobs, and scoped refs. They intentionally
exercise the new transaction core directly rather than routing through the
legacy MUT handler.
"""

from __future__ import annotations

import base64
import asyncio
import json
import socket
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
import uvicorn
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient
from src.mut_engine.application import tree as tree_mod
from src.mut_engine.application.object_store import ObjectStore
from src.mut_engine.adapters.mut.protocol import PROTOCOL_VERSION
from src.mut_engine.application.git_object_format import encode_commit
from pydantic import ValidationError

from src.mut_engine.dependencies import get_repo_manager
from src.mut_engine.adapters.git.submission import submit_git_tree
from src.mut_engine.adapters.git.object_quarantine import (
    copy_reachable_objects_to_bare,
    temporary_bare_repo,
)
from src.mut_engine.adapters.git.router import router as git_router
from src.mut_engine.adapters.git.protocol import run_git
from src.mut_engine.adapters.git.view_projection import git_view_head_commit
from src.mut_engine.adapters.mut.push_adapter import submit_mut_push
from src.mut_engine.adapters.mut.rollback_adapter import submit_mut_rollback
from src.mut_engine.application.git_commit import (
    GitCommitInvariantError,
    build_git_commit,
    commit_tree_id,
    identity_for_git,
    is_git_compatible_commit,
)
from src.mut_engine.application.protocol_mode import ensure_protocol_enabled
from src.mut_engine.application.transaction_engine import (
    CrossScopeSubmissionError,
    GitNativeTransactionEngine,
)
from src.mut_engine.application.tree_objects import build_tree_from_files, flatten_tree_to_bytes
from src.mut_engine.domain.intents import OperationWriteIntent
from src.mut_engine.services.version_outbox import process_version_outbox_batch
from src.mut_engine.services.tree_splice import splice_put_blob
from src.mut_engine.server.repo_manager import MutRepoManager
from src.platform.project.schemas import ProjectUpdate

from tests.mut_engine.test_server_repo import FakeAuditManager, FakeHistoryManager


@pytest.fixture
def memory_store(tmp_path) -> ObjectStore:
    obj_dir = tmp_path / "objects"
    obj_dir.mkdir()
    return ObjectStore(obj_dir)


@pytest.fixture
def server_repo(memory_store):
    from src.mut_engine.server.scope_manager import ScopeManager
    from src.mut_engine.server.server_repo import PuppyOneServerRepo

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


@pytest.fixture
def repo_manager(server_repo):
    manager = MagicMock(spec=MutRepoManager)
    manager.get_server_repo.return_value = server_repo
    return manager


def _git_time() -> str:
    dt = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return f"{int(dt.timestamp())} +0000"


def _make_client_commit(repo, tree_id: str, parent_id: str = "", message: str = "git push") -> str:
    identity = identity_for_git("git:user")
    body = encode_commit(
        tree_sha1=tree_id,
        parent_sha1=parent_id or None,
        author=identity,
        author_time=_git_time(),
        committer=identity,
        committer_time=_git_time(),
        message=message,
    )
    return repo.store.put_commit(body)


def _files_for_scope(repo, scope: str = "") -> dict[str, bytes]:
    tree_id = repo.get_scope_hash(scope)
    return flatten_tree_to_bytes(repo.store, tree_id)


def _init_empty_project_shell(repo) -> str:
    empty_tree = build_tree_from_files(repo.store, {})
    repo.history.set_root_hash(empty_tree)
    return empty_tree


def _pkt_line(payload: bytes) -> bytes:
    return f"{len(payload) + 4:04x}".encode("ascii") + payload


def _run_git(args: list[str], cwd, input_data: bytes | None = None) -> bytes:
    proc = _run_git_raw(args, cwd, input_data)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr.decode("utf-8", errors="replace"))
    return proc.stdout


def _run_git_raw(args: list[str], cwd, input_data: bytes | None = None) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", *args],
        cwd=cwd,
        input=input_data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return proc


def _configure_git_identity(repo_dir) -> None:
    _run_git(["config", "user.name", "Git Smoke"], repo_dir)
    _run_git(["config", "user.email", "git-smoke@example.com"], repo_dir)


def _free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextmanager
def _serve_git_app(app: FastAPI):
    port = _free_tcp_port()
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        lifespan="off",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.time() + 10
    while not server.started and thread.is_alive() and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=5)
        raise AssertionError("Git smoke test server did not start")

    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        if thread.is_alive():
            raise AssertionError("Git smoke test server did not stop")


def _make_git_receive_pack_body(tmp_path) -> tuple[bytes, str]:
    work = tmp_path / "client"
    work.mkdir()
    _run_git(["init"], work)
    _run_git(["config", "user.name", "Git User"], work)
    _run_git(["config", "user.email", "git@example.com"], work)
    (work / "README.md").write_text("hello from git\n", encoding="utf-8")
    _run_git(["add", "README.md"], work)
    _run_git(["commit", "-m", "git push readme"], work)
    head = _run_git(["rev-parse", "HEAD"], work).decode("ascii").strip()
    pack = _run_git(["pack-objects", "--stdout", "--revs"], work, f"{head}\n".encode("ascii"))
    command = (
        f"{'0' * 40} {head} refs/heads/main"
        "\0 report-status side-band-64k object-format=sha1\n"
    ).encode("ascii")
    return _pkt_line(command) + b"0000" + pack, head


def _git_access_auth(
    *,
    scope_id: str = "docs-scope",
    scope_path: str = "/docs/",
    mode: str = "rw",
    exclude: list[str] | None = None,
    user_identity: str = "",
) -> tuple[str, dict]:
    return (
        "test-proj",
        {
            "agent": f"scope:{scope_id}",
            "_scope": {
                "id": scope_id,
                "path": scope_path,
                "exclude": exclude or [],
                "mode": mode,
            },
            "_project_id": "test-proj",
            "_user_identity": user_identity,
        },
    )


def _patch_git_access_points(monkeypatch, mapping: dict[str, tuple]):
    def fake_resolve(access_key: str):
        values = mapping[access_key]
        scope_id, scope_path, mode = values[:3]
        exclude = values[3] if len(values) > 3 else None
        return _git_access_auth(
            scope_id=scope_id,
            scope_path=scope_path,
            mode=mode,
            exclude=exclude,
        )

    monkeypatch.setattr(
        "src.mut_engine.adapters.git.router.resolve_access_point",
        fake_resolve,
    )


def _receive_command_body(old_id: str, new_id: str, ref: str, pack: bytes = b"") -> bytes:
    command = (
        f"{old_id} {new_id} {ref}"
        "\0 report-status side-band-64k object-format=sha1\n"
    ).encode("ascii")
    return _pkt_line(command) + b"0000" + pack


class TestGitNativeSubmission:
    @pytest.mark.asyncio
    async def test_current_git_push_preserves_client_commit_object(
        self, repo_manager, server_repo,
    ):
        tree_id = build_tree_from_files(server_repo.store, {"README.md": b"hi"})
        client_commit_id = _make_client_commit(server_repo, tree_id)

        result = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:user",
            base_commit_id="",
            proposed_tree_id=tree_id,
            client_commit_id=client_commit_id,
            message="add readme",
        )

        assert result.commit_id == client_commit_id
        assert server_repo.get_scope_head_commit_id("") == client_commit_id
        assert _files_for_scope(server_repo) == {"README.md": b"hi"}
        assert server_repo.history._entries[-1]["commit_id"] == client_commit_id
        assert server_repo.audit.events[-1]["type"] == "git_push"

    @pytest.mark.asyncio
    async def test_stale_git_push_uses_server_side_merge(
        self, repo_manager, server_repo,
    ):
        first_tree = build_tree_from_files(server_repo.store, {"a.txt": b"server"})
        first_commit = _make_client_commit(server_repo, first_tree)
        first = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:user",
            base_commit_id="",
            proposed_tree_id=first_tree,
            client_commit_id=first_commit,
            message="add a",
        )

        stale_tree = build_tree_from_files(server_repo.store, {"b.txt": b"client"})
        stale_client_commit = _make_client_commit(server_repo, stale_tree)
        merged = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:user",
            base_commit_id="",
            proposed_tree_id=stale_tree,
            client_commit_id=stale_client_commit,
            message="stale add b",
        )

        assert first.commit_id == first_commit
        assert merged.commit_id != stale_client_commit
        assert merged.merged is True
        assert _files_for_scope(server_repo) == {
            "a.txt": b"server",
            "b.txt": b"client",
        }
        assert server_repo.get_scope_head_commit_id("") == merged.commit_id

    @pytest.mark.asyncio
    async def test_git_push_touching_child_scope_is_rejected(
        self, repo_manager, server_repo,
    ):
        server_repo.add_scope("docs-scope", "/docs/")
        tree_id = build_tree_from_files(server_repo.store, {"docs/a.md": b"hidden"})
        client_commit_id = _make_client_commit(server_repo, tree_id)

        with pytest.raises(CrossScopeSubmissionError) as exc:
            await submit_git_tree(
                repo_manager,
                project_id="test-proj",
                scope_path="",
                actor="git:user",
                base_commit_id="",
                proposed_tree_id=tree_id,
                client_commit_id=client_commit_id,
                message="bad root write",
            )

        assert exc.value.rejected_paths == ["docs/a.md"]
        assert server_repo.history._entries == []
        assert server_repo.get_scope_head_commit_id("") == ""

    @pytest.mark.asyncio
    async def test_git_push_touching_excluded_path_is_rejected(
        self, repo_manager, server_repo,
    ):
        server_repo.add_scope("docs-scope", "/docs/", exclude=["/docs/secret/"])
        tree_id = build_tree_from_files(
            server_repo.store,
            {"secret/classified.md": b"nope"},
        )
        client_commit_id = _make_client_commit(server_repo, tree_id)

        with pytest.raises(CrossScopeSubmissionError) as exc:
            await submit_git_tree(
                repo_manager,
                project_id="test-proj",
                scope_path="docs",
                scope_excludes=["/docs/secret/"],
                actor="git:user",
                base_commit_id="",
                proposed_tree_id=tree_id,
                client_commit_id=client_commit_id,
                message="bad excluded write",
            )

        assert exc.value.rejected_paths == ["docs/secret/classified.md"]
        assert server_repo.history._entries == []
        assert server_repo.get_scope_head_commit_id("docs") == ""

    @pytest.mark.asyncio
    async def test_stale_git_json_push_key_merges(self, repo_manager, server_repo):
        base_tree = build_tree_from_files(
            server_repo.store,
            {"config.json": b'{"a": 1, "b": 1}\n'},
        )
        base_commit = _make_client_commit(server_repo, base_tree, message="base config")
        base = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:a",
            base_commit_id="",
            proposed_tree_id=base_tree,
            client_commit_id=base_commit,
            message="base config",
        )

        current_tree = build_tree_from_files(
            server_repo.store,
            {"config.json": b'{"a": 2, "b": 1}\n'},
        )
        current_commit = _make_client_commit(
            server_repo, current_tree, parent_id=base.commit_id, message="change a",
        )
        await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:a",
            base_commit_id=base.commit_id,
            proposed_tree_id=current_tree,
            client_commit_id=current_commit,
            message="change a",
        )

        stale_tree = build_tree_from_files(
            server_repo.store,
            {"config.json": b'{"a": 1, "b": 3}\n'},
        )
        stale_commit = _make_client_commit(
            server_repo, stale_tree, parent_id=base.commit_id, message="change b",
        )
        merged = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:b",
            base_commit_id=base.commit_id,
            proposed_tree_id=stale_tree,
            client_commit_id=stale_commit,
            message="change b",
        )

        merged_config = json.loads(_files_for_scope(server_repo)["config.json"])
        assert merged.merged is True
        assert merged_config == {"a": 2, "b": 3}
        assert server_repo.audit.events[-1]["detail"]["merged"] is True

    @pytest.mark.asyncio
    async def test_concurrent_git_pushes_same_scope_preserve_different_files(
        self, repo_manager, server_repo,
    ):
        async def push(name: str):
            tree_id = build_tree_from_files(server_repo.store, {f"{name}.txt": name.encode()})
            commit_id = _make_client_commit(server_repo, tree_id, message=f"add {name}")
            return await submit_git_tree(
                repo_manager,
                project_id="test-proj",
                scope_path="",
                actor=f"git:{name}",
                base_commit_id="",
                proposed_tree_id=tree_id,
                client_commit_id=commit_id,
                message=f"add {name}",
            )

        results = await asyncio.gather(push("a"), push("b"), push("c"))

        assert len({result.commit_id for result in results}) == 3
        assert _files_for_scope(server_repo) == {
            "a.txt": b"a",
            "b.txt": b"b",
            "c.txt": b"c",
        }

    @pytest.mark.asyncio
    async def test_same_scope_operations_compute_in_parallel_and_cas_retry(
        self, repo_manager, server_repo,
    ):
        engine = GitNativeTransactionEngine(repo_manager)
        barrier = threading.Barrier(2, timeout=2)
        calls: dict[str, int] = {"a": 0, "b": 0}

        async def write(name: str):
            def splice(store, root_hash):
                calls[name] += 1
                if calls[name] == 1:
                    barrier.wait()
                return splice_put_blob(
                    store,
                    root_hash,
                    f"{name}.txt",
                    name.encode(),
                )

            return await engine.apply_operation(
                OperationWriteIntent(
                    project_id="test-proj",
                    scope_path="",
                    actor=f"papi:{name}",
                    source_channel="papi",
                    operation_type="write_file",
                    message=f"write {name}",
                    audit_detail={"path": f"{name}.txt"},
                ),
                splice,
            )

        results = await asyncio.gather(write("a"), write("b"))

        assert len({result.commit_id for result in results}) == 2
        assert _files_for_scope(server_repo) == {
            "a.txt": b"a",
            "b.txt": b"b",
        }
        assert sum(calls.values()) == 3
        assert sorted(calls.values()) == [1, 2]
        assert any(
            event["detail"]["cas_attempts"] == 2
            for event in server_repo.audit.events
        )

    @pytest.mark.asyncio
    async def test_git_pushes_to_different_scopes_advance_independent_heads(
        self, repo_manager, server_repo,
    ):
        server_repo.add_scope("docs-scope", "/docs/")
        server_repo.add_scope("src-scope", "/src/")
        docs_tree = build_tree_from_files(server_repo.store, {"README.md": b"docs"})
        src_tree = build_tree_from_files(server_repo.store, {"app.py": b"print('src')"})
        docs_commit = _make_client_commit(server_repo, docs_tree, message="docs")
        src_commit = _make_client_commit(server_repo, src_tree, message="src")

        await asyncio.gather(
            submit_git_tree(
                repo_manager,
                project_id="test-proj",
                scope_path="docs",
                actor="git:docs",
                base_commit_id="",
                proposed_tree_id=docs_tree,
                client_commit_id=docs_commit,
                message="docs",
            ),
            submit_git_tree(
                repo_manager,
                project_id="test-proj",
                scope_path="src",
                actor="git:src",
                base_commit_id="",
                proposed_tree_id=src_tree,
                client_commit_id=src_commit,
                message="src",
            ),
        )

        assert server_repo.get_scope_head_commit_id("docs") == docs_commit
        assert server_repo.get_scope_head_commit_id("src") == src_commit
        assert _files_for_scope(server_repo, "docs") == {"README.md": b"docs"}
        assert _files_for_scope(server_repo, "src") == {"app.py": b"print('src')"}

    @pytest.mark.asyncio
    async def test_stale_git_delete_modify_requires_manual_review(
        self, repo_manager, server_repo,
    ):
        base_tree = build_tree_from_files(server_repo.store, {"a.txt": b"base\n"})
        base_commit = _make_client_commit(server_repo, base_tree, message="base")
        base = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:base",
            base_commit_id="",
            proposed_tree_id=base_tree,
            client_commit_id=base_commit,
            message="base",
        )

        server_tree = build_tree_from_files(server_repo.store, {"a.txt": b"server changed\n"})
        server_commit = _make_client_commit(
            server_repo, server_tree, parent_id=base.commit_id, message="server modifies",
        )
        await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:server",
            base_commit_id=base.commit_id,
            proposed_tree_id=server_tree,
            client_commit_id=server_commit,
            message="server modifies",
        )
        current_head = server_repo.get_scope_head_commit_id("")

        delete_tree = build_tree_from_files(server_repo.store, {})
        delete_commit = _make_client_commit(
            server_repo, delete_tree, parent_id=base.commit_id, message="stale deletes",
        )
        result = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:stale",
            base_commit_id=base.commit_id,
            proposed_tree_id=delete_tree,
            client_commit_id=delete_commit,
            message="stale deletes",
        )

        assert result.status == "pending"
        assert result.conflicts == 1
        assert _files_for_scope(server_repo) == {"a.txt": b"server changed\n"}
        assert server_repo.get_scope_head_commit_id("") == current_head
        assert server_repo.audit.events[-1]["type"] == "git_push_conflict_pending"
        assert server_repo.audit.events[-1]["detail"]["conflicts"][0]["strategy"] == "modify_delete"

    @pytest.mark.asyncio
    async def test_stale_git_binary_conflict_requires_manual_review(
        self, repo_manager, server_repo,
    ):
        base_tree = build_tree_from_files(server_repo.store, {"asset.bin": b"\x00base"})
        base_commit = _make_client_commit(server_repo, base_tree, message="base binary")
        base = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:base",
            base_commit_id="",
            proposed_tree_id=base_tree,
            client_commit_id=base_commit,
            message="base binary",
        )

        server_tree = build_tree_from_files(server_repo.store, {"asset.bin": b"\x00server"})
        server_commit = _make_client_commit(
            server_repo, server_tree, parent_id=base.commit_id, message="server binary",
        )
        await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:server",
            base_commit_id=base.commit_id,
            proposed_tree_id=server_tree,
            client_commit_id=server_commit,
            message="server binary",
        )
        current_head = server_repo.get_scope_head_commit_id("")

        stale_tree = build_tree_from_files(server_repo.store, {"asset.bin": b"\x00client"})
        stale_commit = _make_client_commit(
            server_repo, stale_tree, parent_id=base.commit_id, message="client binary",
        )
        result = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:client",
            base_commit_id=base.commit_id,
            proposed_tree_id=stale_tree,
            client_commit_id=stale_commit,
            message="client binary",
        )

        conflict = server_repo.audit.events[-1]["detail"]["conflicts"][0]
        assert result.status == "pending"
        assert result.conflicts == 1
        assert _files_for_scope(server_repo) == {"asset.bin": b"\x00server"}
        assert server_repo.get_scope_head_commit_id("") == current_head
        assert conflict["strategy"] == "manual_review"


class TestLegacyMutPushAdapter:
    @pytest.mark.asyncio
    async def test_mut_push_uses_same_git_native_engine(self, repo_manager, server_repo):
        tree_id = build_tree_from_files(server_repo.store, {"main.py": b"print(1)"})
        reachable = tree_mod.collect_reachable_hashes(server_repo.store, tree_id)
        objects_b64 = {
            object_id: base64.b64encode(server_repo.store.get_loose(object_id)).decode()
            for object_id in reachable
        }
        auth = {
            "agent": "mut-agent",
            "_scope": {"id": "root", "path": "", "exclude": [], "mode": "rw"},
        }

        result = await submit_mut_push(
            repo_manager,
            "test-proj",
            auth,
            {
                "protocol_version": PROTOCOL_VERSION,
                "base_commit_id": "",
                "snapshots": [{
                    "id": 1,
                    "root": tree_id,
                    "message": "mut push",
                    "who": "mut-agent",
                    "time": "2026-01-01T00:00:00Z",
                }],
                "objects": objects_b64,
            },
        )

        assert result["status"] == "ok"
        assert len(result["commit_id"]) == 40
        assert result["root"] == server_repo.get_scope_hash("")
        assert _files_for_scope(server_repo) == {"main.py": b"print(1)"}
        assert server_repo.audit.events[-1]["type"] == "mut_push"

    @pytest.mark.asyncio
    async def test_mut_push_touching_excluded_path_uses_same_scope_guard(
        self, repo_manager, server_repo,
    ):
        server_repo.add_scope("docs-scope", "/docs/", exclude=["/docs/secret/"])
        tree_id = build_tree_from_files(
            server_repo.store,
            {"secret/classified.md": b"hidden"},
        )
        reachable = tree_mod.collect_reachable_hashes(server_repo.store, tree_id)
        objects_b64 = {
            object_id: base64.b64encode(server_repo.store.get_loose(object_id)).decode()
            for object_id in reachable
        }
        auth = {
            "agent": "mut-agent",
            "_scope": {
                "id": "docs-scope",
                "path": "/docs/",
                "exclude": ["/docs/secret/"],
                "mode": "rw",
            },
        }

        with pytest.raises(PermissionError, match="outside its scope"):
            await submit_mut_push(
                repo_manager,
                "test-proj",
                auth,
                {
                    "protocol_version": PROTOCOL_VERSION,
                    "base_commit_id": "",
                    "snapshots": [{
                        "id": 1,
                        "root": tree_id,
                        "message": "mut excluded push",
                        "who": "mut-agent",
                        "time": "2026-01-01T00:00:00Z",
                    }],
                    "objects": objects_b64,
                },
            )

        assert server_repo.get_scope_head_commit_id("docs") == ""


class TestGitNativeHardeningContracts:
    @pytest.mark.asyncio
    async def test_engine_publishes_through_single_repo_boundary(
        self, repo_manager, server_repo,
    ):
        calls = []

        def fake_publish(**kwargs):
            calls.append(kwargs)
            assert server_repo.history.cas_update_scope_hash(
                kwargs["scope_path"],
                kwargs["old_scope_hash"],
                kwargs["new_scope_hash"],
                kwargs["commit_id"],
            )
            server_repo.history.record(
                kwargs["commit_id"],
                kwargs["who"],
                kwargs["message"],
                kwargs["scope_path"],
                kwargs["changes"],
                kwargs["conflicts"],
                scope_hash=kwargs["new_scope_hash"],
                created_at_iso=kwargs["created_at_iso"],
            )
            server_repo.audit.record(
                kwargs["audit_event_type"],
                kwargs["audit_agent_id"],
                kwargs["audit_detail"],
            )
            return True

        server_repo.publish_scope_update = fake_publish
        server_repo.record_history = MagicMock(side_effect=AssertionError("bypassed publish"))
        server_repo.record_audit = MagicMock(side_effect=AssertionError("bypassed publish"))

        tree_id = build_tree_from_files(server_repo.store, {"atomic.txt": b"ok"})
        commit_id = _make_client_commit(server_repo, tree_id, message="atomic")
        result = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:atomic",
            base_commit_id="",
            proposed_tree_id=tree_id,
            client_commit_id=commit_id,
            message="atomic",
        )

        assert result.status == "ok"
        assert len(calls) == 1
        assert calls[0]["audit_event_type"] == "git_push"
        assert calls[0]["commit_id"] == commit_id

    @pytest.mark.asyncio
    async def test_mut_rollback_uses_engine_and_updates_grafted_history(
        self, repo_manager, server_repo,
    ):
        v1_tree = build_tree_from_files(server_repo.store, {"doc.md": b"v1"})
        v1_commit = _make_client_commit(server_repo, v1_tree, message="v1")
        v1 = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:user",
            base_commit_id="",
            proposed_tree_id=v1_tree,
            client_commit_id=v1_commit,
            message="v1",
        )
        v2_tree = build_tree_from_files(server_repo.store, {"doc.md": b"v2"})
        v2_commit = _make_client_commit(server_repo, v2_tree, parent_id=v1.commit_id, message="v2")
        await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:user",
            base_commit_id=v1.commit_id,
            proposed_tree_id=v2_tree,
            client_commit_id=v2_commit,
            message="v2",
        )

        result = await submit_mut_rollback(
            repo_manager,
            "test-proj",
            {
                "agent": "mut-agent",
                "_scope": {"id": "root", "path": "", "exclude": [], "mode": "rw"},
            },
            {"protocol_version": PROTOCOL_VERSION, "target_commit_id": v1.commit_id},
        )

        assert result["status"] == "rolled-back"
        assert result["new_commit_id"] != v1.commit_id
        assert _files_for_scope(server_repo) == {"doc.md": b"v1"}
        assert server_repo.audit.events[-1]["type"] == "rollback"
        assert server_repo.history._version_index

    @pytest.mark.asyncio
    async def test_project_view_history_uses_persistent_graft_index(
        self, repo_manager, server_repo,
    ):
        server_repo.add_scope("docs-scope", "/docs/")
        tree_id = build_tree_from_files(server_repo.store, {"README.md": b"docs"})
        client_commit = _make_client_commit(server_repo, tree_id, message="docs")

        await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="docs",
            actor="git:docs",
            base_commit_id="",
            proposed_tree_id=tree_id,
            client_commit_id=client_commit,
            message="docs",
        )

        indexed = server_repo.history._version_index[-1]
        project_head = git_view_head_commit(server_repo, "")
        assert project_head == indexed["project_view_commit_id"]
        assert commit_tree_id(server_repo, project_head) == indexed["project_root_hash"]

    def test_empty_project_shell_has_no_git_head(self, server_repo):
        empty_tree = _init_empty_project_shell(server_repo)

        assert server_repo.get_root_hash() == empty_tree
        assert server_repo.get_head_commit_id() == ""
        assert git_view_head_commit(server_repo, "") == ""

    @pytest.mark.asyncio
    async def test_protocol_mode_gate_rejects_disabled_protocols(self, monkeypatch):
        monkeypatch.setattr(
            "src.mut_engine.application.protocol_mode.get_project_protocol_mode",
            lambda _project_id: "mut",
        )
        with pytest.raises(HTTPException, match="GIT protocol is disabled"):
            await ensure_protocol_enabled("test-proj", "git")

        monkeypatch.setattr(
            "src.mut_engine.application.protocol_mode.get_project_protocol_mode",
            lambda _project_id: "git",
        )
        with pytest.raises(HTTPException, match="MUT protocol is disabled"):
            await ensure_protocol_enabled("test-proj", "mut")

    @pytest.mark.asyncio
    async def test_protocol_mode_gate_fails_closed_when_policy_unavailable(self, monkeypatch):
        class BrokenSupabase:
            def __init__(self):
                raise RuntimeError("db down")

        import src.mut_engine.application.protocol_mode as protocol_mode

        monkeypatch.setattr(protocol_mode.settings, "MUT_PROTOCOL_MODE_FAIL_OPEN", False)
        monkeypatch.setattr(protocol_mode, "SupabaseClient", BrokenSupabase)

        with pytest.raises(HTTPException) as exc:
            await ensure_protocol_enabled("test-proj", "git")

        assert exc.value.status_code == 503
        assert "protocol mode is unavailable" in exc.value.detail

    def test_project_protocol_mode_schema_rejects_unknown_mode(self):
        with pytest.raises(ValidationError):
            ProjectUpdate(protocol_mode="svn")

    def test_build_git_commit_rejects_non_git_parent(
        self, server_repo,
    ):
        tree_id = build_tree_from_files(server_repo.store, {"README.md": b"hello\n"})

        with pytest.raises(GitCommitInvariantError):
            build_git_commit(
                server_repo,
                tree_sha=tree_id,
                parent_sha="1dda56a9166ce3d1",
                who="web:user",
                message="bad parent",
                created_at_iso="2026-01-01T00:00:00+00:00",
            )

    def test_quarantine_materializes_reachable_objects_without_full_store(
        self, tmp_path, server_repo,
    ):
        reachable_tree = build_tree_from_files(server_repo.store, {"a.txt": b"a"})
        reachable_commit = _make_client_commit(server_repo, reachable_tree, message="reachable")
        unreachable_blob = server_repo.store.put_blob(b"unreachable")
        bare_dir = tmp_path / "repo.git"
        run_git(["init", "--bare", str(bare_dir)])

        copy_reachable_objects_to_bare(server_repo, bare_dir, [reachable_commit])

        assert (bare_dir / "objects" / reachable_commit[:2] / reachable_commit[2:]).exists()
        assert (bare_dir / "objects" / reachable_tree[:2] / reachable_tree[2:]).exists()
        assert not (bare_dir / "objects" / unreachable_blob[:2] / unreachable_blob[2:]).exists()

    def test_git_view_rewrites_legacy_bad_parent_before_upload_pack(
        self, server_repo,
    ):
        server_repo.add_scope("docs-scope", "/docs/")
        bad_tree = build_tree_from_files(server_repo.store, {"README.md": b"legacy\n"})
        bad_commit = _make_client_commit(
            server_repo,
            bad_tree,
            parent_id="1dda56a9166ce3d1",
            message="legacy bad parent",
        )
        head_tree = build_tree_from_files(server_repo.store, {"README.md": b"current\n"})
        head_commit = _make_client_commit(
            server_repo,
            head_tree,
            parent_id=bad_commit,
            message="current",
        )
        server_repo.history.set_scope_hash("docs", head_tree)
        server_repo.set_scope_head_commit_id("docs", head_commit)

        projected = git_view_head_commit(server_repo, "docs")

        assert projected != head_commit
        assert commit_tree_id(server_repo, projected) == head_tree
        with temporary_bare_repo(server_repo, "docs") as bare_dir:
            run_git(["--git-dir", str(bare_dir), "fsck", "--full", "--strict"])

    @pytest.mark.asyncio
    async def test_operation_after_legacy_bad_head_uses_git_compatible_parent(
        self, repo_manager, server_repo,
    ):
        server_repo.add_scope("docs-scope", "/docs/")
        bad_tree = build_tree_from_files(server_repo.store, {"README.md": b"legacy\n"})
        bad_commit = _make_client_commit(
            server_repo,
            bad_tree,
            parent_id="1dda56a9166ce3d1",
            message="legacy bad parent",
        )
        server_repo.history.set_scope_hash("docs", bad_tree)
        server_repo.set_scope_head_commit_id("docs", bad_commit)

        result = await GitNativeTransactionEngine(repo_manager).apply_operation(
            OperationWriteIntent(
                project_id="test-proj",
                scope_path="docs",
                actor="web:user",
                source_channel="web",
                operation_type="write_file",
                message="write after legacy head",
            ),
            lambda store, root: splice_put_blob(
                store,
                root,
                "next.md",
                b"new write\n",
            ),
        )

        assert result.commit_id != bad_commit
        assert is_git_compatible_commit(server_repo, result.commit_id)
        with temporary_bare_repo(server_repo, "docs") as bare_dir:
            run_git(["--git-dir", str(bare_dir), "fsck", "--full", "--strict"])

    @pytest.mark.asyncio
    async def test_submit_version_does_not_preserve_malformed_client_commit(
        self, repo_manager, server_repo,
    ):
        tree_id = build_tree_from_files(server_repo.store, {"README.md": b"from client\n"})
        malformed_client_commit = _make_client_commit(
            server_repo,
            tree_id,
            parent_id="1dda56a9166ce3d1",
            message="malformed client commit",
        )

        result = await submit_git_tree(
            repo_manager,
            project_id="test-proj",
            scope_path="",
            actor="git:user",
            base_commit_id="",
            proposed_tree_id=tree_id,
            client_commit_id=malformed_client_commit,
            message="git push",
        )

        assert result.commit_id != malformed_client_commit
        assert is_git_compatible_commit(server_repo, result.commit_id)


def test_git_protocol_routes_exist():
    paths = {route.path for route in git_router.routes}
    assert "/git/{project_id}.git/info/refs" in paths
    assert "/git/ap/{access_key}.git/info/refs" in paths
    assert "/git/{project_id}.git/git-receive-pack" in paths
    assert "/git/ap/{access_key}.git/git-receive-pack" in paths
    assert "/git/{project_id}.git/git-upload-pack" in paths
    assert "/git/ap/{access_key}.git/git-upload-pack" in paths


class _RpcResponse:
    def __init__(self, data):
        self.data = data


class _RpcCall:
    def __init__(self, response):
        self._response = response

    def execute(self):
        return self._response


class _FakeOutboxClient:
    def __init__(self, rows):
        self.rows = rows
        self.completed: list[int] = []
        self.failed: list[tuple[int, str]] = []

    def rpc(self, name, args):
        if name == "claim_mut_version_outbox_batch":
            return _RpcCall(_RpcResponse(self.rows))
        if name == "complete_mut_version_outbox":
            self.completed.append(args["p_id"])
            return _RpcCall(_RpcResponse(True))
        if name == "fail_mut_version_outbox":
            self.failed.append((args["p_id"], args["p_error"]))
            return _RpcCall(_RpcResponse(True))
        raise AssertionError(name)


def test_version_outbox_worker_replays_hook_and_marks_complete(monkeypatch):
    calls = []

    def fake_hook(project_id, repo_manager, push_result, *, raise_errors=False):
        calls.append((project_id, repo_manager, push_result, raise_errors))

    monkeypatch.setattr(
        "src.mut_engine.services.version_outbox.run_post_push_hook",
        fake_hook,
    )
    client = _FakeOutboxClient([
        {
            "id": 10,
            "project_id": "test-proj",
            "commit_id": "a" * 40,
            "event_type": "version_committed",
            "payload": {"scope_hash": "b" * 40, "conflicts": 0},
            "attempts": 1,
        }
    ])
    repo_manager = object()

    processed = process_version_outbox_batch(
        repo_manager=repo_manager,
        client=client,
        limit=10,
    )

    assert processed == 1
    assert client.completed == [10]
    assert client.failed == []
    assert calls == [
        (
            "test-proj",
            repo_manager,
            {
                "status": "ok",
                "commit_id": "a" * 40,
                "root": "b" * 40,
                "merged": False,
                "conflicts": 0,
            },
            True,
        )
    ]


def test_version_outbox_worker_marks_failure_for_retry(monkeypatch):
    def fake_hook(*_args, **_kwargs):
        raise RuntimeError("projection unavailable")

    monkeypatch.setattr(
        "src.mut_engine.services.version_outbox.run_post_push_hook",
        fake_hook,
    )
    client = _FakeOutboxClient([
        {
            "id": 11,
            "project_id": "test-proj",
            "commit_id": "c" * 40,
            "event_type": "version_committed",
            "payload": {"scope_hash": "d" * 40},
            "attempts": 1,
        }
    ])

    processed = process_version_outbox_batch(
        repo_manager=object(),
        client=client,
        limit=10,
    )

    assert processed == 0
    assert client.completed == []
    assert client.failed == [(11, "projection unavailable")]


def test_git_project_receive_pack_requires_credentials(
    tmp_path, repo_manager, server_repo,
):
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager
    body, client_commit_id = _make_git_receive_pack_body(tmp_path)

    with TestClient(app) as client:
        response = client.post(
            "/git/test-proj.git/git-receive-pack",
            content=body,
            headers={"content-type": "application/x-git-receive-pack-request"},
        )

    assert client_commit_id
    assert response.status_code == 401
    assert response.json()["detail"] == "Missing Git credentials"
    assert server_repo.get_scope_head_commit_id("") == ""


def test_git_ap_info_refs_advertises_receive_pack(monkeypatch, repo_manager, server_repo):
    server_repo.add_scope("docs-scope", "/docs/")
    monkeypatch.setattr(
        "src.mut_engine.adapters.git.router.resolve_access_point",
        lambda access_key: _git_access_auth(),
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with TestClient(app) as client:
        response = client.get(
            "/git/ap/test-key.git/info/refs",
            params={"service": "git-receive-pack"},
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/x-git-receive-pack-advertisement",
    )
    assert b"# service=git-receive-pack" in response.content


def test_git_access_point_receive_pack_uses_bound_scope_and_identity(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    monkeypatch.setattr(
        "src.mut_engine.adapters.git.router.resolve_access_point",
        lambda access_key: _git_access_auth(user_identity="alice@example.com"),
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager
    body, client_commit_id = _make_git_receive_pack_body(tmp_path)

    with TestClient(app) as client:
        response = client.post(
            "/git/ap/test-key.git/git-receive-pack",
            content=body,
            headers={
                "content-type": "application/x-git-receive-pack-request",
                "x-mut-user": "alice@example.com",
            },
        )

    assert response.status_code == 200
    assert b"unpack ok" in response.content
    assert b"ok refs/heads/main" in response.content
    assert server_repo.get_scope_head_commit_id("docs") == client_commit_id
    assert server_repo.get_scope_head_commit_id("") == ""
    assert _files_for_scope(server_repo, "docs") == {"README.md": b"hello from git\n"}
    assert server_repo.audit.events[-1]["type"] == "git_push"
    assert server_repo.audit.events[-1]["agent"] == "alice@example.com"


def test_git_access_point_rejects_bound_identity_mismatch(
    monkeypatch, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    monkeypatch.setattr(
        "src.mut_engine.adapters.git.router.resolve_access_point",
        lambda access_key: _git_access_auth(user_identity="alice@example.com"),
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with TestClient(app) as client:
        response = client.get(
            "/git/ap/test-key.git/info/refs",
            params={"service": "git-receive-pack"},
            headers={"x-mut-user": "bob@example.com"},
        )

    assert response.status_code == 401
    assert "different user" in response.json()["detail"]


def test_git_access_point_readonly_push_is_rejected(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    monkeypatch.setattr(
        "src.mut_engine.adapters.git.router.resolve_access_point",
        lambda access_key: _git_access_auth(mode="r"),
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager
    body, _client_commit_id = _make_git_receive_pack_body(tmp_path)

    with TestClient(app) as client:
        response = client.post(
            "/git/ap/test-key.git/git-receive-pack",
            content=body,
            headers={"content-type": "application/x-git-receive-pack-request"},
        )

    assert response.status_code == 200
    assert b"ng refs/heads/main access point is read-only" in response.content
    assert server_repo.get_scope_head_commit_id("docs") == ""
    assert server_repo.audit.events == []


def test_real_git_cli_can_clone_commit_push_and_clone_again(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    monkeypatch.setattr(
        "src.mut_engine.adapters.git.router.resolve_access_point",
        lambda access_key: _git_access_auth(),
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/test-key.git"
        first = tmp_path / "first"
        second = tmp_path / "second"

        _run_git(["clone", remote, str(first)], tmp_path)
        _configure_git_identity(first)
        (first / "README.md").write_text("hello through real git\n", encoding="utf-8")
        _run_git(["add", "README.md"], first)
        _run_git(["commit", "-m", "real git smoke"], first)
        pushed_head = _run_git(["rev-parse", "HEAD"], first).decode("ascii").strip()
        _run_git(["push", "origin", "main"], first)

        _run_git(["clone", remote, str(second)], tmp_path)

    assert server_repo.get_scope_head_commit_id("docs") == pushed_head
    assert _files_for_scope(server_repo, "docs") == {
        "README.md": b"hello through real git\n",
    }
    assert (second / "README.md").read_text(encoding="utf-8") == "hello through real git\n"
    assert server_repo.audit.events[-1]["type"] == "git_push"


def test_real_git_cli_first_push_to_empty_project_shell(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("root-scope", "")
    _init_empty_project_shell(server_repo)
    _patch_git_access_points(
        monkeypatch,
        {"root-key": ("root-scope", "", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/root-key.git"
        work = tmp_path / "existing"
        verify = tmp_path / "verify"
        work.mkdir()
        _run_git(["init"], work)
        _configure_git_identity(work)
        (work / "README.md").write_text("first project content\n", encoding="utf-8")
        _run_git(["add", "README.md"], work)
        _run_git(["commit", "-m", "first content"], work)
        _run_git(["branch", "-M", "main"], work)
        pushed_head = _run_git(["rev-parse", "HEAD"], work).decode("ascii").strip()
        _run_git(["remote", "add", "origin", remote], work)
        _run_git(["push", "-u", "origin", "main"], work)

        _run_git(["clone", remote, str(verify)], tmp_path)

    assert server_repo.get_scope_head_commit_id("") == pushed_head
    assert server_repo.get_head_commit_id() == pushed_head
    assert _files_for_scope(server_repo) == {"README.md": b"first project content\n"}
    assert (verify / "README.md").read_text(encoding="utf-8") == "first project content\n"


def test_real_git_cli_stale_force_push_is_server_side_merged(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"test-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/test-key.git"
        first = tmp_path / "first"
        second = tmp_path / "second"
        verify = tmp_path / "verify"

        _run_git(["clone", remote, str(first)], tmp_path)
        _run_git(["clone", remote, str(second)], tmp_path)
        _configure_git_identity(first)
        _configure_git_identity(second)

        (first / "a.txt").write_text("from first\n", encoding="utf-8")
        _run_git(["add", "a.txt"], first)
        _run_git(["commit", "-m", "first adds a"], first)
        _run_git(["push", "origin", "main"], first)

        (second / "b.txt").write_text("from stale second\n", encoding="utf-8")
        _run_git(["add", "b.txt"], second)
        _run_git(["commit", "-m", "second adds b from stale base"], second)
        stale_head = _run_git(["rev-parse", "HEAD"], second).decode("ascii").strip()
        _run_git(["push", "--force", "origin", "main"], second)

        _run_git(["clone", remote, str(verify)], tmp_path)

    assert server_repo.get_scope_head_commit_id("docs") != stale_head
    assert _files_for_scope(server_repo, "docs") == {
        "a.txt": b"from first\n",
        "b.txt": b"from stale second\n",
    }
    assert (verify / "a.txt").read_text(encoding="utf-8") == "from first\n"
    assert (verify / "b.txt").read_text(encoding="utf-8") == "from stale second\n"
    assert server_repo.audit.events[-1]["detail"]["merged"] is True


def test_real_git_cli_scoped_remotes_do_not_leak_sibling_worktrees(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    server_repo.add_scope("src-scope", "/src/")
    _patch_git_access_points(
        monkeypatch,
        {
            "docs-key": ("docs-scope", "/docs/", "rw"),
            "src-key": ("src-scope", "/src/", "rw"),
        },
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        docs_remote = f"{base_url}/git/ap/docs-key.git"
        src_remote = f"{base_url}/git/ap/src-key.git"
        docs = tmp_path / "docs"
        src = tmp_path / "src"
        docs_again = tmp_path / "docs-again"
        src_again = tmp_path / "src-again"

        _run_git(["clone", docs_remote, str(docs)], tmp_path)
        _configure_git_identity(docs)
        (docs / "README.md").write_text("docs only\n", encoding="utf-8")
        _run_git(["add", "README.md"], docs)
        _run_git(["commit", "-m", "docs"], docs)
        _run_git(["push", "origin", "main"], docs)

        _run_git(["clone", src_remote, str(src)], tmp_path)
        assert not (src / "README.md").exists()
        _configure_git_identity(src)
        (src / "app.py").write_text("print('src only')\n", encoding="utf-8")
        _run_git(["add", "app.py"], src)
        _run_git(["commit", "-m", "src"], src)
        _run_git(["push", "origin", "main"], src)

        _run_git(["clone", docs_remote, str(docs_again)], tmp_path)
        _run_git(["clone", src_remote, str(src_again)], tmp_path)

    assert (docs_again / "README.md").read_text(encoding="utf-8") == "docs only\n"
    assert not (docs_again / "app.py").exists()
    assert (src_again / "app.py").read_text(encoding="utf-8") == "print('src only')\n"
    assert not (src_again / "README.md").exists()
    assert server_repo.get_scope_head_commit_id("docs")
    assert server_repo.get_scope_head_commit_id("src")


def test_real_git_cli_multi_commit_push_preserves_commit_chain(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"test-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/test-key.git"
        work = tmp_path / "work"
        verify = tmp_path / "verify"

        _run_git(["clone", remote, str(work)], tmp_path)
        _configure_git_identity(work)
        (work / "one.txt").write_text("one\n", encoding="utf-8")
        _run_git(["add", "one.txt"], work)
        _run_git(["commit", "-m", "one"], work)
        first_commit = _run_git(["rev-parse", "HEAD"], work).decode("ascii").strip()
        (work / "two.txt").write_text("two\n", encoding="utf-8")
        _run_git(["add", "two.txt"], work)
        _run_git(["commit", "-m", "two"], work)
        second_commit = _run_git(["rev-parse", "HEAD"], work).decode("ascii").strip()
        _run_git(["push", "origin", "main"], work)

        _run_git(["clone", remote, str(verify)], tmp_path)
        log = _run_git(["log", "--format=%H:%s"], verify).decode("utf-8")

    assert server_repo.get_scope_head_commit_id("docs") == second_commit
    assert _files_for_scope(server_repo, "docs") == {
        "one.txt": b"one\n",
        "two.txt": b"two\n",
    }
    assert f"{second_commit}:two" in log
    assert f"{first_commit}:one" in log


def test_real_git_cli_readonly_access_point_can_clone_but_push_is_rejected(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"test-key": ("docs-scope", "/docs/", "r")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/test-key.git"
        work = tmp_path / "readonly"

        _run_git(["clone", remote, str(work)], tmp_path)
        _configure_git_identity(work)
        (work / "README.md").write_text("should not land\n", encoding="utf-8")
        _run_git(["add", "README.md"], work)
        _run_git(["commit", "-m", "blocked"], work)
        proc = _run_git_raw(["push", "origin", "main"], work)

    assert proc.returncode != 0
    assert b"access point is read-only" in proc.stderr
    assert server_repo.get_scope_head_commit_id("docs") == ""
    assert server_repo.audit.events == []


def test_real_git_cli_scoped_remote_rejects_unadvertised_sibling_object_fetch(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    server_repo.add_scope("src-scope", "/src/")
    _patch_git_access_points(
        monkeypatch,
        {
            "docs-key": ("docs-scope", "/docs/", "rw"),
            "src-key": ("src-scope", "/src/", "rw"),
        },
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        docs_remote = f"{base_url}/git/ap/docs-key.git"
        src_remote = f"{base_url}/git/ap/src-key.git"
        src = tmp_path / "src"
        docs = tmp_path / "docs"

        _run_git(["clone", src_remote, str(src)], tmp_path)
        _configure_git_identity(src)
        (src / "secret.txt").write_text("src secret\n", encoding="utf-8")
        _run_git(["add", "secret.txt"], src)
        _run_git(["commit", "-m", "src secret"], src)
        src_commit = _run_git(["rev-parse", "HEAD"], src).decode("ascii").strip()
        _run_git(["push", "origin", "main"], src)

        _run_git(["clone", docs_remote, str(docs)], tmp_path)
        proc = _run_git_raw(["fetch", "origin", src_commit], docs)

    assert proc.returncode != 0
    assert not (docs / "secret.txt").exists()


def test_real_git_cli_root_view_grafts_child_scope_worktrees(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("root-scope", "/")
    server_repo.add_scope("docs-scope", "/docs/")
    server_repo.add_scope("src-scope", "/src/")
    _patch_git_access_points(
        monkeypatch,
        {
            "root-key": ("root-scope", "/", "rw"),
            "docs-key": ("docs-scope", "/docs/", "rw"),
            "src-key": ("src-scope", "/src/", "rw"),
        },
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        root_remote = f"{base_url}/git/ap/root-key.git"
        docs_remote = f"{base_url}/git/ap/docs-key.git"
        src_remote = f"{base_url}/git/ap/src-key.git"
        docs = tmp_path / "docs"
        src = tmp_path / "src"
        root = tmp_path / "root"

        _run_git(["clone", docs_remote, str(docs)], tmp_path)
        _configure_git_identity(docs)
        (docs / "README.md").write_text("docs graft\n", encoding="utf-8")
        _run_git(["add", "README.md"], docs)
        _run_git(["commit", "-m", "docs graft"], docs)
        _run_git(["push", "origin", "main"], docs)

        _run_git(["clone", src_remote, str(src)], tmp_path)
        _configure_git_identity(src)
        (src / "app.py").write_text("print('graft')\n", encoding="utf-8")
        _run_git(["add", "app.py"], src)
        _run_git(["commit", "-m", "src graft"], src)
        _run_git(["push", "origin", "main"], src)

        _run_git(["clone", root_remote, str(root)], tmp_path)

    assert (root / "docs" / "README.md").read_text(encoding="utf-8") == "docs graft\n"
    assert (root / "src" / "app.py").read_text(encoding="utf-8") == "print('graft')\n"


def test_real_git_cli_concurrent_same_scope_force_pushes_are_merged(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"test-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/test-key.git"
        worktrees = []
        for index in range(4):
            work = tmp_path / f"client-{index}"
            _run_git(["clone", remote, str(work)], tmp_path)
            _configure_git_identity(work)
            (work / f"file-{index}.txt").write_text(f"client {index}\n", encoding="utf-8")
            _run_git(["add", f"file-{index}.txt"], work)
            _run_git(["commit", "-m", f"client {index}"], work)
            worktrees.append(work)

        with ThreadPoolExecutor(max_workers=4) as pool:
            pushes = list(
                pool.map(
                    lambda work: _run_git_raw(["push", "--force", "origin", "main"], work),
                    worktrees,
                ),
            )

        verify = tmp_path / "verify"
        _run_git(["clone", remote, str(verify)], tmp_path)

    assert all(push.returncode == 0 for push in pushes)
    assert _files_for_scope(server_repo, "docs") == {
        f"file-{index}.txt": f"client {index}\n".encode()
        for index in range(4)
    }
    for index in range(4):
        assert (verify / f"file-{index}.txt").read_text(encoding="utf-8") == f"client {index}\n"


def test_real_git_cli_client_merge_commit_is_rejected(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"test-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/test-key.git"
        work = tmp_path / "merge-client"

        _run_git(["clone", remote, str(work)], tmp_path)
        _configure_git_identity(work)
        (work / "base.txt").write_text("base\n", encoding="utf-8")
        _run_git(["add", "base.txt"], work)
        _run_git(["commit", "-m", "base"], work)
        base_commit = _run_git(["rev-parse", "HEAD"], work).decode("ascii").strip()
        _run_git(["push", "origin", "main"], work)

        _run_git(["checkout", "-b", "feature"], work)
        (work / "feature.txt").write_text("feature\n", encoding="utf-8")
        _run_git(["add", "feature.txt"], work)
        _run_git(["commit", "-m", "feature"], work)

        _run_git(["checkout", "main"], work)
        (work / "main.txt").write_text("main\n", encoding="utf-8")
        _run_git(["add", "main.txt"], work)
        _run_git(["commit", "-m", "main side"], work)
        _run_git(["merge", "--no-ff", "feature", "-m", "client local merge"], work)

        proc = _run_git_raw(["push", "origin", "main"], work)

    assert proc.returncode != 0
    assert b"client merge commits are not supported" in proc.stderr
    assert server_repo.get_scope_head_commit_id("docs") == base_commit
    assert _files_for_scope(server_repo, "docs") == {"base.txt": b"base\n"}


def test_real_git_cli_root_scope_cannot_write_child_scope_path(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("root-scope", "/")
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"root-key": ("root-scope", "/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/root-key.git"
        work = tmp_path / "root-client"

        _run_git(["clone", remote, str(work)], tmp_path)
        _configure_git_identity(work)
        (work / "docs").mkdir()
        (work / "docs" / "owned-by-docs.md").write_text("bad cross-scope write\n", encoding="utf-8")
        _run_git(["add", "docs/owned-by-docs.md"], work)
        _run_git(["commit", "-m", "bad child write"], work)
        rejected_commit = _run_git(["rev-parse", "HEAD"], work).decode("ascii").strip()
        proc = _run_git_raw(["push", "origin", "main"], work)

    assert proc.returncode != 0
    assert b"submission touches paths outside its scope" in proc.stderr
    assert server_repo.get_scope_head_commit_id("") == ""
    assert server_repo.get_scope_head_commit_id("docs") == ""
    assert not server_repo.store.exists(rejected_commit)


def test_real_git_cli_scope_exclude_rejects_push_and_filters_clone(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/", exclude=["/docs/secret/"])
    _patch_git_access_points(
        monkeypatch,
        {"docs-key": ("docs-scope", "/docs/", "rw", ["/docs/secret/"])},
    )

    seeded_tree = build_tree_from_files(
        server_repo.store,
        {
            "README.md": b"visible\n",
            "secret/old.md": b"hidden\n",
        },
    )
    seeded_commit = _make_client_commit(server_repo, seeded_tree, message="legacy seeded docs")
    server_repo.history.set_scope_hash("docs", seeded_tree)
    server_repo.set_scope_head_commit_id("docs", seeded_commit)

    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/docs-key.git"
        work = tmp_path / "docs"

        _run_git(["clone", remote, str(work)], tmp_path)
        assert (work / "README.md").read_text(encoding="utf-8") == "visible\n"
        assert not (work / "secret").exists()
        hidden_fetch = _run_git_raw(["fetch", "origin", seeded_commit], work)

        _configure_git_identity(work)
        (work / "secret").mkdir()
        (work / "secret" / "new.md").write_text("blocked\n", encoding="utf-8")
        _run_git(["add", "secret/new.md"], work)
        _run_git(["commit", "-m", "try excluded path"], work)
        proc = _run_git_raw(["push", "origin", "main"], work)

    assert hidden_fetch.returncode != 0
    assert proc.returncode != 0
    assert b"submission touches paths outside its scope" in proc.stderr
    assert server_repo.get_scope_head_commit_id("docs") == seeded_commit
    assert _files_for_scope(server_repo, "docs") == {
        "README.md": b"visible\n",
        "secret/old.md": b"hidden\n",
    }


def test_real_git_cli_bound_identity_mismatch_is_rejected_before_clone(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    monkeypatch.setattr(
        "src.mut_engine.adapters.git.router.resolve_access_point",
        lambda access_key: _git_access_auth(user_identity="alice@example.com"),
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url.replace('http://', 'http://bob:pw@')}/git/ap/docs-key.git"
        work = tmp_path / "mismatch"
        proc = _run_git_raw(["clone", remote, str(work)], tmp_path)

    assert proc.returncode != 0
    assert b"401" in proc.stderr or b"Authentication failed" in proc.stderr
    assert server_repo.get_scope_head_commit_id("docs") == ""


def test_real_git_cli_stale_same_file_conflict_requires_manual_review(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"docs-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/docs-key.git"
        seed = tmp_path / "seed"
        alice = tmp_path / "alice"
        bob = tmp_path / "bob"
        verify = tmp_path / "verify"

        _run_git(["clone", remote, str(seed)], tmp_path)
        _configure_git_identity(seed)
        (seed / "shared.txt").write_text("base\n", encoding="utf-8")
        _run_git(["add", "shared.txt"], seed)
        _run_git(["commit", "-m", "base shared"], seed)
        _run_git(["push", "origin", "main"], seed)

        _run_git(["clone", remote, str(alice)], tmp_path)
        _run_git(["clone", remote, str(bob)], tmp_path)
        _configure_git_identity(alice)
        _configure_git_identity(bob)

        (alice / "shared.txt").write_text("alice\n", encoding="utf-8")
        _run_git(["add", "shared.txt"], alice)
        _run_git(["commit", "-m", "alice changes shared"], alice)
        _run_git(["push", "origin", "main"], alice)

        (bob / "shared.txt").write_text("bob\n", encoding="utf-8")
        _run_git(["add", "shared.txt"], bob)
        _run_git(["commit", "-m", "bob changes shared"], bob)
        proc = _run_git_raw(["push", "--force", "origin", "main"], bob)

        _run_git(["clone", remote, str(verify)], tmp_path)

    assert proc.returncode != 0
    assert b"conflict requires manual review" in proc.stderr
    assert (verify / "shared.txt").read_text(encoding="utf-8") == "alice\n"
    assert server_repo.audit.events[-1]["type"] == "git_push_conflict_pending"
    assert server_repo.audit.events[-1]["detail"]["status"] == "pending_manual_review"


def test_real_git_cli_peer_fetch_and_pull_after_push(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"docs-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/docs-key.git"
        alice = tmp_path / "alice"
        bob = tmp_path / "bob"

        _run_git(["clone", remote, str(alice)], tmp_path)
        _run_git(["clone", remote, str(bob)], tmp_path)
        _configure_git_identity(alice)
        _configure_git_identity(bob)

        (alice / "notes.md").write_text("from alice\n", encoding="utf-8")
        _run_git(["add", "notes.md"], alice)
        _run_git(["commit", "-m", "alice notes"], alice)
        alice_head = _run_git(["rev-parse", "HEAD"], alice).decode("ascii").strip()
        _run_git(["push", "origin", "main"], alice)

        _run_git(["fetch", "origin", "main"], bob)
        fetched = _run_git(["rev-parse", "origin/main"], bob).decode("ascii").strip()
        _run_git(["pull", "--ff-only", "origin", "main"], bob)

    assert fetched == alice_head
    assert (bob / "notes.md").read_text(encoding="utf-8") == "from alice\n"


def test_real_git_cli_rapid_sequential_pushes_keep_log_chain(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"docs-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/docs-key.git"
        work = tmp_path / "rapid"
        verify = tmp_path / "verify"

        _run_git(["clone", remote, str(work)], tmp_path)
        _configure_git_identity(work)
        expected = []
        for index in range(8):
            (work / f"r{index}.txt").write_text(f"value {index}\n", encoding="utf-8")
            _run_git(["add", f"r{index}.txt"], work)
            _run_git(["commit", "-m", f"rapid {index}"], work)
            expected.append(_run_git(["rev-parse", "HEAD"], work).decode("ascii").strip())
            _run_git(["push", "origin", "main"], work)

        _run_git(["clone", remote, str(verify)], tmp_path)
        log = _run_git(["log", "--format=%H:%s"], verify).decode("utf-8")

    assert server_repo.get_scope_head_commit_id("docs") == expected[-1]
    for index, commit_id in enumerate(expected):
        assert f"{commit_id}:rapid {index}" in log
        assert (verify / f"r{index}.txt").read_text(encoding="utf-8") == f"value {index}\n"


def test_git_receive_pack_rejects_non_main_delete_multiple_and_malformed_requests(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"docs-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager
    body, client_commit_id = _make_git_receive_pack_body(tmp_path)
    non_main = body.replace(b"refs/heads/main", b"refs/heads/side")
    delete_main = _receive_command_body(client_commit_id, "0" * 40, "refs/heads/main")
    first = (
        f"{'0' * 40} {client_commit_id} refs/heads/main"
        "\0 report-status side-band-64k object-format=sha1\n"
    ).encode("ascii")
    second = f"{'0' * 40} {client_commit_id} refs/heads/other\n".encode("ascii")
    multiple = _pkt_line(first) + _pkt_line(second) + b"0000"

    with TestClient(app) as client:
        non_main_resp = client.post(
            "/git/ap/docs-key.git/git-receive-pack",
            content=non_main,
            headers={"content-type": "application/x-git-receive-pack-request"},
        )
        delete_resp = client.post(
            "/git/ap/docs-key.git/git-receive-pack",
            content=delete_main,
            headers={"content-type": "application/x-git-receive-pack-request"},
        )
        multiple_resp = client.post(
            "/git/ap/docs-key.git/git-receive-pack",
            content=multiple,
            headers={"content-type": "application/x-git-receive-pack-request"},
        )
        malformed_resp = client.post(
            "/git/ap/docs-key.git/git-receive-pack",
            content=b"0003",
            headers={"content-type": "application/x-git-receive-pack-request"},
        )

    assert b"only refs/heads/main is writable" in non_main_resp.content
    assert b"delete is not supported" in delete_resp.content
    assert multiple_resp.status_code == 400
    assert "one scope-bound ref update" in multiple_resp.json()["detail"]
    assert malformed_resp.status_code == 400
    assert server_repo.get_scope_head_commit_id("docs") == ""


def test_git_receive_pack_malformed_pack_does_not_advance_scope(
    monkeypatch, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"docs-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager
    fake_commit = "1" * 40
    body = _receive_command_body("0" * 40, fake_commit, "refs/heads/main", b"not a pack")

    with TestClient(app) as client:
        response = client.post(
            "/git/ap/docs-key.git/git-receive-pack",
            content=body,
            headers={"content-type": "application/x-git-receive-pack-request"},
        )

    assert response.status_code == 200
    assert b"ng refs/heads/main" in response.content
    assert server_repo.get_scope_head_commit_id("docs") == ""
    assert server_repo.audit.events == []


@pytest.mark.asyncio
async def test_real_git_cli_rollback_of_git_commits_is_visible_to_git_clone(
    monkeypatch, tmp_path, repo_manager, server_repo,
):
    server_repo.add_scope("docs-scope", "/docs/")
    _patch_git_access_points(
        monkeypatch,
        {"docs-key": ("docs-scope", "/docs/", "rw")},
    )
    app = FastAPI()
    app.include_router(git_router)
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager

    with _serve_git_app(app) as base_url:
        remote = f"{base_url}/git/ap/docs-key.git"
        work = tmp_path / "work"
        verify = tmp_path / "verify"

        _run_git(["clone", remote, str(work)], tmp_path)
        _configure_git_identity(work)
        (work / "doc.md").write_text("v1\n", encoding="utf-8")
        _run_git(["add", "doc.md"], work)
        _run_git(["commit", "-m", "v1"], work)
        v1 = _run_git(["rev-parse", "HEAD"], work).decode("ascii").strip()
        _run_git(["push", "origin", "main"], work)

        (work / "doc.md").write_text("v2\n", encoding="utf-8")
        _run_git(["add", "doc.md"], work)
        _run_git(["commit", "-m", "v2"], work)
        v2 = _run_git(["rev-parse", "HEAD"], work).decode("ascii").strip()
        _run_git(["push", "origin", "main"], work)

        rollback = await submit_mut_rollback(
            repo_manager,
            "test-proj",
            {
                "agent": "rollback-agent",
                "_scope": {"id": "docs-scope", "path": "/docs/", "exclude": [], "mode": "rw"},
            },
            {"protocol_version": PROTOCOL_VERSION, "target_commit_id": v1},
        )

        _run_git(["clone", remote, str(verify)], tmp_path)
        log = _run_git(["log", "--format=%s"], verify).decode("utf-8")

    assert rollback["status"] == "rolled-back"
    assert rollback["new_commit_id"] != v1
    assert rollback["new_commit_id"] != v2
    assert (verify / "doc.md").read_text(encoding="utf-8") == "v1\n"
    assert "rollback" in log
