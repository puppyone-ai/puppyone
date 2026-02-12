"""mcp_service.tool.fs_tool POSIX 行为测试。"""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest

from mcp_service.tool.fs_tool import FsToolImplementation


@pytest.mark.asyncio
async def test_ls_virtual_root_returns_access_entries():
    rpc = Mock()
    rpc.resolve_path = AsyncMock(return_value={"virtual_root": True, "path": "/"})
    rpc.list_children = AsyncMock()
    fs = FsToolImplementation(rpc)

    accesses = [
        {"node_id": "n1", "node_name": "docs", "node_type": "folder", "bash_readonly": False},
        {"node_id": "n2", "node_name": "users.json", "node_type": "json", "bash_readonly": True},
    ]

    result = await fs.ls("proj-1", accesses, "/")

    assert result["path"] == "/"
    assert result["entries"] == [
        {"name": "docs/", "path": "/docs", "type": "folder"},
        {"name": "users.json", "path": "/users.json", "type": "json"},
    ]
    rpc.list_children.assert_not_called()


@pytest.mark.asyncio
async def test_ls_folder_formats_children_entries():
    rpc = Mock()
    rpc.resolve_path = AsyncMock(
        return_value={"node_id": "folder-1", "type": "folder", "path": "/docs"}
    )
    rpc.list_children = AsyncMock(
        return_value={
            "children": [
                {
                    "node_id": "a",
                    "name": "drafts",
                    "type": "folder",
                    "updated_at": "2026-02-11T10:00:00+00:00",
                },
                {
                    "node_id": "b",
                    "name": "readme.md",
                    "type": "markdown",
                    "size_bytes": 11,
                },
            ]
        }
    )
    fs = FsToolImplementation(rpc)

    result = await fs.ls("proj-1", [{"node_id": "root", "node_name": "docs", "node_type": "folder"}], "/docs")

    assert result == {
        "path": "/docs",
        "entries": [
            {
                "name": "drafts/",
                "path": "/docs/drafts",
                "type": "folder",
                "updated_at": "2026-02-11T10:00:00+00:00",
            },
            {
                "name": "readme.md",
                "path": "/docs/readme.md",
                "type": "markdown",
                "size_bytes": 11,
            },
        ],
    }


@pytest.mark.asyncio
async def test_ls_non_directory_returns_error():
    rpc = Mock()
    rpc.resolve_path = AsyncMock(
        return_value={"node_id": "json-1", "type": "json", "path": "/users.json"}
    )
    fs = FsToolImplementation(rpc)

    result = await fs.ls("proj-1", [{"node_id": "json-1", "node_name": "users.json", "node_type": "json"}], "/users.json")

    assert result == {"error": "Not a directory: /users.json"}


@pytest.mark.asyncio
async def test_cat_file_reads_content_and_appends_display_path():
    rpc = Mock()
    rpc.resolve_path = AsyncMock(
        return_value={"node_id": "md-1", "type": "markdown", "path": "/docs/readme.md"}
    )
    rpc.read_node_content = AsyncMock(return_value={"node_id": "md-1", "content": "hello"})
    fs = FsToolImplementation(rpc)

    result = await fs.cat("proj-1", [{"node_id": "root", "node_name": "docs", "node_type": "folder"}], "/docs/readme.md")

    assert result == {"node_id": "md-1", "content": "hello", "path": "/docs/readme.md"}


@pytest.mark.asyncio
async def test_cat_folder_behaves_like_ls():
    rpc = Mock()
    rpc.resolve_path = AsyncMock(
        return_value={"node_id": "folder-1", "type": "folder", "path": "/docs"}
    )
    rpc.list_children = AsyncMock(return_value={"children": []})
    fs = FsToolImplementation(rpc)

    result = await fs.cat("proj-1", [{"node_id": "root", "node_name": "docs", "node_type": "folder"}], "/docs")

    assert result == {"path": "/docs", "entries": []}


