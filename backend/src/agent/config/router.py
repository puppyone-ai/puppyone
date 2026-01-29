"""
Agent Config Router

Agent 配置的 REST API
"""

import asyncio
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks

from src.agent.config.service import AgentConfigService
from src.scheduler.service import get_scheduler_service
from src.scheduler.config import scheduler_settings
from src.utils.logger import log_info, log_error
from src.agent.config.dependencies import (
    get_agent_config_service,
    get_verified_agent,
)
from src.agent.config.models import Agent
from src.agent.config.schemas import (
    AgentCreate,
    AgentUpdate,
    AgentOut,
    AgentAccessCreate,
    AgentAccessUpdate,
    AgentAccessOut,
)
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse

router = APIRouter(
    prefix="/agent-config",
    tags=["agent-config"],
    responses={
        404: {"description": "资源未找到"},
        403: {"description": "无权限访问"},
        500: {"description": "服务器内部错误"},
    },
)


def _to_agent_out(agent: Agent) -> AgentOut:
    """转换 Agent 为 AgentOut"""
    return AgentOut(
        id=agent.id,
        name=agent.name,
        icon=agent.icon,
        type=agent.type,
        description=agent.description,
        is_default=agent.is_default,
        mcp_api_key=agent.mcp_api_key,
        # Schedule Agent 新字段
        trigger_type=agent.trigger_type,
        trigger_config=agent.trigger_config,
        task_content=agent.task_content,
        task_node_id=agent.task_node_id,
        external_config=agent.external_config,
        created_at=agent.created_at.isoformat(),
        updated_at=agent.updated_at.isoformat(),
        accesses=[
            AgentAccessOut(
                id=a.id,
                agent_id=a.agent_id,
                node_id=a.node_id,
                terminal=a.terminal,
                terminal_readonly=a.terminal_readonly,
                can_read=a.can_read,
                can_write=a.can_write,
                can_delete=a.can_delete,
                json_path=a.json_path,
            )
            for a in agent.accesses
        ],
    )


# ============================================
# Agent CRUD
# ============================================

@router.get(
    "/",
    response_model=ApiResponse[List[AgentOut]],
    summary="获取 Agent 列表",
    description="获取当前用户的所有 Agent",
)
def list_agents(
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
):
    agents = service.list_agents(current_user.user_id)
    return ApiResponse.success(
        data=[_to_agent_out(a) for a in agents],
        message="Agent 列表获取成功",
    )


@router.get(
    "/default",
    response_model=ApiResponse[AgentOut],
    summary="获取默认 Agent",
    description="获取当前用户的默认 Agent",
)
def get_default_agent(
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
):
    agent = service.get_default_agent(current_user.user_id)
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No default agent found",
        )
    return ApiResponse.success(
        data=_to_agent_out(agent),
        message="默认 Agent 获取成功",
    )


@router.get(
    "/{agent_id}",
    response_model=ApiResponse[AgentOut],
    summary="获取 Agent 详情",
    description="根据 ID 获取 Agent 详情",
)
def get_agent(
    agent: Agent = Depends(get_verified_agent),
):
    return ApiResponse.success(
        data=_to_agent_out(agent),
        message="Agent 获取成功",
    )


def _sync_scheduler_add(agent_id: str, agent_type: str, trigger_type: str, trigger_config: dict, agent_name: str):
    """Background task to add agent to scheduler."""
    if not scheduler_settings.enabled:
        return
    if agent_type != "schedule" or trigger_type != "cron":
        return
    
    try:
        scheduler = get_scheduler_service()
        # Run async method in a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(
                scheduler.add_agent_job(agent_id, trigger_config or {}, agent_name)
            )
        finally:
            loop.close()
        log_info(f"✅ Scheduler synced: added job for agent {agent_id}")
    except Exception as e:
        log_error(f"❌ Failed to sync scheduler for agent {agent_id}: {e}")


