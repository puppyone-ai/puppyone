"""
ETL API Router

FastAPI routes for ETL operations.
"""

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.etl.config import etl_config
from src.etl.dependencies import get_etl_service, get_rule_repository
from src.etl.exceptions import ETLError, RuleNotFoundError
from src.etl.rules.repository import RuleRepository
from src.etl.rules.schemas import RuleCreateRequest
from src.etl.schemas import (
    ETLHealthResponse,
    ETLRuleCreateRequest,
    ETLRuleListResponse,
    ETLRuleResponse,
    ETLSubmitRequest,
    ETLSubmitResponse,
    ETLTaskListResponse,
    ETLTaskResponse,
)
from src.etl.service import ETLService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/etl", tags=["etl"])


@router.post("/submit", response_model=ETLSubmitResponse)
async def submit_etl_task(
    request: ETLSubmitRequest,
    etl_service: Annotated[ETLService, Depends(get_etl_service)],
):
    """
    Submit an ETL task for processing.

    Args:
        request: ETL task submission request
        etl_service: ETL service dependency

    Returns:
        ETLSubmitResponse with task ID and status

    Raises:
        HTTPException: If rule not found or submission fails
    """
    try:
        task = await etl_service.submit_etl_task(
            user_id=request.user_id,
            project_id=request.project_id,
            filename=request.filename,
            rule_id=request.rule_id,
        )

        logger.info(f"ETL task submitted: {task.task_id}")

        return ETLSubmitResponse(
            task_id=task.task_id,
            status=task.status,
            message="Task submitted successfully",
        )

    except RuleNotFoundError as e:
        logger.error(f"Rule not found: {e.rule_id}")
        raise HTTPException(status_code=404, detail=str(e))

    except ETLError as e:
        logger.error(f"ETL error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tasks/{task_id}", response_model=ETLTaskResponse)
async def get_etl_task_status(
    task_id: str,
    etl_service: Annotated[ETLService, Depends(get_etl_service)],
):
    """
    Get status of an ETL task.

    Args:
        task_id: Task ID to query
        etl_service: ETL service dependency

    Returns:
        ETLTaskResponse with task details

    Raises:
        HTTPException: If task not found
    """
    task = await etl_service.get_task_status(task_id)

    if not task:
        logger.warning(f"Task not found: {task_id}")
        raise HTTPException(status_code=404, detail="Task not found")

    return ETLTaskResponse(
        task_id=task.task_id,
        user_id=task.user_id,
        project_id=task.project_id,
        filename=task.filename,
        rule_id=task.rule_id,
        status=task.status,
        progress=task.progress,
        created_at=task.created_at,
        updated_at=task.updated_at,
        result=task.result.model_dump() if task.result else None,
        error=task.error,
        metadata=task.metadata,
    )


