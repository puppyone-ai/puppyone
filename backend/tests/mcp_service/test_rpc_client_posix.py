"""mcp_service.rpc.client path-based (Mut-Native) API tests."""

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
async def test_stat_success(rpc_client: InternalApiClient):
    url = "http://main-service/internal/nodes/resolve-path"
    rpc_client._client.post = AsyncMock(
        return_value=_response("POST", url, 200, json_body={"name": "readme.md", "path": "docs/readme.md", "type": "markdown"})
    )

    result = await rpc_client.stat(project_id="proj-1", path="/docs/readme.md")

    assert result["name"] == "readme.md"
    assert result["type"] == "markdown"


@pytest.mark.asyncio
async def test_stat_http_error_is_wrapped(rpc_client: InternalApiClient):
    url = "http://main-service/internal/nodes/resolve-path"
    rpc_client._client.post = AsyncMock(
        return_value=_response("POST", url, 404, text='{"detail":"not found"}')
    )

    with pytest.raises(RuntimeError, match="获取文件信息失败: HTTP 404"):
        await rpc_client.stat(project_id="proj-1", path="/missing")


@pytest.mark.asyncio
async def test_list_dir_request_error_is_wrapped(rpc_client: InternalApiClient):
    url = "http://main-service/internal/nodes/list"
    rpc_client._client.get = AsyncMock(
        side_effect=httpx.RequestError("boom", request=httpx.Request("GET", url))
    )

    with pytest.raises(RuntimeError, match="列出目录失败"):
        await rpc_client.list_dir("proj-1", "docs")


@pytest.mark.asyncio
async def test_read_write_and_mkdir_success(rpc_client: InternalApiClient):
    read_url = "http://main-service/internal/nodes/read"
    write_url = "http://main-service/internal/nodes/write"
    mkdir_url = "http://main-service/internal/nodes/create"

    rpc_client._client.get = AsyncMock(
        return_value=_response("GET", read_url, 200, json_body={"name": "users.json", "type": "json", "content": {"k": 1}})
    )
    rpc_client._client.put = AsyncMock(
        return_value=_response("PUT", write_url, 200, json_body={"path": "users.json", "version": 2, "updated": True})
    )
    rpc_client._client.post = AsyncMock(
        return_value=_response("POST", mkdir_url, 200, json_body={"path": "docs", "created": True, "version": 1})
    )

    read_result = await rpc_client.read_file("proj-1", "users.json")
    write_result = await rpc_client.write_file("proj-1", "users.json", {"k": 2})
    mkdir_result = await rpc_client.mkdir("proj-1", "docs")

    assert read_result["content"] == {"k": 1}
    assert write_result["updated"] is True
    assert mkdir_result["created"] is True


@pytest.mark.asyncio
async def test_delete_http_error_is_wrapped(rpc_client: InternalApiClient):
    url = "http://main-service/internal/nodes/rm"
    rpc_client._client.post = AsyncMock(
        return_value=_response("POST", url, 500, text='{"detail":"boom"}')
    )

    with pytest.raises(RuntimeError, match="删除失败: HTTP 500"):
        await rpc_client.delete("proj-1", "readme.md")