def _sync_scheduler_remove(agent_id: str):
    """Background task to remove agent from scheduler."""
    if not scheduler_settings.enabled:
        return
    
    try:
        scheduler = get_scheduler_service()
        scheduler.remove_agent_job(agent_id)
        log_info(f"✅ Scheduler synced: removed job for agent {agent_id}")
    except Exception as e:
        log_error(f"❌ Failed to remove scheduler job for agent {agent_id}: {e}")


@router.post(
    "/",
    response_model=ApiResponse[AgentOut],
    summary="创建 Agent",
    description="创建新的 Agent",
    status_code=status.HTTP_201_CREATED,
)
def create_agent(
    payload: AgentCreate,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
):
    agent = service.create_agent(
        user_id=current_user.user_id,
        name=payload.name,
        icon=payload.icon,
        type=payload.type,
        description=payload.description,
        is_default=False,
        accesses=payload.accesses,
        # Schedule Agent 新字段
        trigger_type=payload.trigger_type,
        trigger_config=payload.trigger_config,
        task_content=payload.task_content,
        task_node_id=payload.task_node_id,
        external_config=payload.external_config,
    )
    
    # Sync with scheduler if this is a schedule agent
    background_tasks.add_task(
        _sync_scheduler_add,
        agent.id,
        payload.type,
        payload.trigger_type or "manual",
        payload.trigger_config or {},
        payload.name,
    )
    
    return ApiResponse.success(
        data=_to_agent_out(agent),
        message="Agent 创建成功",
    )


@router.put(
    "/{agent_id}",
    response_model=ApiResponse[AgentOut],
    summary="更新 Agent",
    description="更新 Agent 信息",
)
def update_agent(
    payload: AgentUpdate,
    background_tasks: BackgroundTasks,
    agent: Agent = Depends(get_verified_agent),
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
):
    updated = service.update_agent(
        agent_id=agent.id,
        user_id=current_user.user_id,
        name=payload.name,
        icon=payload.icon,
        type=payload.type,
        description=payload.description,
        is_default=payload.is_default,
        # Schedule Agent 新字段
        trigger_type=payload.trigger_type,
        trigger_config=payload.trigger_config,
        task_content=payload.task_content,
        task_node_id=payload.task_node_id,
        external_config=payload.external_config,
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update agent",
        )
    
    # Sync with scheduler
    new_type = payload.type or agent.type
    new_trigger_type = payload.trigger_type or agent.trigger_type or "manual"
    new_trigger_config = payload.trigger_config if payload.trigger_config is not None else (agent.trigger_config or {})
    
    if new_type == "schedule" and new_trigger_type == "cron":
        # Add/update job
        background_tasks.add_task(
            _sync_scheduler_add,
            agent.id,
            new_type,
            new_trigger_type,
            new_trigger_config,
            payload.name or agent.name,
        )
    else:
        # Remove job if agent is no longer a schedule agent
        background_tasks.add_task(_sync_scheduler_remove, agent.id)
    
    return ApiResponse.success(
        data=_to_agent_out(updated),
        message="Agent 更新成功",
    )


@router.delete(
    "/{agent_id}",
    response_model=ApiResponse[None],
    summary="删除 Agent",
    description="删除 Agent 及其所有访问权限",
)
def delete_agent(
    background_tasks: BackgroundTasks,
    agent: Agent = Depends(get_verified_agent),
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
):
    agent_id = agent.id
    success = service.delete_agent(agent_id, current_user.user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete agent",
        )
    
    # Remove from scheduler
    background_tasks.add_task(_sync_scheduler_remove, agent_id)
    
    return ApiResponse.success(message="Agent 删除成功")


# ============================================
# AgentAccess CRUD
# ============================================

