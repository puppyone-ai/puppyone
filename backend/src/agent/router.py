from fastapi import APIRouter, status
from src.common_schemas import ApiResponse

router = APIRouter(
    prefix="/agents",
    tags=["agents"],
    responses={
        404: {"description": "资源未找到"},
        500: {"description": "服务器内部错误"},
    },
)


@router.post(
    "",
    response_model=ApiResponse[None],
    summary="Agent SSE endpoint (placeholder)",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def create_agent_session():
    return ApiResponse.error(code=501, message="Not implemented")
