"""mcp_service.rpc.client 新增 POSIX 接口测试。"""

from __future__ import annotations

from unittest.mock import AsyncMock

import httpx
import pytest

from mcp_service.rpc.client import InternalApiClient


@pytest.fixture
async def rpc_client():
    client = InternalApiClient(base_url="http://main-service", secret="internal-secret")
    yield client
    await client.close()


def _response(method: str, url: str, status_code: int, *, json_body=None, text: str | None = None):
    request = httpx.Request(method, url)
    if json_body is not None:
        return httpx.Response(status_code, json=json_body, request=request)
    return httpx.Response(status_code, content=(text or "").encode("utf-8"), request=request)


@pytest.mark.asyncio
async def test_resolve_path_success(rpc_client: InternalApiClient):
    url = "http://main-service/internal/nodes/resolve-path"
    rpc_client._client.post = AsyncMock(
        return_value=_response("POST", url, 200, json_body={"node_id": "n1", "path": "/docs"})
    )

    result = await rpc_client.resolve_path(
        project_id="proj-1",
        root_accesses=[{"node_id": "root", "node_name": "docs", "node_type": "folder"}],
        path="/docs",
    )

    assert result == {"node_id": "n1", "path": "/docs"}
    rpc_client._client.post.assert_awaited_once_with(
        url,
        json={
            "project_id": "proj-1",
            "root_accesses": [{"node_id": "root", "node_name": "docs", "node_type": "folder"}],
            "path": "/docs",
        },
    )


@pytest.mark.asyncio
async def test_resolve_path_http_error_is_wrapped(rpc_client: InternalApiClient):
    url = "http://main-service/internal/nodes/resolve-path"
    rpc_client._client.post = AsyncMock(
        return_value=_response("POST", url, 404, text='{"detail":"not found"}')
    )

    with pytest.raises(RuntimeError, match="路径解析失败: HTTP 404"):
        await rpc_client.resolve_path(project_id="proj-1", root_accesses=[], path="/missing")


@pytest.mark.asyncio
async def test_list_children_request_error_is_wrapped(rpc_client: InternalApiClient):
    url = "http://main-service/internal/nodes/root/children"
    rpc_client._client.get = AsyncMock(
        side_effect=httpx.RequestError("boom", request=httpx.Request("GET", url))
    )

    with pytest.raises(RuntimeError, match="列出子节点失败"):
        await rpc_client.list_children("root", "proj-1")


@pytest.mark.asyncio
async def test_read_write_and_create_node_success(rpc_client: InternalApiClient):
    read_url = "http://main-service/internal/nodes/node-1/content"
    write_url = "http://main-service/internal/nodes/node-1/content"
    create_url = "http://main-service/internal/nodes/create"

    rpc_client._client.get = AsyncMock(
        return_value=_response("GET", read_url, 200, json_body={"node_id": "node-1", "content": {"k": 1}})
    )
    rpc_client._client.put = AsyncMock(
        return_value=_response("PUT", write_url, 200, json_body={"node_id": "node-1", "updated": True})
    )
    rpc_client._client.post = AsyncMock(
        return_value=_response("POST", create_url, 200, json_body={"node_id": "node-2", "created": True})
    )

    read_result = await rpc_client.read_node_content("node-1", "proj-1")
    write_result = await rpc_client.write_node_content("node-1", "proj-1", {"k": 2})
    create_result = await rpc_client.create_node(
        project_id="proj-1",
        parent_id="root",
        name="new.json",
        node_type="json",
        content={"a": 1},
    )

    assert read_result["content"] == {"k": 1}
    assert write_result["updated"] is True
    assert create_result["created"] is True


@pytest.mark.asyncio
async def test_trash_node_http_error_is_wrapped(rpc_client: InternalApiClient):
    url = "http://main-service/internal/nodes/node-1/trash"
    rpc_client._client.post = AsyncMock(
        return_value=_response("POST", url, 500, text='{"detail":"boom"}')
    )

    with pytest.raises(RuntimeError, match="删除节点失败: HTTP 500"):
        await rpc_client.trash_node("node-1", "proj-1", "agent-1")

