"""ScopedFsService execution + access-control tests.

The 16 fs_* tools and (more importantly) the gating in `call()` — writable check,
per-endpoint tool whitelist, path exclusion — plus the conflict mapping were
untested. These guard what an EXTERNAL MCP client (ChatGPT/Claude Desktop) is
allowed to do inside a scope, so they're worth pinning. Uses fake ops/commands so
no live version-engine is needed.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.version_engine.scoped_fs.context import ScopedFsContext
from src.version_engine.scoped_fs.errors import ScopedFsError, ScopedFsPermissionDenied
from src.version_engine.scoped_fs.service import ScopedFsService
from src.version_engine.write_engine.errors import ConcurrentMutationError


class _FakeOps:
    """ProductOperationAdapter stand-in — enough for read happy-paths."""

    def list_dir_in_scope(self, *_a, **_k):
        return []

    def list_tree_in_scope(self, *_a, **_k):
        return []

    def stat_in_scope(self, *_a, **_k):
        return None

    def get_scope_head_commit_id(self, *_a, **_k):
        return "head-c1"


class _FakeCommands:
    """VersionWriteCommandService stand-in. `conflict=True` makes writes raise the
    concurrent-mutation error so we can assert the 409 mapping."""

    def __init__(self, conflict: bool = False):
        self.conflict = conflict
        self.writes: list[tuple] = []

    async def write_file(self, project_id, path, content, **kwargs):
        self.writes.append((project_id, path, content, kwargs))
        if self.conflict:
            raise ConcurrentMutationError(
                scope_path=kwargs.get("scope", ""),
                expected_head_commit_id="old",
                current_head_commit_id="new",
            )
        return SimpleNamespace(path=path, result=SimpleNamespace(commit_id="commit-2"))


def _ctx(*, mode="rw", exclude=None, allowed_tools=None) -> ScopedFsContext:
    return ScopedFsContext(
        api_key="mcp_test",
        endpoint_id="ep-1",
        endpoint_name="Test",
        project_id="proj-1",
        user_id="user-1",
        scope_id="scope-1",
        scope_path="docs",
        mode=mode,
        exclude=exclude or [],
        allowed_tools=allowed_tools,
    )


def _svc(conflict=False) -> ScopedFsService:
    return ScopedFsService(_FakeOps(), _FakeCommands(conflict=conflict))


# ── access-control gates (raised in call() before any I/O) ────────────

async def test_unknown_tool_rejected():
    with pytest.raises(ScopedFsError) as ei:
        await _svc().call(_ctx(), "fs_bogus", {})
    assert ei.value.code == "UNKNOWN_TOOL" and ei.value.status_code == 400


async def test_write_tool_denied_on_readonly_scope():
    with pytest.raises(ScopedFsPermissionDenied) as ei:
        await _svc().call(_ctx(mode="ro"), "fs_write", {"path": "a.md", "content": "x"})
    assert ei.value.status_code == 403 and "writable" in ei.value.message


async def test_tool_not_in_whitelist_denied():
    # endpoint allows only fs_ls → fs_cat is disabled for it
    with pytest.raises(ScopedFsPermissionDenied) as ei:
        await _svc().call(_ctx(allowed_tools=frozenset({"fs_ls"})), "fs_cat", {"path": "a.md"})
    assert "disabled" in ei.value.message


async def test_excluded_path_denied():
    ctx = _ctx(exclude=["secret.txt"], allowed_tools=frozenset({"fs_cat"}))
    with pytest.raises(ScopedFsPermissionDenied) as ei:
        await _svc().call(ctx, "fs_cat", {"path": "secret.txt"})
    assert ei.value.status_code == 403 and "excluded" in ei.value.message


# ── happy paths + conflict mapping ────────────────────────────────────

async def test_ls_empty_root_ok():
    out = await _svc().call(_ctx(allowed_tools=frozenset({"fs_ls"})), "fs_ls", {})
    assert out["entries"] == [] and out["scope"]["id"] == "scope-1"
    assert out["head_commit_id"] == "head-c1"


async def test_write_commits_and_returns_commit_id():
    svc = _svc()
    out = await svc.call(_ctx(allowed_tools=frozenset({"fs_write"})),
                         "fs_write", {"path": "a.md", "content": "hello"})
    assert out["commit_id"] == "commit-2" and out["path"] == "a.md"
    assert out["scope"]["mode"] == "rw"
    # the write was forwarded with the mcp source channel + actor
    _, _, _, kwargs = svc.commands.writes[0]
    assert kwargs["source_channel"] == "mcp" and kwargs["actor"] == "user-1"


async def test_write_conflict_maps_to_409():
    with pytest.raises(ScopedFsError) as ei:
        await _svc(conflict=True).call(_ctx(allowed_tools=frozenset({"fs_write"})),
                                       "fs_write", {"path": "a.md", "content": "x"})
    assert ei.value.code == "CONFLICT" and ei.value.status_code == 409
