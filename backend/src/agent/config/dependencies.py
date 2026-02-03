"""
Agent Config Dependencies

FastAPI 依赖注入
"""

from fastapi import Depends, HTTPException, status

from src.agent.config.service import AgentConfigService
from src.agent.config.repository import AgentRepository
from src.agent.config.models import Agent
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser


def get_agent_repository() -> AgentRepository:
    """获取 AgentRepository 实例"""
    return AgentRepository()


def get_agent_config_service(
    repo: AgentRepository = Depends(get_agent_repository),
) -> AgentConfigService:
    """获取 AgentConfigService 实例"""
    return AgentConfigService(repository=repo)


def get_verified_agent(
    agent_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
) -> Agent:
    """
    验证并获取 Agent
    
    如果 Agent 不存在或用户无权限，抛出 404 或 403
    """
    agent = service.get_agent(agent_id)
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found",
        )
    if agent.user_id != current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this agent",
        )
    return agent



