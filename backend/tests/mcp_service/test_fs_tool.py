"""mcp_service.tool.fs_tool POSIX path-based tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest

from mcp_service.tool.fs_tool import FsToolImplementation


def _rpc(**overrides):
    rpc = Mock()
    rpc.list_dir = AsyncMock(return_value=overrides.get("list_dir", {"children": [], "path": ""}))
    rpc.read_file = AsyncMock(return_value=overrides.get("read_file", {}))
    rpc.write_file = AsyncMock(return_value=overrides.get("write_file", {}))
    rpc.mkdir = AsyncMock(return_value=overrides.get("mkdir_result", {}))
    rpc.delete = AsyncMock(return_value=overrides.get("delete_result", {}))
    rpc.stat = AsyncMock(return_value=overrides.get("stat_result", {}))
    return rpc


@pytest.mark.asyncio
async def test_ls_root_no_scope():
    """ls at root with no scope restrictions should call list_dir."""
    rpc = _rpc(list_dir={
        "path": "",
        "entries": [
            {"name": "docs", "path": "docs", "type": "folder"},
            {"name": "users.json", "path": "users.json", "type": "json"},
        ],
    })
    fs = FsToolImplementation(rpc)

    result = await fs.ls("proj-1", [], "/")

    assert result["path"] == "/"
    assert len(result["entries"]) == 2
    rpc.list_dir.assert_awaited_once()


@pytest.mark.asyncio
async def test_ls_folder_returns_entries():
    """ls a folder should return children entries."""
    rpc = _rpc(list_dir={
        "path": "docs",
        "entries": [
            {"name": "drafts", "path": "docs/drafts", "type": "folder"},
            {"name": "readme.md", "path": "docs/readme.md", "type": "markdown", "size_bytes": 11},
        ],
    })
    fs = FsToolImplementation(rpc)

    result = await fs.ls("proj-1", [], "/docs")

    assert result["path"] == "/docs"
    assert len(result["entries"]) == 2
    assert result["entries"][0]["name"] == "drafts"


@pytest.mark.asyncio
async def test_ls_scope_denied():
    """ls outside scope should return access denied."""
    rpc = _rpc()
    fs = FsToolImplementation(rpc)

    accesses = [{"scope": {"path_prefix": "docs"}}]
    result = await fs.ls("proj-1", accesses, "/other")

    assert "error" in result
    assert "Access denied" in result["error"]


@pytest.mark.asyncio
async def test_cat_reads_file_content():
    """cat should call read_file and return content."""
    rpc = _rpc(read_file={"name": "readme.md", "type": "markdown", "content": "hello"})
    fs = FsToolImplementation(rpc)

    result = await fs.cat("proj-1", [], "/docs/readme.md")

    assert result["content"] == "hello"
    assert result["path"] == "/docs/readme.md"
    rpc.read_file.assert_awaited_once_with(
        "proj-1", "docs/readme.md", acting_user_id=None,
    )


@pytest.mark.asyncio
async def test_cat_root_behaves_like_ls():
    """cat at root should act like ls."""
    rpc = _rpc(list_dir={"path": "", "entries": []})
    fs = FsToolImplementation(rpc)

    result = await fs.cat("proj-1", [], "/")

    assert result["path"] == "/"
    rpc.list_dir.assert_awaited_once()


@pytest.mark.asyncio
async def test_write_calls_write_file():
    """write should call rpc.write_file."""
    rpc = _rpc(write_file={"path": "docs/readme.md", "version": 2, "updated": True})
    fs = FsToolImplementation(rpc)

    result = await fs.write("proj-1", [], "/docs/readme.md", "new-content")

    assert result["updated"] is True
    assert result["path"] == "/docs/readme.md"
    rpc.write_file.assert_awaited_once()


@pytest.mark.asyncio
async def test_write_readonly_denied():
    """write in read-only scope should be denied."""
    rpc = _rpc()
    fs = FsToolImplementation(rpc)

    accesses = [{"scope": {"path_prefix": "docs", "readonly": True}}]
    result = await fs.write("proj-1", accesses, "/docs/readme.md", "content")

    assert "error" in result
    assert "Read-only" in result["error"]


@pytest.mark.asyncio
async def test_mkdir_calls_rpc():
    """mkdir should call rpc.mkdir."""
    rpc = _rpc(mkdir_result={"path": "docs/sub", "created": True, "version": 1})
    fs = FsToolImplementation(rpc)

    result = await fs.mkdir("proj-1", [], "/docs/sub")

    assert result["created"] is True
    rpc.mkdir.assert_awaited_once_with("proj-1", "docs/sub", acting_user_id=None)


@pytest.mark.asyncio
async def test_mkdir_empty_path_error():
    """mkdir with empty path should return error."""
    rpc = _rpc()
    fs = FsToolImplementation(rpc)

    result = await fs.mkdir("proj-1", [], "/")

    assert result["error"] == "Path cannot be empty"


@pytest.mark.asyncio
async def test_rm_calls_delete():
    """rm should call rpc.delete."""
    rpc = _rpc(delete_result={"path": "docs/x.md", "removed": True})
    fs = FsToolImplementation(rpc)

    result = await fs.rm("proj-1", [], "/docs/x.md", user_id="agent-1")

    assert result["removed"] is True
    rpc.delete.assert_awaited_once_with("proj-1", "docs/x.md", acting_user_id=None)


@pytest.mark.asyncio
async def test_rm_root_denied():
    """rm at root should be denied."""
    rpc = _rpc()
    fs = FsToolImplementation(rpc)

    result = await fs.rm("proj-1", [], "/", user_id="agent-1")

    assert result == {"error": "Cannot remove the root directory"}