@router.post(
    "/{agent_id}/accesses",
    response_model=ApiResponse[AgentAccessOut],
    summary="添加访问权限",
    description="为 Agent 添加一个新的访问权限",
    status_code=status.HTTP_201_CREATED,
)
def add_access(
    payload: AgentAccessCreate,
    agent: Agent = Depends(get_verified_agent),
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
):
    access = service.add_access(
        agent_id=agent.id,
        user_id=current_user.user_id,
        node_id=payload.node_id,
        terminal=payload.terminal,
        terminal_readonly=payload.terminal_readonly,
        can_read=payload.can_read,
        can_write=payload.can_write,
        can_delete=payload.can_delete,
        json_path=payload.json_path,
    )
    if not access:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add access",
        )
    return ApiResponse.success(
        data=AgentAccessOut(
            id=access.id,
            agent_id=access.agent_id,
            node_id=access.node_id,
            terminal=access.terminal,
            terminal_readonly=access.terminal_readonly,
            can_read=access.can_read,
            can_write=access.can_write,
            can_delete=access.can_delete,
            json_path=access.json_path,
        ),
        message="访问权限添加成功",
    )


@router.put(
    "/{agent_id}/accesses/{access_id}",
    response_model=ApiResponse[AgentAccessOut],
    summary="更新访问权限",
    description="更新 Agent 的访问权限",
)
def update_access(
    access_id: str,
    payload: AgentAccessUpdate,
    agent: Agent = Depends(get_verified_agent),
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
):
    access = service.update_access(
        access_id=access_id,
        user_id=current_user.user_id,
        terminal=payload.terminal,
        terminal_readonly=payload.terminal_readonly,
        can_read=payload.can_read,
        can_write=payload.can_write,
        can_delete=payload.can_delete,
        json_path=payload.json_path,
    )
    if not access:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access not found or not authorized",
        )
    return ApiResponse.success(
        data=AgentAccessOut(
            id=access.id,
            agent_id=access.agent_id,
            node_id=access.node_id,
            terminal=access.terminal,
            terminal_readonly=access.terminal_readonly,
            can_read=access.can_read,
            can_write=access.can_write,
            can_delete=access.can_delete,
            json_path=access.json_path,
        ),
        message="访问权限更新成功",
    )


@router.delete(
    "/{agent_id}/accesses/{access_id}",
    response_model=ApiResponse[None],
    summary="删除访问权限",
    description="删除 Agent 的单个访问权限",
)
def remove_access(
    access_id: str,
    agent: Agent = Depends(get_verified_agent),
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
):
    success = service.remove_access(access_id, current_user.user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access not found or not authorized",
        )
    return ApiResponse.success(message="访问权限删除成功")


# ============================================
# Execution History
# ============================================

@router.get(
    "/{agent_id}/executions",
    response_model=ApiResponse[List[dict]],
    summary="获取执行历史",
    description="获取 Agent 的执行历史记录",
)
def get_execution_history(
    agent: Agent = Depends(get_verified_agent),
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
    limit: int = 10,
):
    executions = service.get_execution_history(agent.id, limit)
    return ApiResponse.success(
        data=executions,
        message="执行历史获取成功",
    )


@router.put(
    "/{agent_id}/accesses",
    response_model=ApiResponse[List[AgentAccessOut]],
    summary="同步访问权限",
    description="全量替换 Agent 的所有访问权限",
)
def sync_accesses(
    accesses: List[AgentAccessCreate],
    agent: Agent = Depends(get_verified_agent),
    current_user: CurrentUser = Depends(get_current_user),
    service: AgentConfigService = Depends(get_agent_config_service),
):
    result = service.sync_accesses(
        agent_id=agent.id,
        user_id=current_user.user_id,
        accesses=accesses,
    )
    return ApiResponse.success(
        data=[
            AgentAccessOut(
                id=a.id,
                agent_id=a.agent_id,
                node_id=a.node_id,
                terminal=a.terminal,
                terminal_readonly=a.terminal_readonly,
                can_read=a.can_read,
                can_write=a.can_write,
                can_delete=a.can_delete,
                json_path=a.json_path,
            )
            for a in result
        ],
        message="访问权限同步成功",
    )

