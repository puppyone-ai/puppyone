import json
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
from src.common_schemas import ApiResponse
from src.agent.schemas import AgentRequest
from src.agent.dependencies import get_agent_service
from src.auth.dependencies import get_current_user
from src.table.dependencies import get_table_service
from src.sandbox.dependencies import get_sandbox_service
from fastapi.responses import StreamingResponse

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
async def create_agent_session(
    request: Request,
    current_user=Depends(get_current_user),
    agent_service=Depends(get_agent_service),
    table_service=Depends(get_table_service),
    sandbox_service=Depends(get_sandbox_service),
):
    payload = await request.json()
    prompt = payload.get("prompt") if isinstance(payload, dict) else None
    if not prompt:
        return JSONResponse(
            status_code=400,
            content=ApiResponse.error(code=400, message="Missing prompt").model_dump(),
        )
    agent_request = AgentRequest(**payload)
    async def event_stream():
        try:
            async for event in agent_service.stream_events(
                request=agent_request,
                current_user=current_user,
                table_service=table_service,
                sandbox_service=sandbox_service,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
