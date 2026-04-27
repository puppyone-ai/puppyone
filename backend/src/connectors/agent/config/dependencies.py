"""
Agent Config Dependencies

FastAPI dependency injection.
"""

from fastapi import Depends, HTTPException, Query, status

from src.connectors.agent.config.service import AgentConfigService
from src.connectors.agent.config.repository import AgentRepository
from src.connectors.agent.config.models import Agent
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService


_AGENT_NOT_FOUND = "Agent not found"


def get_agent_repository() -> AgentRepository:
    """Get AgentRepository instance."""
    return AgentRepository()


def get_agent_config_service(
    repo: AgentRepository = Depends(get_agent_repository),
) -> AgentConfigService:
    """Get AgentConfigService instance."""
    return AgentConfigService(repository=repo)


def require_project_membership_query(
    project_id: str = Query(..., description="Project ID (required)"),
    current_user: CurrentUser = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> str:
    """
    SECURITY (C-2): Verify the current user is a member of the project
    given via query parameter. Returns the project_id on success.

    Without this check, any authenticated user could call
    /agent-config/?project_id=<other-project> and read agents (including
    sensitive system_prompt config) from a project they don't belong to.
    """
    role = project_service.verify_project_access(project_id, current_user.user_id)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this project",
        )
    return project_id


def require_project_membership_body(
    project_id: str,
    current_user: CurrentUser,
    project_service: ProjectService,
) -> str:
    """Helper for routers that need to verify project_id taken from a request body.

    Not a Depends — call directly inside the handler after extracting project_id
    from the validated payload.
    """
    role = project_service.verify_project_access(project_id, current_user.user_id)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this project",
        )
    return project_id


def get_verified_agent(
    agent_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
) -> Agent:
    """
    Verify and get an Agent.

    Raises 404 or 403 if the Agent does not exist or the user lacks permission.
    Access is verified via project_id (Agents are bound to Projects, not Users).
    """
    agent = service.get_agent(agent_id)
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=_AGENT_NOT_FOUND,
        )
    # Verify user access via the project table
    if not service.verify_access(agent_id, current_user.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this agent",
        )
    return agent


