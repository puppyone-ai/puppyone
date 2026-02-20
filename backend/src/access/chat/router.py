import json
from fastapi import APIRouter, Depends
from src.access.chat.agent_schemas import AgentRequest
from src.access.chat.agent_dependencies import get_agent_service
from src.sandbox.dependencies import get_sandbox_service
from src.access.chat.dependencies import get_chat_service
from src.auth.dependencies import get_current_user_optional
from src.content_node.dependencies import get_content_node_service
from src.tool.dependencies import get_tool_service
from src.s3.dependencies import get_s3_service
from src.access.config.dependencies import get_agent_config_service
from src.search.dependencies import get_search_service
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
    summary="Agent SSE endpoint",
    response_class=StreamingResponse,
)
async def create_agent_session(
    agent_request: AgentRequest,
    current_user=Depends(get_current_user_optional),
    agent_service=Depends(get_agent_service),
    sandbox_service=Depends(get_sandbox_service),
    chat_service=Depends(get_chat_service),
    node_service=Depends(get_content_node_service),
    tool_service=Depends(get_tool_service),
    s3_service=Depends(get_s3_service),
    agent_config_service=Depends(get_agent_config_service),
    search_service=Depends(get_search_service),
):
    async def event_stream():
        try:
            async for event in agent_service.stream_events(
                request=agent_request,
                current_user=current_user,
                node_service=node_service,
                tool_service=tool_service,
                sandbox_service=sandbox_service,
                chat_service=chat_service,
                s3_service=s3_service,
                agent_config_service=agent_config_service,
                search_service=search_service,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
