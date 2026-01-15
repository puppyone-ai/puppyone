from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
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
)
async def create_agent_session(request: Request):
    payload = await request.json()
    prompt = payload.get("prompt") if isinstance(payload, dict) else None
    if not prompt:
        return JSONResponse(
            status_code=400,
            content=ApiResponse.error(code=400, message="Missing prompt").model_dump(),
        )
    return ApiResponse.error(code=501, message="Not implemented")
