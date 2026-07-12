import json
from fastapi import APIRouter, Depends, HTTPException, status
from src.connectors.agent.schemas import AgentRequest
from src.connectors.agent.dependencies import get_agent_service
from src.platform.scope_sandbox.execution.dependencies import get_sandbox_service
from src.connectors.agent.chat.dependencies import get_chat_service
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.authorization.dependencies import get_authorization_service
from src.platform.authorization.models import ProjectAction
from src.platform.authorization.service import AuthorizationService
from src.platform.project.readiness import ProjectReadinessService
from src.tool.dependencies import get_tool_service
from src.infra.s3.dependencies import get_s3_service
from src.connectors.agent.config.dependencies import get_agent_config_service
from src.infra.search.dependencies import get_search_service
from src.version_engine.bootstrap.dependencies import get_product_operation_adapter
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
from fastapi.responses import StreamingResponse


router = APIRouter(
    prefix="/agents",
    tags=["agents"],
    responses={
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"},
    },
)


@router.post(
    "",
    summary="Agent SSE endpoint",
    response_class=StreamingResponse,
)
async def create_agent_session(
    agent_request: AgentRequest,
    current_user: CurrentUser = Depends(get_current_user),
    authorization: AuthorizationService = Depends(get_authorization_service),
    agent_service=Depends(get_agent_service),
    sandbox_service=Depends(get_sandbox_service),
    chat_service=Depends(get_chat_service),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
    tool_service=Depends(get_tool_service),
    s3_service=Depends(get_s3_service),
    agent_config_service=Depends(get_agent_config_service),
    search_service=Depends(get_search_service),
):
    if not agent_request.agent_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="agent_id is required for a Project Agent run",
        )
    project_id = agent_config_service.get_agent_project_id(agent_request.agent_id)
    if project_id is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    authorization.authorize(
        project_id, current_user.user_id, ProjectAction.AGENT_RUN
    )
    if not agent_config_service.is_visible_to(
        agent_request.agent_id, current_user.user_id
    ):
        raise HTTPException(status_code=404, detail="Agent not found")
    readiness = ProjectReadinessService().resolve(project_id)
    if not readiness.claude_ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "project_agent_not_ready",
                "git_state": readiness.git_state,
                "blockers": readiness.blockers,
            },
        )

    async def event_stream():
        try:
            async for event in agent_service.stream_events(
                request=agent_request,
                current_user=current_user,
                ops=ops,
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
