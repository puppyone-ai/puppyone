import json
from fastapi import APIRouter, Depends
from src.agent.schemas import AgentRequest
from src.agent.dependencies import get_agent_service
from src.sandbox.dependencies import get_sandbox_service
from fastapi.responses import StreamingResponse

def _get_current_user_optional():
    try:
        from src.auth.dependencies import get_current_user_optional

        return get_current_user_optional()
    except Exception:
        return None


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
    summary="Agent SSE endpoint",
    response_class=StreamingResponse,
)
async def create_agent_session(
    agent_request: AgentRequest,
    current_user=Depends(_get_current_user_optional),
    agent_service=Depends(get_agent_service),
    sandbox_service=Depends(get_sandbox_service),
):
    async def event_stream():
        try:
            table_service = None
            if agent_request.table_id and current_user:
                from src.table.dependencies import get_table_service

                table_service = get_table_service()
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
