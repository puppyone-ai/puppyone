"""
MCP 实例管理 API
负责 MCP 实例的创建、查询、更新和删除
"""

from fastapi import APIRouter, Depends
from fastapi.params import Query
from src.common_schemas import ApiResponse
from src.mcp.schemas import McpCreate, McpStatusResponse, McpUpdate
from src.mcp.service import McpService
from src.mcp.dependencies import get_mcp_instance_service
from typing import Dict, Any, List
from src.mcp.models import McpInstance

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get(
    "/list",
    response_model=ApiResponse[List[McpInstance]],
    summary="获取用户的所有 MCP 实例",
    description="根据用户ID获取该用户下的所有MCP实例列表。⚠️：此接口目前无鉴权逻辑",
    response_description="返回用户的所有MCP实例列表",
)
async def list_mcp_instances(
    user_id: str = Query(..., description="用户ID"),
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
):
    """
    获取用户的所有 MCP 实例
    """
    instances = await mcp_instance_service.get_user_mcp_instances(user_id)
    return ApiResponse.success(data=instances, message="获取 MCP 实例列表成功")


@router.post(
    "/",
    response_model=ApiResponse[Dict[str, Any]],
    summary="创建并启动一个MCP实例并返回对应的 API_KEY和URL",
    description="创建一个MCP实例并通过子进程方式启动一个MCP Server, 返回鉴权用的API_KEY和URL",
)
async def generate_mcp_instance(
    mcp_create: McpCreate,
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
):
    """
    创建一个 MCP 实例并返回对应的 API key (JWT token)
    """
    # 创建 MCP 实例
    instance = await mcp_instance_service.create_mcp_instance(
        user_id=mcp_create.user_id,
        project_id=mcp_create.project_id,
        context_id=mcp_create.context_id,
        json_pointer=mcp_create.json_pointer,
        tools_definition=mcp_create.tools_definition,
        register_tools=mcp_create.register_tools,
        preview_keys=mcp_create.preview_keys,
    )

    # 返回 API key (JWT token)
    return ApiResponse.success(
        data={
            "api_key": instance.api_key,
            "url": f"http://localhost:{instance.port}/mcp",
        },
        message="MCP 实例创建成功",
    )


@router.get(
    "/{api_key}",
    response_model=ApiResponse[McpStatusResponse],
    summary="查询MCP实例的运行状态信息",
)
async def get_mcp_status(
    api_key: str, mcp_instance_service: McpService = Depends(get_mcp_instance_service)
):
    """
    获取 MCP 实例状态
    """
    status_info = await mcp_instance_service.get_mcp_instance_status(api_key)

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
    api_key: str,
    mcp_update: McpUpdate,
    mcp_instance_service: McpService = Depends(get_mcp_instance_service),
):
    """
    更新 MCP 实例

    可以更新实例状态（开启/关闭）和工具定义
    更新成功后返回最新的实例状态信息
    """
    await mcp_instance_service.update_mcp_instance(
        api_key=api_key,
        status=mcp_update.status,
        json_pointer=mcp_update.json_pointer,
        tools_definition=mcp_update.tools_definition,
        register_tools=mcp_update.register_tools,
        preview_keys=mcp_update.preview_keys,
    )

    # 获取更新后的最新状态信息
    status_info = await mcp_instance_service.get_mcp_instance_status(api_key)

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
    api_key: str, mcp_instance_service: McpService = Depends(get_mcp_instance_service)
):
    """
    删除 MCP 实例
    """
    await mcp_instance_service.delete_mcp_instance(api_key)

    return ApiResponse.success(data=None, message="MCP 实例删除成功")
