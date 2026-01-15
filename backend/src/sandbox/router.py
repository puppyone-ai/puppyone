from fastapi import APIRouter, status
from src.common_schemas import ApiResponse

router = APIRouter(
    prefix="/sandboxes",
    tags=["sandboxes"],
    responses={
        404: {"description": "资源未找到"},
        500: {"description": "服务器内部错误"},
    },
)


@router.post(
    "",
    response_model=ApiResponse[None],
    summary="Sandbox action endpoint (placeholder)",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def sandbox_action():
    return ApiResponse.error(code=501, message="Not implemented")


@router.get(
    "",
    response_model=ApiResponse[None],
    summary="Sandbox status endpoint (placeholder)",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def sandbox_status():
    return ApiResponse.error(code=501, message="Not implemented")
