"""
Agent Config Dependencies

FastAPI dependency injection.
"""

from fastapi import Depends, HTTPException, status

from src.connectors.agent.config.service import AgentConfigService
from src.connectors.agent.config.repository import AgentRepository
from src.connectors.agent.config.models import Agent
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser


_AGENT_NOT_FOUND = "Agent not found"


def get_agent_repository() -> AgentRepository:
    """Get AgentRepository instance."""
    return AgentRepository()


def get_agent_config_service(
    repo: AgentRepository = Depends(get_agent_repository),
) -> AgentConfigService:
    """Get AgentConfigService instance."""
    return AgentConfigService(repository=repo)


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


