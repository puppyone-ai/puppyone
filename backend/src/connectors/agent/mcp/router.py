"""
MCP V3 Router

MCP API endpoints based on the Agent architecture:
1. /mcp/agents/{agent_id}/... - Agent MCP configuration management
2. /mcp/proxy/... - Proxy to MCP Server (recommended: Header X-MCP-API-Key, with legacy path key fallback)
"""

from __future__ import annotations

import asyncio
from typing import List

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.requests import ClientDisconnect
import httpx

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.config import settings
from src.exceptions import NotFoundException, ErrorCode
from src.connectors.agent.config.models import Agent

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
# Agent MCP Configuration Management
# ============================================


@router.get(
    "/agents/{agent_id}/status",
    response_model=ApiResponse[McpStatusOut],
    summary="Get MCP status for an Agent",
    status_code=status.HTTP_200_OK,
)
def get_mcp_status(
    agent_id: str,
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    data = svc.get_mcp_status(agent_id, current_user.user_id)
    return ApiResponse.success(data=data, message="MCP status retrieved successfully")


@router.post(
    "/agents/{agent_id}/regenerate-key",
    response_model=ApiResponse[dict],
    summary="Regenerate MCP API Key for an Agent",
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
        message="MCP API Key regenerated successfully",
    )


# ============================================
# Tool Binding Management
# ============================================


@router.get(
    "/agents/{agent_id}/tools",
    response_model=ApiResponse[List[McpBoundToolOut]],
    summary="Get Tools bound to an Agent",
    status_code=status.HTTP_200_OK,
)
def list_bound_tools(
    agent_id: str,
    mcp_exposed_only: bool = Query(
        default=False, description="Whether to return only MCP-exposed tools"
    ),
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    data = svc.list_bound_tools(
        agent_id,
        current_user.user_id,
        mcp_exposed_only=mcp_exposed_only,
    )
    return ApiResponse.success(data=data, message="Bound tools retrieved successfully")


@router.post(
    "/agents/{agent_id}/tools",
    response_model=ApiResponse[None],
    summary="Batch bind Tools to an Agent",
    status_code=status.HTTP_201_CREATED,
)
def bind_tools(
    agent_id: str,
    payload: BindToolsRequest,
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.bind_tools(agent_id, current_user.user_id, payload.bindings)
    return ApiResponse.success(data=None, message="Tools bound successfully")


@router.put(
    "/agents/{agent_id}/tools/{tool_id}",
    response_model=ApiResponse[None],
    summary="Update Tool binding status",
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
    return ApiResponse.success(data=None, message="Tool binding updated successfully")


@router.delete(
    "/agents/{agent_id}/tools/{tool_id}",
    response_model=ApiResponse[None],
    summary="Unbind a Tool",
    status_code=status.HTTP_200_OK,
)
def unbind_tool(
    agent_id: str,
    tool_id: str,
    svc: McpV3Service = Depends(get_mcp_v3_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.unbind_tool(agent_id, current_user.user_id, tool_id)
    return ApiResponse.success(data=None, message="Tool unbound successfully")


# ============================================
# MCP Server Proxy
# ============================================


@router.api_route(
    "/proxy/{api_key}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server proxy route (Legacy)",
    description="Legacy route: pass mcp_api_key via URL path (migration compatibility only).",
    include_in_schema=False,
)
@router.api_route(
    "/proxy/{api_key}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server proxy route (Legacy)",
    description="Legacy route: pass mcp_api_key via URL path (migration compatibility only).",
    include_in_schema=False,
)
@router.api_route(
    "/proxy",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server proxy route (Recommended)",
    description="Forward requests to MCP Server. Provide the key via `X-MCP-API-Key` header.",
    include_in_schema=True,
)
@router.api_route(
    "/proxy/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server proxy route (Recommended)",
    description="Forward requests to MCP Server. Provide the key via `X-MCP-API-Key` header.",
    include_in_schema=True,
)
async def proxy_mcp_server(
    request: Request,
    path: str = "",
    agent: Agent = Depends(get_agent_by_mcp_api_key),
):
    """
    Proxy requests to MCP Server.

    Recommended: pass the key via `X-MCP-API-Key` header.
    Also compatible with legacy route `/mcp/proxy/{api_key}` (migration period).
    """
    # 1. Build MCP Server URL
    mcp_server_url = (settings.MCP_SERVER_URL or "").rstrip("/")
    if not mcp_server_url:
        raise ValueError("MCP_SERVER_URL should not be empty.")

    normalized_path = (path or "").lstrip("/")
    legacy_api_key = request.path_params.get("api_key")
    # When the request matches the legacy route but also uses the Header key (recommended),
    # we need to restore the legacy api_key path segment as part of the real downstream path.
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

    # 2. Read request body
    body = b""
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        try:
            body = await request.body()
        except ClientDisconnect:
            return Response(status_code=204)

    # 3. Prepare forwarding request headers
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    headers.pop("x-mcp-api-key", None)
    headers.pop("X-MCP-API-Key", None)
    headers["X-API-KEY"] = agent.mcp_api_key  # Use the Agent's mcp_api_key

    # 4. Query parameters
    query_params = dict(request.query_params)

    # 5. SSE / normal request routing
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
        # SSE streaming response
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
                f"Cannot connect to MCP Server ({mcp_server_url}): {str(e)}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )
        except httpx.TimeoutException as e:
            if upstream_response is not None:
                await upstream_response.aclose()
            await client.aclose()
            raise NotFoundException(
                f"MCP Server request timed out ({mcp_server_url}): {str(e)}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )
        except Exception as e:
            if upstream_response is not None:
                await upstream_response.aclose()
            await client.aclose()
            raise NotFoundException(
                f"Error forwarding request to MCP Server: {str(e)}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )
    else:
        # Normal request
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
                    f"Cannot connect to MCP Server ({mcp_server_url}): {str(e)}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )
            except httpx.TimeoutException as e:
                raise NotFoundException(
                    f"MCP Server request timed out ({mcp_server_url}): {str(e)}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )
            except Exception as e:
                raise NotFoundException(
                    f"Error forwarding request to MCP Server: {str(e)}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )
