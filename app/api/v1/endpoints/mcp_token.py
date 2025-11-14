"""
负责mcp token的生成和维护
"""

from fastapi import APIRouter, Depends
from app.schemas.response import ApiResponse
from app.service.mcp_token_service import McpTokenService
from app.core.dependencies import get_mcp_token_service
from app.models.mcp_token import TokenStatus
router = APIRouter(prefix="/mcp_tokens", tags=["mcp_tokens"])

ERROR_CODE = 1002

# 生成访问mcp服务的Token，在业务上即“发布一个mcp”
@router.post("/", response_model=ApiResponse[str])
async def generate_mcp_token(user_id: int, project_id: int, ctx_id: int, mcp_token_service: McpTokenService = Depends(get_mcp_token_service)):
    """
    生成mcp token
    """
    token = mcp_token_service.generate_mcp_token(user_id, project_id, ctx_id)
    if not token:
        return ApiResponse.error(code=ERROR_CODE, message="mcp token生成失败")
    return ApiResponse.success(data=token, message="mcp token生成成功")

@router.get("/{token}", response_model=ApiResponse[TokenStatus])
async def check_mcp_status(token: str, mcp_token_service: McpTokenService = Depends(get_mcp_token_service)):
    """
    检查mcp token状态
    """
    status = mcp_token_service.get_token_status(token)
    if not status:
        return ApiResponse.error(code=ERROR_CODE, message="mcp token不存在")
    return ApiResponse.success(data=status, message="mcp token状态检查成功")

@router.put("/{token}/revoke", response_model=ApiResponse[None])
async def revoke_mcp_token(token: str, mcp_token_service: McpTokenService = Depends(get_mcp_token_service)):
    """
    撤销mcp token，将token状态设置为revoked
    """
    result = mcp_token_service.revoke_token(token)
    if not result:
        return ApiResponse.error(code=ERROR_CODE, message="mcp token撤销失败")
    return ApiResponse.success(data=None, message="mcp token撤销成功")

@router.put("/{token}/expire", response_model=ApiResponse[None])
async def expire_mcp_token(token: str, mcp_token_service: McpTokenService = Depends(get_mcp_token_service)):
    """
    使mcp token过期，将token状态设置为expired
    """
    result = mcp_token_service.expire_token(token)
    if not result:
        return ApiResponse.error(code=ERROR_CODE, message="mcp token过期失败")
    return ApiResponse.success(data=None, message="mcp token过期成功")

@router.delete("/{token}", response_model=ApiResponse[None])
async def delete_mcp_token(token: str, mcp_token_service: McpTokenService = Depends(get_mcp_token_service)):
    """
    删除mcp token
    """
    result = mcp_token_service.delete_token(token)
    if not result:
        return ApiResponse.error(code=ERROR_CODE, message="mcp token删除失败")
    return ApiResponse.success(data=None, message="mcp token删除成功")