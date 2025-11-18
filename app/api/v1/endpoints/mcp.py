"""
MCP 实例管理 API
负责 MCP 实例的创建、查询、更新和删除
"""
from fastapi import APIRouter, Depends
from app.schemas.response import ApiResponse
from app.schemas.mcp import McpCreate, McpStatusResponse, McpUpdate
from app.service.mcp_service import McpService
from app.core.dependencies import get_mcp_instance_service
from app.utils.logger import log_error

router = APIRouter(prefix="/mcp", tags=["mcp"])

ERROR_CODE = 1002


@router.post("/", response_model=ApiResponse[str])
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
            tools_definition=mcp_create.tools_definition
        )
        
        # 返回 API key (JWT token)
        return ApiResponse.success(
            data=instance.api_key,
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
            docker_info=status_info.get("docker_info")
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


@router.put("/{api_key}", response_model=ApiResponse[None])
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
            tools_definition=mcp_update.tools_definition
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