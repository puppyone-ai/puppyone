"""
MCP V3 路由

基于 Agent 架构的 MCP API 端点：
1. /mcp/agents/{agent_id}/... - Agent 的 MCP 配置管理
2. /mcp/proxy/... - 代理到 MCP Server（推荐 Header: X-MCP-API-Key，兼容 legacy path key）
"""

from __future__ import annotations

import asyncio
from typing import List

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.requests import ClientDisconnect
import httpx

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.config import settings
from src.exceptions import NotFoundException, ErrorCode
from src.access.config.models import Agent

from .dependencies import get_mcp_v3_service, get_agent_by_mcp_api_key
from .service import McpV3Service
from .schemas import (
    McpAgentOut,
    McpBoundToolOut,
    McpStatusOut,
    BindToolRequest,
    BindToolsRequest,
    UpdateToolBindingRequest,
)


router = APIRouter(prefix="/mcp", tags=["mcp"])


# ============================================
# Agent MCP 配置管理
# ============================================


@router.get(
    "/agents/{agent_id}/status",
    response_model=ApiResponse[McpStatusOut],
    summary="获取 Agent 的 MCP 状态",
    status_code=status.HTTP_200_OK,
)
def get_mcp_status(
    agent_id: str,
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    data = svc.get_mcp_status(agent_id, current_user.user_id)
    return ApiResponse.success(data=data, message="获取 MCP 状态成功")


@router.post(
    "/agents/{agent_id}/regenerate-key",
    response_model=ApiResponse[dict],
    summary="重新生成 Agent 的 MCP API Key",
    status_code=status.HTTP_200_OK,
)
def regenerate_mcp_key(
    agent_id: str,
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    new_key = svc.regenerate_mcp_key(agent_id, current_user.user_id)
    return ApiResponse.success(
        data={"mcp_api_key": new_key},
        message="重新生成 MCP API Key 成功",
    )


# ============================================
# Tool 绑定管理
# ============================================


@router.get(
    "/agents/{agent_id}/tools",
    response_model=ApiResponse[List[McpBoundToolOut]],
    summary="获取 Agent 绑定的 Tools",
    status_code=status.HTTP_200_OK,
)
def list_bound_tools(
    agent_id: str,
    mcp_exposed_only: bool = Query(
        default=False, description="是否只返回 MCP 暴露的工具"
    ),
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    data = svc.list_bound_tools(
        agent_id,
        current_user.user_id,
        mcp_exposed_only=mcp_exposed_only,
    )
    return ApiResponse.success(data=data, message="获取绑定 Tools 成功")


@router.post(
    "/agents/{agent_id}/tools",
    response_model=ApiResponse[None],
    summary="批量绑定 Tools 到 Agent",
    status_code=status.HTTP_201_CREATED,
)
def bind_tools(
    agent_id: str,
    payload: BindToolsRequest,
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.bind_tools(agent_id, current_user.user_id, payload.bindings)
    return ApiResponse.success(data=None, message="绑定 Tools 成功")


@router.put(
    "/agents/{agent_id}/tools/{tool_id}",
    response_model=ApiResponse[None],
    summary="更新 Tool 绑定状态",
    status_code=status.HTTP_200_OK,
)
def update_tool_binding(
    agent_id: str,
    tool_id: str,
    payload: UpdateToolBindingRequest,
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.update_tool_binding(
        agent_id,
        current_user.user_id,
        tool_id,
        enabled=payload.enabled,
        mcp_exposed=payload.mcp_exposed,
    )
    return ApiResponse.success(data=None, message="更新 Tool 绑定成功")


@router.delete(
    "/agents/{agent_id}/tools/{tool_id}",
    response_model=ApiResponse[None],
    summary="解绑 Tool",
    status_code=status.HTTP_200_OK,
)
def unbind_tool(
    agent_id: str,
    tool_id: str,
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.unbind_tool(agent_id, current_user.user_id, tool_id)
    return ApiResponse.success(data=None, message="解绑 Tool 成功")


# ============================================
# MCP Server 代理
# ============================================


@router.api_route(
    "/proxy/{api_key}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server 代理路由（Legacy）",
    description="Legacy 路由：通过 URL path 传 mcp_api_key（仅兼容迁移期）。",
    include_in_schema=False,
)
@router.api_route(
    "/proxy/{api_key}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server 代理路由（Legacy）",
    description="Legacy 路由：通过 URL path 传 mcp_api_key（仅兼容迁移期）。",
    include_in_schema=False,
)
@router.api_route(
    "/proxy",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server 代理路由（推荐）",
    description="将请求转发到 MCP Server。请通过 `X-MCP-API-Key` Header 提供密钥。",
    include_in_schema=True,
)
@router.api_route(
    "/proxy/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server 代理路由（推荐）",
    description="将请求转发到 MCP Server。请通过 `X-MCP-API-Key` Header 提供密钥。",
    include_in_schema=True,
)
async def proxy_mcp_server(
    request: Request,
    path: str = "",
    agent: Agent = Depends(get_agent_by_mcp_api_key),
):
    """
    代理请求到 MCP Server。

    推荐方式：通过 Header `X-MCP-API-Key` 传递密钥。
    同时兼容 Legacy 路由 `/mcp/proxy/{api_key}`（迁移期）。
    """
    # 1. 拼接 MCP Server 地址
    mcp_server_url = (settings.MCP_SERVER_URL or "").rstrip("/")
    if not mcp_server_url:
        raise ValueError("MCP_SERVER_URL should not be empty.")

    normalized_path = (path or "").lstrip("/")
    legacy_api_key = request.path_params.get("api_key")
    # 当请求匹配到 legacy 路由但同时使用了 Header key（推荐方式）时，
    # 需要把 legacy 的 api_key path segment 还原为真实下游路径的一部分。
    if legacy_api_key and request.headers.get("X-MCP-API-Key"):
        normalized_path = (
            f"{legacy_api_key}/{normalized_path}"
            if normalized_path
            else str(legacy_api_key)
        )

    if normalized_path in ("", "mcp"):
        downstream_path = "/mcp/"
    elif normalized_path.startswith("mcp/"):
        downstream_path = f"/{normalized_path}"
    else:
        downstream_path = f"/mcp/{normalized_path}"

    target_url = f"{mcp_server_url}{downstream_path}"

    # 2. 读取请求体
    body = b""
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        try:
            body = await request.body()
        except ClientDisconnect:
            return Response(status_code=204)

    # 3. 准备转发的请求头
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    headers.pop("x-mcp-api-key", None)
    headers.pop("X-MCP-API-Key", None)
    headers["X-API-KEY"] = agent.mcp_api_key  # 使用 Agent 的 mcp_api_key

    # 4. 查询参数
    query_params = dict(request.query_params)

    # 5. SSE / 普通请求分流
    accept = (request.headers.get("accept") or "").lower()
    wants_sse = "text/event-stream" in accept

    def _filter_response_headers(raw_headers: httpx.Headers) -> dict:
        filtered: dict[str, str] = {}
        for k, v in raw_headers.items():
            lk = k.lower()
            if lk.startswith("mcp-") or lk.startswith("x-"):
                filtered[lk] = v
        return filtered

    if wants_sse:
        # SSE 流式响应
        timeout = httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0)
        client = httpx.AsyncClient(timeout=timeout, trust_env=False)
        upstream_response: httpx.Response | None = None
        try:
            last_exc: Exception | None = None
            for attempt in range(5):
                try:
                    upstream_request = client.build_request(
                        method=request.method,
                        url=target_url,
                        headers=headers,
                        content=body,
                        params=query_params,
                    )
                    upstream_response = await client.send(upstream_request, stream=True)
                    last_exc = None
                    break
                except httpx.ConnectError as e:
                    last_exc = e
                    await asyncio.sleep(min(0.2 * (2**attempt), 1.0))

            if upstream_response is None and last_exc is not None:
                raise last_exc

            response_headers = _filter_response_headers(upstream_response.headers)
            media_type = upstream_response.headers.get("content-type")

            async def _close_upstream():
                try:
                    if upstream_response is not None:
                        await upstream_response.aclose()
                finally:
                    await client.aclose()

            return StreamingResponse(
                upstream_response.aiter_raw(),
                status_code=upstream_response.status_code,
                headers=response_headers,
                media_type=media_type,
                background=BackgroundTask(_close_upstream),
            )
        except httpx.ConnectError as e:
            if upstream_response is not None:
                await upstream_response.aclose()
            await client.aclose()
            raise NotFoundException(
                f"无法连接到 MCP Server ({mcp_server_url}): {str(e)}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )
        except httpx.TimeoutException as e:
            if upstream_response is not None:
                await upstream_response.aclose()
            await client.aclose()
            raise NotFoundException(
                f"MCP Server 请求超时 ({mcp_server_url}): {str(e)}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )
        except Exception as e:
            if upstream_response is not None:
                await upstream_response.aclose()
            await client.aclose()
            raise NotFoundException(
                f"转发请求到 MCP Server 时发生错误: {str(e)}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )
    else:
        # 普通请求
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            try:
                last_exc: Exception | None = None
                upstream_response = None
                for attempt in range(5):
                    try:
                        upstream_response = await client.request(
                            method=request.method,
                            url=target_url,
                            headers=headers,
                            content=body,
                            params=query_params,
                        )
                        last_exc = None
                        break
                    except httpx.ConnectError as e:
                        last_exc = e
                        await asyncio.sleep(min(0.2 * (2**attempt), 1.0))

                if upstream_response is None and last_exc is not None:
                    raise last_exc

                response_headers = _filter_response_headers(upstream_response.headers)
                media_type = upstream_response.headers.get("content-type")

                return Response(
                    content=upstream_response.content,
                    status_code=upstream_response.status_code,
                    headers=response_headers,
                    media_type=media_type,
                )
            except httpx.ConnectError as e:
                raise NotFoundException(
                    f"无法连接到 MCP Server ({mcp_server_url}): {str(e)}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )
            except httpx.TimeoutException as e:
                raise NotFoundException(
                    f"MCP Server 请求超时 ({mcp_server_url}): {str(e)}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )
            except Exception as e:
                raise NotFoundException(
                    f"转发请求到 MCP Server 时发生错误: {str(e)}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )
