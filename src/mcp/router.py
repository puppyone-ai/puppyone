"""
MCP 实例管理 API
负责 MCP 实例的创建、查询、更新和删除
"""

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.requests import ClientDisconnect
from src.common_schemas import ApiResponse
from src.mcp.schemas import McpCreate, McpStatusResponse, McpUpdate
from src.mcp.service import McpService
from src.mcp.dependencies import (
    get_mcp_instance_service,
    get_verified_mcp_instance,
    get_mcp_instance_by_api_key,
)
from src.mcp.models import McpInstance
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.exceptions import NotFoundException, ErrorCode
from typing import Dict, Any, List
import httpx
import asyncio

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get(
    "/list",
    response_model=ApiResponse[List[McpInstance]],
    summary="获取用户的所有 MCP 实例",
    description="获取当前用户下的所有MCP实例列表",
    response_description="返回用户的所有MCP实例列表",
)
async def list_mcp_instances(
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    获取用户的所有 MCP 实例
    """
    instances = await mcp_instance_service.get_user_mcp_instances(current_user.user_id)
    return ApiResponse.success(data=instances, message="获取 MCP 实例列表成功")


@router.post(
    "/",
    response_model=ApiResponse[Dict[str, Any]],
    summary="创建并启动一个MCP实例并返回对应的 API_KEY和URL",
    description="创建一个MCP实例并通过子进程方式启动一个MCP Server, 返回鉴权用的API_KEY和URL（包括代理URL和直接访问URL）",
)
async def generate_mcp_instance(
    request: Request,
    mcp_create: McpCreate,
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    创建一个 MCP 实例并返回对应的 API key (JWT token)
    
    返回两个 URL：
    1. proxy_url: 通过代理访问的 URL（推荐使用，无需记住端口）
    2. direct_url: 直接访问 MCP Server 的 URL（需要记住端口）
    """
    # 创建 MCP 实例（使用当前用户的 user_id）
    instance = await mcp_instance_service.create_mcp_instance(
        user_id=current_user.user_id,
        project_id=mcp_create.project_id,
        table_id=mcp_create.table_id,
        json_pointer=mcp_create.json_pointer,
        tools_definition=mcp_create.tools_definition,
        register_tools=mcp_create.register_tools,
        preview_keys=mcp_create.preview_keys,
    )

    # 构建代理 URL（使用当前请求的 host 和 scheme）
    scheme = request.url.scheme  # http 或 https
    host = request.headers.get("host", f"localhost:{request.url.port or 8000}")
    proxy_url = f"{scheme}://{host}/api/v1/mcp/server/{instance.api_key}"
    
    # 构建直接访问 URL
    direct_url = f"http://localhost:{instance.port}/mcp"

    # 返回 API key (JWT token) 和两个 URL
    return ApiResponse.success(
        data={
            "api_key": instance.api_key,
            "proxy_url": proxy_url,
            "direct_url": direct_url,
            # 为了向后兼容，保留原来的 url 字段，指向直接访问 URL
            "url": direct_url,
        },
        message="MCP 实例创建成功",
    )


@router.get(
    "/{api_key}",
    response_model=ApiResponse[McpStatusResponse],
    summary="查询MCP实例的运行状态信息",
)
async def get_mcp_status(
    instance: McpInstance = Depends(get_verified_mcp_instance),
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
):
    """
    获取 MCP 实例状态
    """
    status_info = await mcp_instance_service.get_mcp_instance_status(instance.api_key)

    # 构建响应数据
    response_data = McpStatusResponse(
        status=status_info.get("status", 0),
        port=status_info.get("port"),
        docker_info=status_info.get("docker_info"),
        json_pointer=status_info.get("json_pointer"),
        tools_definition=status_info.get("tools_definition"),
        register_tools=status_info.get("register_tools"),
        preview_keys=status_info.get("preview_keys"),
    )

    return ApiResponse.success(data=response_data, message="MCP 实例状态获取成功")


@router.put(
    "/{api_key}",
    response_model=ApiResponse[McpStatusResponse],
    summary="更新MCP实例的相关配置并返回最新状态信息",
    description="1. 对于任何无需改变的参数, 直接不传入.  2. 如果需要更新工具定义: 传入tools_definition。\n 3. 如果需要更新注册工具: 传入register_tools",
)
async def update_mcp(
    instance: McpInstance = Depends(get_verified_mcp_instance),
    mcp_update: McpUpdate = ...,
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
):
    """
    更新 MCP 实例

    可以更新实例状态（开启/关闭）和工具定义
    更新成功后返回最新的实例状态信息
    """
    await mcp_instance_service.update_mcp_instance(
        api_key=instance.api_key,
        status=mcp_update.status,
        json_pointer=mcp_update.json_pointer,
        tools_definition=mcp_update.tools_definition,
        register_tools=mcp_update.register_tools,
        preview_keys=mcp_update.preview_keys,
    )

    # 获取更新后的最新状态信息
    status_info = await mcp_instance_service.get_mcp_instance_status(instance.api_key)

    # 构建响应数据
    response_data = McpStatusResponse(
        status=status_info.get("status", 0),
        port=status_info.get("port"),
        docker_info=status_info.get("docker_info"),
        json_pointer=status_info.get("json_pointer"),
        tools_definition=status_info.get("tools_definition"),
        register_tools=status_info.get("register_tools"),
        preview_keys=status_info.get("preview_keys"),
    )

    return ApiResponse.success(data=response_data, message="MCP 实例更新成功")


@router.delete(
    "/{api_key}",
    response_model=ApiResponse[None],
    summary="停止MCP Server进程并删除MCP实例。",
)
async def delete_mcp_instance(
    instance: McpInstance = Depends(get_verified_mcp_instance),
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
):
    """
    删除 MCP 实例
    """
    await mcp_instance_service.delete_mcp_instance(instance.api_key)

    return ApiResponse.success(data=None, message="MCP 实例删除成功")


@router.api_route(
    "/server/{api_key}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server 代理路由（根路径）",
    description="将请求转发到对应的 MCP Server 实例根路径（等价于 /mcp）。此接口不需要用户登录，只需提供有效的 api_key 即可。",
    include_in_schema=False,
)
@router.api_route(
    "/server/{api_key}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    summary="MCP Server 代理路由",
    description="将请求转发到对应的 MCP Server 实例。此接口不需要用户登录，只需提供有效的 api_key 即可。",
    include_in_schema=True,
)
async def proxy_mcp_server(
    request: Request,
    api_key: str,
    path: str = "",
    instance: McpInstance = Depends(get_mcp_instance_by_api_key),
):
    """
    MCP Server 代理路由
    
    该路由充当代理，将所有请求转发到对应的 MCP Server 实例。
    用户无需直接访问不同端口的 MCP Server，而是通过统一的代理端点访问。
    
    注意：此接口不需要用户登录的 JWT token，只需要在 URL 中提供有效的 api_key 即可。
    
    Args:
        request: FastAPI Request 对象
        path: 要转发的路径（从 URL 中提取）
        instance: 验证后的 MCP 实例（通过依赖注入，只验证 api_key 是否存在）
    
    Returns:
        转发的响应
    
    Raises:
        NotFoundException: 如果 MCP 实例不存在或未运行
    """
    # 检查实例状态
    if instance.status != True:
        raise NotFoundException(
            f"MCP instance is not running (status={instance.status})",
            code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
        )

    # 代理转发到本机端口：必须禁用环境代理变量，否则 localhost 可能被错误走代理导致 502

    # 构建目标 URL（兼容客户端把 /mcp 写进 path 与否）
    # - 代理 base: /api/v1/mcp/server/{api_key}   -> 下游 /mcp
    # - 代理 base: /api/v1/mcp/server/{api_key}/mcp -> 下游 /mcp
    # - 其余路径：默认都认为是相对 /mcp 的子路径
    normalized_path = (path or "").lstrip("/")
    if normalized_path in ("", "mcp"):
        downstream_path = "/mcp"
    elif normalized_path.startswith("mcp/"):
        downstream_path = f"/{normalized_path}"
    else:
        downstream_path = f"/mcp/{normalized_path}"

    target_url = f"http://localhost:{instance.port}{downstream_path}"
    
    # 获取请求体：
    # - GET/HEAD/OPTIONS 通常无 body，且读取可能在客户端断开时触发 ClientDisconnect
    # - 仅在可能携带 body 的方法下读取
    body = b""
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        try:
            body = await request.body()
        except ClientDisconnect:
            # 客户端已断开连接，无需继续转发
            return Response(status_code=204)
    
    # 准备转发的请求头（排除某些不应转发的头）
    headers = dict(request.headers)
    # 移除 Host 头，让 httpx 自动设置
    headers.pop("host", None)
    # 移除 content-length，让 httpx 自动计算
    headers.pop("content-length", None)
    
    # 准备查询参数：需要添加 token/api_key 以便 MCP Server 验证
    # 将原始查询参数转换为字典，并添加 token/api_key（下游中间件支持二者）
    query_params = dict(request.query_params)
    # 如果查询参数中还没有 token 或 api_key，补齐（优先保持与直连一致：使用 api_key）
    if "token" not in query_params and "api_key" not in query_params:
        query_params["api_key"] = instance.api_key

    # 创建 httpx 客户端并转发请求
    # - 对于 SSE（Accept: text/event-stream）：使用 stream=True + read=None
    # - 其他情况：普通请求，read=30s
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
            # 启动/重启后端口可能需要一点时间才能接受连接，这里做轻量重试
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
                f"无法连接到 MCP Server (port={instance.port}): {str(e)}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )
        except httpx.TimeoutException as e:
            if upstream_response is not None:
                await upstream_response.aclose()
            await client.aclose()
            raise NotFoundException(
                f"MCP Server 请求超时 (port={instance.port}): {str(e)}",
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
                    f"无法连接到 MCP Server (port={instance.port}): {str(e)}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )
            except httpx.TimeoutException as e:
                raise NotFoundException(
                    f"MCP Server 请求超时 (port={instance.port}): {str(e)}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )
            except Exception as e:
                raise NotFoundException(
                    f"转发请求到 MCP Server 时发生错误: {str(e)}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )
