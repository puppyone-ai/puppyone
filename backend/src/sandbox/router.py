from fastapi import APIRouter, Request, status, Depends
from fastapi.responses import JSONResponse
from src.common_schemas import ApiResponse
from src.sandbox.dependencies import get_sandbox_service

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
async def sandbox_action(
    request: Request, sandbox_service=Depends(get_sandbox_service)
):
    payload = await request.json()
    session_id = payload.get("session_id") if isinstance(payload, dict) else None
    if not session_id:
        return JSONResponse(
            status_code=400,
            content=ApiResponse.error(
                code=400, message="session_id is required"
            ).model_dump(),
        )
    action = payload.get("action")
    if action == "start":
        result = await sandbox_service.start(
            session_id=session_id,
            data=payload.get("data"),
            readonly=payload.get("readonly", False),
        )
        return ApiResponse.success(data=result)
    if action == "exec":
        result = await sandbox_service.exec(
            session_id=session_id, command=payload.get("command", "")
        )
        return ApiResponse.success(data=result)
    if action == "read":
        result = await sandbox_service.read(session_id=session_id)
        return ApiResponse.success(data=result)
    if action == "stop":
        result = await sandbox_service.stop(session_id=session_id)
        return ApiResponse.success(data=result)
    if action == "status":
        result = await sandbox_service.status(session_id=session_id)
        return ApiResponse.success(data=result)
    return ApiResponse.error(code=400, message="Invalid action")


@router.get(
    "",
    response_model=ApiResponse[None],
    summary="Sandbox status endpoint (placeholder)",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def sandbox_status():
    return ApiResponse.error(code=501, message="Not implemented")