@router.get("/tasks", response_model=ETLTaskListResponse)
async def list_etl_tasks(
    etl_service: Annotated[ETLService, Depends(get_etl_service)],
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=100, description="Maximum number of tasks"),
    offset: int = Query(0, ge=0, description="Number of tasks to skip"),
):
    """
    List ETL tasks with optional filters.

    Args:
        user_id: Optional user ID filter
        project_id: Optional project ID filter
        status: Optional status filter
        limit: Maximum number of tasks to return
        offset: Number of tasks to skip
        etl_service: ETL service dependency

    Returns:
        ETLTaskListResponse with task list
    """
    tasks = await etl_service.list_tasks(
        user_id=user_id,
        project_id=project_id,
        status=status,
    )

    # Apply pagination
    total = len(tasks)
    paginated_tasks = tasks[offset:offset + limit]

    task_responses = [
        ETLTaskResponse(
            task_id=task.task_id,
            user_id=task.user_id,
            project_id=task.project_id,
            filename=task.filename,
            rule_id=task.rule_id,
            status=task.status,
            progress=task.progress,
            created_at=task.created_at,
            updated_at=task.updated_at,
            result=task.result.model_dump() if task.result else None,
            error=task.error,
            metadata=task.metadata,
        )
        for task in paginated_tasks
    ]

    return ETLTaskListResponse(
        tasks=task_responses,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/rules", response_model=ETLRuleListResponse)
async def list_etl_rules(
    rule_repository: Annotated[RuleRepository, Depends(get_rule_repository)],
    limit: int = Query(50, ge=1, le=100, description="Maximum number of rules"),
    offset: int = Query(0, ge=0, description="Number of rules to skip"),
):
    """
    List all ETL rules.

    Args:
        limit: Maximum number of rules to return
        offset: Number of rules to skip
        rule_repository: Rule repository dependency

    Returns:
        ETLRuleListResponse with rule list
    """
    rules = rule_repository.list_rules(limit=limit, offset=offset)
    total = rule_repository.count_rules()

    rule_responses = [
        ETLRuleResponse(
            rule_id=rule.rule_id,
            name=rule.name,
            description=rule.description,
            json_schema=rule.json_schema,
            system_prompt=rule.system_prompt,
            created_at=rule.created_at,
            updated_at=rule.updated_at,
        )
        for rule in rules
    ]

    return ETLRuleListResponse(
        rules=rule_responses,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/rules", response_model=ETLRuleResponse, status_code=201)
async def create_etl_rule(
    request: ETLRuleCreateRequest,
    rule_repository: Annotated[RuleRepository, Depends(get_rule_repository)],
):
    """
    Create a new ETL rule.

    Args:
        request: Rule creation request
        rule_repository: Rule repository dependency

    Returns:
        ETLRuleResponse with created rule details
    """
    try:
        rule_create = RuleCreateRequest(
            name=request.name,
            description=request.description,
            json_schema=request.json_schema,
            system_prompt=request.system_prompt,
        )

        rule = rule_repository.create_rule(rule_create)

        logger.info(f"ETL rule created: {rule.rule_id}")

        return ETLRuleResponse(
            rule_id=rule.rule_id,
            name=rule.name,
            description=rule.description,
            json_schema=rule.json_schema,
            system_prompt=rule.system_prompt,
            created_at=rule.created_at,
            updated_at=rule.updated_at,
        )

    except Exception as e:
        logger.error(f"Error creating rule: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rules/{rule_id}", response_model=ETLRuleResponse)
async def get_etl_rule(
    rule_id: str,
    rule_repository: Annotated[RuleRepository, Depends(get_rule_repository)],
):
    """
    Get an ETL rule by ID.

    Args:
        rule_id: Rule ID to query
        rule_repository: Rule repository dependency

    Returns:
        ETLRuleResponse with rule details

    Raises:
        HTTPException: If rule not found
    """
    rule = rule_repository.get_rule(rule_id)

    if not rule:
        logger.warning(f"Rule not found: {rule_id}")
        raise HTTPException(status_code=404, detail="Rule not found")

    return ETLRuleResponse(
        rule_id=rule.rule_id,
        name=rule.name,
        description=rule.description,
        json_schema=rule.json_schema,
        system_prompt=rule.system_prompt,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_etl_rule(
    rule_id: str,
    rule_repository: Annotated[RuleRepository, Depends(get_rule_repository)],
):
    """
    Delete an ETL rule.

    Args:
        rule_id: Rule ID to delete
        rule_repository: Rule repository dependency

    Raises:
        HTTPException: If rule not found
    """
    success = rule_repository.delete_rule(rule_id)

    if not success:
        logger.warning(f"Rule not found for deletion: {rule_id}")
        raise HTTPException(status_code=404, detail="Rule not found")

    logger.info(f"ETL rule deleted: {rule_id}")


@router.get("/health", response_model=ETLHealthResponse)
async def get_etl_health(
    etl_service: Annotated[ETLService, Depends(get_etl_service)],
):
    """
    Get ETL service health status.

    Args:
        etl_service: ETL service dependency

    Returns:
        ETLHealthResponse with service status
    """
    return ETLHealthResponse(
        status="healthy",
        queue_size=etl_service.get_queue_size(),
        task_count=etl_service.get_task_count(),
        worker_count=etl_config.etl_worker_count,
    )