@pytest.mark.asyncio
async def test_write_existing_file_updates_content():
    rpc = Mock()
    rpc.resolve_path = AsyncMock(
        return_value={"node_id": "md-1", "type": "markdown", "path": "/docs/readme.md"}
    )
    rpc.write_node_content = AsyncMock(return_value={"updated": True, "node_id": "md-1"})
    rpc.create_node = AsyncMock()
    fs = FsToolImplementation(rpc)

    result = await fs.write(
        "proj-1",
        [{"node_id": "root", "node_name": "docs", "node_type": "folder", "bash_readonly": False}],
        "/docs/readme.md",
        "new-content",
    )

    assert result == {"updated": True, "node_id": "md-1", "path": "/docs/readme.md"}
    rpc.write_node_content.assert_awaited_once_with("md-1", "proj-1", "new-content")
    rpc.create_node.assert_not_called()


@pytest.mark.asyncio
async def test_write_new_file_under_single_root_creates_markdown_node():
    rpc = Mock()
    rpc.resolve_path = AsyncMock(side_effect=[RuntimeError("not found")])
    rpc.create_node = AsyncMock(
        return_value={"node_id": "new-1", "name": "readme.md", "type": "markdown", "created": True}
    )
    fs = FsToolImplementation(rpc)

    result = await fs.write(
        "proj-1",
        [{"node_id": "root-folder", "node_name": "docs", "node_type": "folder", "bash_readonly": False}],
        "/readme.md",
        "hello",
    )

    assert result["node_id"] == "new-1"
    assert result["path"] == "/readme.md"
    rpc.create_node.assert_awaited_once_with(
        project_id="proj-1",
        parent_id="root-folder",
        name="readme.md",
        node_type="markdown",
        content="hello",
    )


@pytest.mark.asyncio
async def test_write_new_file_at_virtual_root_is_rejected_in_multi_root_mode():
    rpc = Mock()
    rpc.resolve_path = AsyncMock(side_effect=[RuntimeError("not found")])
    rpc.create_node = AsyncMock()
    fs = FsToolImplementation(rpc)

    result = await fs.write(
        "proj-1",
        [
            {"node_id": "a", "node_name": "docs", "node_type": "folder", "bash_readonly": False},
            {"node_id": "b", "node_name": "wiki", "node_type": "folder", "bash_readonly": False},
        ],
        "/todo.md",
        "x",
    )

    assert result == {"error": "Cannot create files at virtual root in multi-root mode"}
    rpc.create_node.assert_not_called()


@pytest.mark.asyncio
async def test_mkdir_parent_not_found_returns_error():
    rpc = Mock()
    rpc.resolve_path = AsyncMock(side_effect=RuntimeError("No such file or directory: docs"))
    rpc.create_node = AsyncMock()
    fs = FsToolImplementation(rpc)

    result = await fs.mkdir(
        "proj-1",
        [{"node_id": "root", "node_name": "root", "node_type": "folder", "bash_readonly": False}],
        "/docs/sub",
    )

    assert result["error"].startswith("Parent directory not found:")
    rpc.create_node.assert_not_called()


@pytest.mark.asyncio
async def test_rm_handles_not_found_virtual_root_and_success():
    rpc = Mock()
    fs = FsToolImplementation(rpc)
    accesses = [{"node_id": "root", "node_name": "docs", "node_type": "folder", "bash_readonly": False}]

    rpc.resolve_path = AsyncMock(side_effect=RuntimeError("No such file or directory: x"))
    not_found = await fs.rm("proj-1", accesses, "/docs/x.md", user_id="agent-1")
    assert not_found["error"].startswith("No such file or directory:")

    rpc.resolve_path = AsyncMock(return_value={"virtual_root": True, "path": "/"})
    root_err = await fs.rm("proj-1", accesses, "/", user_id="agent-1")
    assert root_err == {"error": "Cannot remove the root directory"}

    rpc.resolve_path = AsyncMock(
        return_value={"node_id": "n1", "type": "markdown", "path": "/docs/x.md"}
    )
    rpc.trash_node = AsyncMock(return_value={"node_id": "n1", "removed": True})
    ok = await fs.rm("proj-1", accesses, "/docs/x.md", user_id="agent-1")
    assert ok == {"node_id": "n1", "removed": True, "path": "/docs/x.md"}
    rpc.trash_node.assert_awaited_once_with("n1", "proj-1", "agent-1")

