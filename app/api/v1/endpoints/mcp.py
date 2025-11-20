"""
MCP 实例管理 API
负责 MCP 实例的创建、查询、更新和删除
"""
from this import d
from fastapi import APIRouter, Depends
from app.schemas.response import ApiResponse
from app.schemas.mcp import McpCreate, McpStatusResponse, McpUpdate
from app.service.mcp_service import McpService
from app.core.dependencies import get_mcp_instance_service
from app.utils.logger import log_error
from typing import Dict, Any

router = APIRouter(prefix="/mcp", tags=["MCP实例管理"])

ERROR_CODE = 1002


@router.post("/", response_model=ApiResponse[Dict[str, Any]])
async def generate_mcp_instance(
    mcp_create: McpCreate,
    mcp_instance_service: McpService = Depends(get_mcp_instance_service)
):
    """
    创建一个 MCP 实例并返回对应的 API key (JWT token)
    
    流程：
    1. 生成 JWT token
    2. 调用 manager 创建 MCP server 实例（多进程方式）
    3. 存储到 repository
    4. 返回 API key
    """
    try:
        # 创建 MCP 实例
        instance = await mcp_instance_service.create_mcp_instance(
            user_id=mcp_create.user_id,
            project_id=mcp_create.project_id,
            context_id=mcp_create.context_id,
            tools_definition=mcp_create.tools_definition,
            register_tools=mcp_create.register_tools
        )
        
        # 返回 API key (JWT token)
        return ApiResponse.success(
            data={
                "api_key": instance.api_key,
                "url": f"http://localhost:{instance.port}/mcp"
            },
            message="MCP 实例创建成功"
        )
    except Exception as e:
        log_error(f"Failed to create MCP instance: {e}")
        return ApiResponse.error(
            code=ERROR_CODE,
            message=f"MCP 实例创建失败: {str(e)}"
        )


@router.get("/{api_key}", response_model=ApiResponse[McpStatusResponse])
async def get_mcp_status(
    api_key: str,
    mcp_instance_service: McpService = Depends(get_mcp_instance_service)
):
    """
    获取 MCP 实例状态
    
    返回实例的运行状态、端口和进程信息
    """
    try:
        status_info = await mcp_instance_service.get_mcp_instance_status(api_key)
        
        if "error" in status_info:
            return ApiResponse.error(
                code=ERROR_CODE,
                message=status_info["error"]
            )
        
        # 构建响应数据
        response_data = McpStatusResponse(
            status=status_info.get("status", 0),
            port=status_info.get("port"),
            docker_info=status_info.get("docker_info"),
            tools_definition=status_info.get("tools_definition"),
            register_tools=status_info.get("register_tools")
        )
        
        return ApiResponse.success(
            data=response_data,
            message="MCP 实例状态获取成功"
        )
    except Exception as e:
        log_error(f"Failed to get MCP instance status: {e}")
        return ApiResponse.error(
            code=ERROR_CODE,
            message=f"获取 MCP 实例状态失败: {str(e)}"
        )


@router.put("/{api_key}",response_model=ApiResponse[None],
    description="更新MCP实例。\n 1. 任何无需改变的参数，请不要传入，包括status。\n 2. 如果需要更新工具定义，请传入tools_definition。\n 3. 如果需要更新注册工具，请传入register_tools。"
)
async def update_mcp(
    api_key: str,
    mcp_update: McpUpdate,
    mcp_instance_service: McpService = Depends(get_mcp_instance_service)
):
    """
    更新 MCP 实例
    
    可以更新实例状态（开启/关闭）和工具定义
    """
    try:
        updated_instance = await mcp_instance_service.update_mcp_instance(
            api_key=api_key,
            status=mcp_update.status,
            tools_definition=mcp_update.tools_definition,
            register_tools=mcp_update.register_tools
        )
        
        if not updated_instance:
            return ApiResponse.error(
                code=ERROR_CODE,
                message="MCP 实例不存在"
            )
        
        return ApiResponse.success(
            data=None,
            message="MCP 实例更新成功"
        )
    except Exception as e:
        log_error(f"Failed to update MCP instance: {e}")
        return ApiResponse.error(
            code=ERROR_CODE,
            message=f"MCP 实例更新失败: {str(e)}"
        )


@router.delete("/{api_key}", response_model=ApiResponse[None])
async def delete_mcp_instance(
    api_key: str,
    mcp_instance_service: McpService = Depends(get_mcp_instance_service)
):
    """
    删除 MCP 实例
    
    停止 MCP server 进程并从 repository 中删除记录
    """
    try:
        result = await mcp_instance_service.delete_mcp_instance(api_key)
        
        if not result:
            return ApiResponse.error(
                code=ERROR_CODE,
                message="MCP 实例不存在或删除失败"
            )
        
        return ApiResponse.success(
            data=None,
            message="MCP 实例删除成功"
        )
    except Exception as e:
        log_error(f"Failed to delete MCP instance: {e}")
        return ApiResponse.error(
            code=ERROR_CODE,
            message=f"MCP 实例删除失败: {str(e)}"
        )