"""
MCP v2 实例与绑定管理 API
"""

from __future__ import annotations

import jwt
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.requests import ClientDisconnect
from typing import List
import httpx

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.config import settings
from src.exceptions import ErrorCode, NotFoundException
from src.mcp_v2.dependencies import get_mcp_v2_instance_by_api_key, get_mcp_v2_service
from src.mcp_v2.schemas import (
    McpV2Create,
    McpV2CreateWithBindings,
    McpV2CreateWithBindingsOut,
    McpV2Out,
    McpV2Update,
    BindToolsRequest,
    UpdateBindingRequest,
    BoundToolOut,
)
from src.mcp_v2.service import McpV2Service
from src.mcp_v2.models import McpV2Instance


# 对外统一使用 /mcp（旧版 /mcp 已下线）
router = APIRouter(prefix="/mcp", tags=["mcp"])


def _generate_api_key(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


@router.get(
    "/list",
    response_model=ApiResponse[List[McpV2Out]],
    summary="获取当前用户的 MCP v2 实例列表",
    status_code=status.HTTP_200_OK,
)
def list_mcp_v2(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    data = svc.list_user_instances(current_user.user_id, skip=skip, limit=limit)
    return ApiResponse.success(data=data, message="获取 MCP v2 列表成功")


@router.post(
    "/",
    response_model=ApiResponse[dict],
    summary="创建 MCP v2 实例（仅入口，不绑定 Context）",
    status_code=status.HTTP_201_CREATED,
)
def create_mcp_v2(
    payload: McpV2Create,
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    api_key = _generate_api_key(current_user.user_id)
    inst = svc.create_instance(
        user_id=current_user.user_id,
        api_key=api_key,
        name=payload.name,
        status=True,
    )
    return ApiResponse.success(
        data={"api_key": inst.api_key, "id": inst.id},
        message="创建 MCP v2 成功",
    )


@router.post(
    "/with_bindings",
    response_model=ApiResponse[McpV2CreateWithBindingsOut],
    summary="创建 MCP v2 实例并批量绑定 Tool（原子）",
    status_code=status.HTTP_201_CREATED,
)
def create_mcp_v2_with_bindings(
    payload: McpV2CreateWithBindings,
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    api_key = _generate_api_key(current_user.user_id)
    inst = svc.create_instance_with_bindings(
        user_id=current_user.user_id,
        api_key=api_key,
        name=payload.name,
        status=True,
        bindings=payload.bindings,
    )
    return ApiResponse.success(
        data=McpV2CreateWithBindingsOut(
            id=inst.id,
            api_key=inst.api_key,
            tool_ids=[b.tool_id for b in payload.bindings],
        ),
        message="创建 MCP v2 并绑定 Tool 成功",
    )


@router.get(
    "/{api_key}",
    response_model=ApiResponse[McpV2Out],
    summary="获取 MCP v2 实例",
)
def get_mcp_v2(
    api_key: str,
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    inst = svc.get_by_api_key_with_access_check(api_key, current_user.user_id)
    return ApiResponse.success(data=inst, message="获取 MCP v2 成功")


@router.put(
    "/{api_key}",
    response_model=ApiResponse[McpV2Out],
    summary="更新 MCP v2 实例",
)
def update_mcp_v2(
    api_key: str,
    payload: McpV2Update,
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    inst = svc.update_instance(
        api_key=api_key,
        user_id=current_user.user_id,
        name=payload.name,
        status=payload.status,
    )
    return ApiResponse.success(data=inst, message="更新 MCP v2 成功")


@router.delete(
    "/{api_key}",
    response_model=ApiResponse[None],
    summary="删除 MCP v2 实例",
)
def delete_mcp_v2(
    api_key: str,
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.delete_instance(api_key=api_key, user_id=current_user.user_id)
    return ApiResponse.success(data=None, message="删除 MCP v2 成功")


@router.post(
    "/{api_key}/bindings",
    response_model=ApiResponse[None],
    summary="绑定 Tool 到 MCP v2（支持批量）",
)
def bind_tool(
    api_key: str,
    payload: BindToolsRequest,
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.bind_tools(
        api_key=api_key,
        user_id=current_user.user_id,
        bindings=payload.bindings,
    )
    return ApiResponse.success(data=None, message="绑定成功")


@router.put(
    "/{api_key}/bindings/{tool_id}",
    response_model=ApiResponse[None],
    summary="更新绑定状态（启用/禁用）",
)
def update_binding(
    api_key: str,
    tool_id: str,
    payload: UpdateBindingRequest,
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.update_binding_status(
        api_key=api_key,
        user_id=current_user.user_id,
        tool_id=tool_id,
        status=payload.status,
    )
    return ApiResponse.success(data=None, message="更新绑定状态成功")


@router.delete(
    "/{api_key}/bindings/{tool_id}",
    response_model=ApiResponse[None],
    summary="解绑 Tool",
)
def unbind_tool(
    api_key: str,
    tool_id: str,
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.unbind_tool(api_key=api_key, user_id=current_user.user_id, tool_id=tool_id)
    return ApiResponse.success(data=None, message="解绑成功")


@router.get(
    "/{api_key}/tools",
    response_model=ApiResponse[List[BoundToolOut]],
    summary="获取 MCP v2 绑定的 Tool 列表（按 api_key）",
    status_code=status.HTTP_200_OK,
)
def list_bound_tools_by_api_key(
    include_disabled: bool = Query(
        default=False, description="是否包含 disabled bindings"
    ),
    instance: McpV2Instance = Depends(get_mcp_v2_instance_by_api_key),
    svc: McpV2Service = Depends(get_mcp_v2_service),
):
    # api_key 路由不要求登录：若实例被禁用，则不对外暴露
    if not instance.status:
        raise NotFoundException(
            f"StatusError: MCP v2 instance is disabled (status={instance.status})",
            code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
        )

    data = svc.list_bound_tools_by_mcp_id(
        instance.id, include_disabled=include_disabled
    )
    return ApiResponse.success(data=data, message="获取 MCP v2 绑定 Tool 列表成功")


@router.get(
    "/id/{mcp_id}/tools",
    response_model=ApiResponse[List[BoundToolOut]],
    summary="获取 MCP v2 绑定的 Tool 列表（按 mcp_id）",
    status_code=status.HTTP_200_OK,
)
def list_bound_tools_by_mcp_id(
    mcp_id: int,
    include_disabled: bool = Query(
        default=False, description="是否包含 disabled bindings"
    ),
    svc: McpV2Service = Depends(get_mcp_v2_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    data = svc.list_bound_tools_by_mcp_id_with_access_check(
        mcp_id,
        user_id=current_user.user_id,
        include_disabled=include_disabled,
    )
    return ApiResponse.success(data=data, message="获取 MCP v2 绑定 Tool 列表成功")


# ============================================================
# MCP v2 协议代理接口
# - 职责:
#   1. 基础拦截: 验证 api_key 是否存在（mcp_v2）。
#   2. 状态拦截: 如果用户未启用此 mcp_v2，拒绝请求。
#   3. 健康拦截: 如果目标实例不可达，拒绝请求。
# - 行为：模仿 /mcp/server/*，但实例来源为 mcp_v2
# ============================================================


@router.api_route(
    "/server/{api_key}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP v2 Server 代理路由（根路径）",
    description="将请求转发到共享 MCP Server（下游 /mcp/*）。此接口不需要用户登录，只需提供有效的 api_key 即可。",
    include_in_schema=False,
)
@router.api_route(
    "/server/{api_key}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP v2 Server 代理路由",
    description="将请求转发到共享 MCP Server（下游 /mcp/*）。此接口不需要用户登录，只需提供有效的 api_key 即可。",
    include_in_schema=True,
)
async def proxy_mcp_v2_server(
    request: Request,
    path: str = "",
    instance: McpV2Instance = Depends(get_mcp_v2_instance_by_api_key),
):
    # 1. 检查是否启用了 mcp_v2
    if not instance.status:
        raise NotFoundException(
            f"StatusError: MCP v2 instance is disabled (status={instance.status})",
            code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
        )

    # 2.1 拼接 mcp_server 地址
    mcp_server_url = (settings.MCP_SERVER_URL or "").rstrip("/")
    if not mcp_server_url:
        raise ValueError("MCP SERVER URL should not be empty.")

    normalized_path = (path or "").lstrip("/")
    if normalized_path in ("", "mcp"):
        downstream_path = "/mcp/"
    elif normalized_path.startswith("mcp/"):
        downstream_path = f"/{normalized_path}"
    else:
        downstream_path = f"/mcp/{normalized_path}"

    target_url = f"{mcp_server_url}{downstream_path}"

    # 2.2 读取请求体（避免 GET/HEAD/OPTIONS 下读 body 导致 ClientDisconnect）
    body = b""
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        try:
            body = await request.body()
        except ClientDisconnect:
            return Response(status_code=204)

    # 2.3 准备转发的请求头
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    headers["X-API-KEY"] = instance.api_key

    # 2.4 查询参数
    query_params = dict(request.query_params)

    # 2.5 SSE / 普通请求分流
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
