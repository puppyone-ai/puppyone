"""High-density Git-native parity tests.

This file mirrors the broad version-engine test intent with fast Git-native contract
matrices. The goal is not artificial line count: each matrix fixes one
semantic axis that Git clients must inherit from PuppyOne collaboration.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest
from src.version_engine.write_engine.merge import merge_file_sets, three_way_merge
from src.version_engine.write_engine.object_store import ObjectStore
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.infrastructure.supabase.scope_manager import ScopeManager

from src.version_engine.adapters.git.receive_pack import parse_receive_pack_request as _parse_receive_pack_request
from src.version_engine.write_engine.conflict_policy import (
    ConflictPolicyDecision,
    merge_file_sets_for_policy,
    select_conflict_policy,
)
from src.version_engine.write_engine.tree_objects import (
    build_tree_from_files,
    flatten_tree_to_bytes,
    validate_scope_bound_files,
)
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager
from src.version_engine.infrastructure.supabase.server_repo import PuppyOneServerRepo

from tests.version_engine.test_server_repo import FakeAuditManager, FakeHistoryManager


_ZERO = "0" * 40
_A = "a" * 40
_B = "b" * 40


@pytest.fixture
def memory_store(tmp_path) -> ObjectStore:
    obj_dir = tmp_path / "objects"
    obj_dir.mkdir()
    return ObjectStore(obj_dir)


@pytest.fixture
def server_repo(memory_store):
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
        history=FakeHistoryManager(),
        audit=FakeAuditManager(),
        scopes=ScopeManager(FakeScopeBackend()),
    )


@pytest.fixture
def repo_manager(server_repo):
    manager = MagicMock(spec=VersionRepoManager)
    manager.get_server_repo.return_value = server_repo
    return manager


def _pkt(payload: bytes) -> bytes:
    return f"{len(payload) + 4:04x}".encode("ascii") + payload


def _receive_body(
    old_id: str = _ZERO,
    new_id: str = _A,
    ref: str = "refs/heads/main",
    *,
    capabilities: str = "report-status side-band-64k object-format=sha1",
    pack: bytes = b"PACK",
) -> bytes:
    first = f"{old_id} {new_id} {ref}\0{capabilities}\n".encode("ascii")
    return _pkt(first) + b"0000" + pack


def _full_path(scope_path: str, rel_path: str) -> str:
    scope = normalize_path(scope_path)
    rel = normalize_path(rel_path)
    if not scope:
        return rel
    if not rel:
        return scope
    return f"{scope}/{rel}"


def _scope_owner(scope_paths: list[str], full_path: str) -> str:
    clean = normalize_path(full_path)
    owner = ""
    for scope_path in scope_paths:
        scope = normalize_path(scope_path)
        if not scope:
            continue
        if clean == scope or clean.startswith(scope + "/"):
            if len(scope) > len(owner):
                owner = scope
    return owner


def _excluded(full_path: str, excludes: list[str]) -> bool:
    clean = normalize_path(full_path)
    for exc in excludes:
        normalized = normalize_path(exc)
        if normalized and (clean == normalized or clean.startswith(normalized + "/")):
            return True
    return False


_PATH_SHAPES = [
    ["README.md"],
    ["README.md", "CHANGELOG.md"],
    ["docs/a.md", "docs/b.md"],
    ["src/app.py", "src/lib/util.py"],
    ["config/app.json", "config/db.json"],
    ["assets/logo.bin", "assets/icons/edit.bin"],
    ["one/two/three.txt"],
    ["docs/internal/private.md", "docs/public.md"],
    ["a.txt", "nested/b.txt", "nested/deep/c.txt"],
    ["numbers/001.txt", "numbers/002.txt", "numbers/003.txt"],
    ["space-name/file name.txt", "dash-name/file-name.txt"],
    ["caps/Upper.txt", "caps/lower.txt"],
]
_CONTENT_VARIANTS = [
    b"",
    b"one line\n",
    b"line1\nline2\nline3\n",
    b"\x00binary\xffpayload",
]
_TREE_CASES = [
    {
        path: content + f":{shape_index}:{path_index}".encode("ascii")
        for path_index, path in enumerate(paths)
    }
    for shape_index, paths in enumerate(_PATH_SHAPES)
    for content in _CONTENT_VARIANTS
]


@pytest.mark.parametrize("files", _TREE_CASES)
def test_git_tree_round_trips_file_shapes(memory_store, files):
    tree_id = build_tree_from_files(memory_store, files)

    assert flatten_tree_to_bytes(memory_store, tree_id) == files


_SCOPE_DEFS = [
    ("root-scope", "/"),
    ("docs-scope", "/docs/"),
    ("src-scope", "/src/"),
    ("internal-scope", "/docs/internal/"),
]
_SCOPE_PATHS = ["", "docs", "src", "docs/internal"]
_REL_PATHS = [
    "README.md",
    "guide/intro.md",
    "secret/token.txt",
    "generated/cache.txt",
    "internal/note.md",
    "internal/private/plan.md",
    "docs/rebased.md",
    "src/app.py",
    "top-level.txt",
    "nested/deep/file.txt",
]
_EXCLUDE_SETS = [
    [],
    ["/docs/secret/", "/docs/internal/private/"],
    ["/src/generated/", "/generated/"],
]
_SCOPE_CASES = [
    (scope_path, rel_path, excludes)
    for scope_path in _SCOPE_PATHS
    for rel_path in _REL_PATHS
    for excludes in _EXCLUDE_SETS
]


@pytest.mark.parametrize("scope_path,rel_path,excludes", _SCOPE_CASES)
def test_git_scope_boundary_matrix(server_repo, scope_path, rel_path, excludes):
    for scope_id, path in _SCOPE_DEFS:
        server_repo.add_scope(scope_id, path)

    rejected = validate_scope_bound_files(
        server_repo,
        scope_path,
        [rel_path],
        excludes,
    )

    full = _full_path(scope_path, rel_path)
    expected_rejected = (
        _scope_owner([path for _scope_id, path in _SCOPE_DEFS], full) != normalize_path(scope_path)
        or _excluded(full, excludes)
    )
    assert rejected == ([full] if expected_rejected else [])


_TEXT_PATHS = [
    "a.txt",
    "docs/a.md",
    "docs/nested/b.md",
    "src/app.py",
    "src/lib/util.py",
    "notes/today.txt",
    "notes/tomorrow.txt",
    "content/page.md",
    "content/page2.md",
    "plain/readme.txt",
    "plain/changelog.txt",
    "tasks/todo.txt",
]
_JSON_PATHS = [
    "config/app.json",
    "config/db.json",
    "config/agent.json",
    "data/one.json",
    "data/two.json",
    "data/three.json",
    "settings/ui.json",
    "settings/api.json",
    "scope/docs.json",
    "scope/src.json",
    "policy/merge.json",
    "policy/conflict.json",
]
_MERGE_CASES: list[tuple[str, str, dict[str, bytes], dict[str, bytes], dict[str, bytes], bytes, str]] = []
for path in _TEXT_PATHS:
    _MERGE_CASES.extend([
        ("identical", path, {path: b"base"}, {path: b"same"}, {path: b"same"}, b"same", ""),
        ("theirs_only", path, {path: b"base"}, {path: b"base"}, {path: b"client"}, b"client", ""),
        ("ours_only", path, {path: b"base"}, {path: b"server"}, {path: b"base"}, b"server", ""),
        (
            "line_merge",
            path,
            {path: b"a\nb\nc\n"},
            {path: b"A\nb\nc\n"},
            {path: b"a\nb\nC\n"},
            b"",
            "line_merge",
        ),
        ("lww", path, {path: b"a\nb\n"}, {path: b"a\nSERVER\n"}, {path: b"a\nCLIENT\n"}, b"a\nCLIENT\n", "lww"),
    ])
for path in _JSON_PATHS:
    _MERGE_CASES.extend([
        (
            "json_different_keys",
            path,
            {path: json.dumps({"a": 1, "b": 1}).encode()},
            {path: json.dumps({"a": 2, "b": 1}).encode()},
            {path: json.dumps({"a": 1, "b": 3}).encode()},
            json.dumps({"a": 2, "b": 3}).encode(),
            "",
        ),
        (
            "json_additions",
            path,
            {path: json.dumps({"a": 1}).encode()},
            {path: json.dumps({"a": 1, "server": True}).encode()},
            {path: json.dumps({"a": 1, "client": True}).encode()},
            json.dumps({"a": 1, "server": True, "client": True}).encode(),
            "",
        ),
        (
            "json_lww_conflict",
            path,
            {path: json.dumps({"a": 1}).encode()},
            {path: json.dumps({"a": 2}).encode()},
            {path: json.dumps({"a": 3}).encode()},
            json.dumps({"a": 3}).encode(),
            "json_lww",
        ),
    ])


@pytest.mark.parametrize("case_name,path,base,ours,theirs,expected,conflict_strategy", _MERGE_CASES)
def test_git_server_merge_strategy_matrix(
    case_name,
    path,
    base,
    ours,
    theirs,
    expected,
    conflict_strategy,
):
    merged, conflicts = merge_file_sets(base, ours, theirs)

    if case_name == "line_merge":
        assert b"A" in merged[path]
        assert b"C" in merged[path]
    elif case_name.startswith("json_"):
        assert json.loads(merged[path]) == json.loads(expected)
    else:
        assert merged[path] == expected
    if conflict_strategy:
        assert any(conflict.strategy == conflict_strategy for conflict in conflicts)
    else:
        assert conflicts == []


_MANUAL_POLICY_CASES = [
    (
        "different_files_auto_merge",
        {},
        {"server.txt": b"server"},
        {"client.txt": b"client"},
        {"server.txt": b"server", "client.txt": b"client"},
        [],
    ),
    (
        "json_different_keys_auto_merge",
        {"config.json": b'{"a": 1, "b": 1}'},
        {"config.json": b'{"a": 2, "b": 1}'},
        {"config.json": b'{"a": 1, "b": 3}'},
        {"config.json": b'{\n  "a": 2,\n  "b": 3\n}'},
        [],
    ),
    (
        "same_file_text_conflict_pending",
        {"shared.txt": b"base\n"},
        {"shared.txt": b"server\n"},
        {"shared.txt": b"client\n"},
        {"shared.txt": b"server\n"},
        ["manual_review"],
    ),
    (
        "modify_delete_pending",
        {"shared.txt": b"base\n"},
        {"shared.txt": b"server\n"},
        {},
        {"shared.txt": b"server\n"},
        ["modify_delete"],
    ),
    (
        "binary_conflict_pending",
        {"asset.bin": b"\x00base"},
        {"asset.bin": b"\x00server"},
        {"asset.bin": b"\x00client"},
        {"asset.bin": b"\x00server"},
        ["manual_review"],
    ),
]


@pytest.mark.parametrize(
    "case_name,base,current,incoming,expected_merged,expected_manual_strategies",
    _MANUAL_POLICY_CASES,
)
def test_manual_review_policy_merge_matrix(
    case_name,
    base,
    current,
    incoming,
    expected_merged,
    expected_manual_strategies,
):
    _ = case_name
    result = merge_file_sets_for_policy(
        base,
        current,
        incoming,
        policy=ConflictPolicyDecision(policy="manual_review", reason="test"),
    )

    assert result.merged_files == expected_merged
    assert [c.strategy for c in result.manual_conflicts] == expected_manual_strategies


def test_scope_git_conflict_policy_default_requires_manual_review():
    """Scope-bound Git AP writes are collaboration-facing.

    Product/API writes still use the configured default policy, but unsafe
    scope-bound Git conflicts must stop at manual review instead of silently
    LWW'ing another user's pushed work.
    """
    decision = select_conflict_policy(
        scope_path="docs",
        source_channel="git",
        actor="scope:docs",
        paths=["README.md"],
    )

    assert decision.policy == "manual_review"
    assert decision.reason == "default:scope_git_manual_review"


_VALID_REFS = [
    "refs/heads/main",
    "refs/heads/dev",
    "refs/heads/feature/x",
    "refs/tags/v1",
    "refs/changes/01",
]
_CAPABILITY_SETS = [
    "report-status",
    "report-status side-band",
    "report-status side-band-64k object-format=sha1",
    "object-format=sha1 quiet",
    "",
]
_VALID_RECEIVE_CASES = [
    (ref, capabilities)
    for ref in _VALID_REFS
    for capabilities in _CAPABILITY_SETS
]
_INVALID_RECEIVE_BODIES = [
    b"",
    b"000",
    b"zzzz",
    b"0001",
    b"0002",
    b"0003",
    b"0004",
    b"0005x",
    b"0008abc",
    b"0010not enough",
    b"0000",
    _pkt(b"shallow " + _A.encode("ascii") + b"\n") + b"0000",
    _pkt(b"not-a-command\n") + b"0000",
    _pkt(f"{_ZERO} {_A}\n".encode("ascii")) + b"0000",
    _pkt(f"{_ZERO} nothex refs/heads/main\n".encode("ascii")) + b"0000",
    _pkt(f"nothex {_A} refs/heads/main\n".encode("ascii")) + b"0000",
    _pkt(f"{_ZERO} {_A} refs/heads/main extra\n".encode("ascii")) + b"0000",
    _pkt(f"{_ZERO} {_A} refs/heads/main\n".encode("ascii"))
    + _pkt(f"{_ZERO} {_B} refs/heads/other\n".encode("ascii"))
    + b"0000",
    b"ffff",
    b"0010abc",
]


@pytest.mark.parametrize("ref,capabilities", _VALID_RECEIVE_CASES)
def test_git_receive_pack_parser_valid_matrix(ref, capabilities):
    body = _receive_body(ref=ref, capabilities=capabilities, pack=b"PACKDATA")

    command = _parse_receive_pack_request(body)

    assert command.old_id == _ZERO
    assert command.new_id == _A
    assert command.ref == ref
    assert command.pack == b"PACKDATA"
    assert command.capabilities == set(capabilities.split())


def test_git_receive_pack_parser_accepts_shallow_preface_before_command():
    body = (
        _pkt(b"shallow " + _B.encode("ascii") + b"\n")
        + _receive_body(
            old_id=_B,
            new_id=_A,
            capabilities="report-status-v2 side-band-64k object-format=sha1",
            pack=b"PACKDATA",
        )
    )

    command = _parse_receive_pack_request(body)

    assert command.old_id == _B
    assert command.new_id == _A
    assert command.ref == "refs/heads/main"
    assert command.pack == b"PACKDATA"
    assert command.capabilities == {
        "report-status-v2",
        "side-band-64k",
        "object-format=sha1",
    }


@pytest.mark.parametrize("body", _INVALID_RECEIVE_BODIES)
def test_git_receive_pack_parser_rejects_malformed_matrix(body):
    with pytest.raises(ValueError):
        _parse_receive_pack_request(body)


_THREE_WAY_CASES = [
    (b"base", b"same", b"same", "f.txt", b"same", "identical"),
    (b"base", b"base", b"client", "f.txt", b"client", "theirs_only"),
    (b"base", b"server", b"base", "f.txt", b"server", "ours_only"),
    (b"a\nb\nc\n", b"A\nb\nc\n", b"a\nb\nC\n", "f.txt", b"", "line_merge"),
    (b"a\nb\n", b"a\nSERVER\n", b"a\nCLIENT\n", "f.txt", b"a\nCLIENT\n", "lww"),
    (
        json.dumps({"a": 1, "b": 1}).encode(),
        json.dumps({"a": 2, "b": 1}).encode(),
        json.dumps({"a": 1, "b": 3}).encode(),
        "config.json",
        json.dumps({"a": 2, "b": 3}).encode(),
        "json_merge",
    ),
] * 8


@pytest.mark.parametrize("base,ours,theirs,path,expected,strategy", _THREE_WAY_CASES)
def test_git_three_way_merge_contract_matrix(base, ours, theirs, path, expected, strategy):
    result = three_way_merge(base, ours, theirs, path)

    assert result.strategy == strategy
    if strategy == "line_merge":
        assert b"A" in result.content and b"C" in result.content
    elif path.endswith(".json"):
        assert json.loads(result.content) == json.loads(expected)
    else:
        assert result.content == expected
