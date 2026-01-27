"""
ETL API Router

FastAPI routes for ETL operations.
"""

import base64
import hashlib
import logging
import os
import uuid
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from src.etl.config import etl_config
from src.etl.dependencies import get_etl_service, get_verified_etl_task
from src.etl.exceptions import RuleNotFoundError
from src.s3.exceptions import S3Error, S3FileSizeExceededError
from src.etl.rules.dependencies import get_rule_repository
from src.etl.rules.repository_supabase import RuleRepositorySupabase
from src.etl.rules.schemas import RuleCreateRequest
from src.etl.tasks.models import ETLTask
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.project.dependencies import get_project_service
from src.project.service import ProjectService
from src.etl.schemas import (
    BatchETLTaskStatusResponse,
    ETLHealthResponse,
    ETLRuleCreateRequest,
    ETLRuleListResponse,
    ETLRuleResponse,
    ETLCancelResponse,
    ETLRetryRequest,
    ETLRetryResponse,
    ETLTaskListResponse,
    ETLTaskResponse,
    UploadAndSubmitItem,
    UploadAndSubmitResponse,
)
from src.etl.service import ETLService
from src.etl.tasks.models import ETLTaskStatus
from src.s3.dependencies import get_s3_service
from src.s3.service import S3Service
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/etl", tags=["etl"])


@router.post(
    "/upload_and_submit", response_model=UploadAndSubmitResponse, status_code=201
)
async def upload_and_submit(
    project_id: str = Form(..., description="Project ID (UUID)"),
    files: list[UploadFile] = File(
        ..., description="Files to upload (single or multiple)"
    ),
    rule_id: Optional[int] = Form(None, description="Optional ETL rule id"),
    node_id: Optional[str] = Form(
        None, description="Optional target node id to mount results (UUID)"
    ),
    json_path: Optional[str] = Form(
        None, description="Optional JSON Pointer mount path (default: root)"
    ),
    etl_service: Annotated[ETLService, Depends(get_etl_service)] = None,
    s3_service: Annotated[S3Service, Depends(get_s3_service)] = None,
    node_service: Annotated[ContentNodeService, Depends(get_content_node_service)] = None,
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Upload raw files and submit ETL tasks in one call.

    - This endpoint replaces legacy /etl/upload, /etl/submit, and project import-folder.
    - If upload fails, the system still creates a pollable task_id with status=failed.
    """
    # Access checks
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(status_code=404, detail="Project not found")

    if node_id is not None:
        # Ensure target node exists and belongs to current user (404 on not found / no access)
        node = node_service.get_by_id(node_id, current_user.user_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

    mount_json_path = json_path or ""
    items: list[UploadAndSubmitItem] = []

    for f in files:
        original_filename = f.filename or "file"
        original_basename = Path(original_filename).name

        # Generate safe S3 key (avoid special chars / paths in filename)
        _, ext = os.path.splitext(original_basename)
        safe_filename = f"{uuid.uuid4()}{ext}"
        s3_key = f"users/{current_user.user_id}/raw/{project_id}/{safe_filename}"

        # Upload first; even if upload fails we must create a failed task_id
        try:
            content = await f.read()
            original_filename_b64 = base64.b64encode(
                original_filename.encode("utf-8")
            ).decode("ascii")
            await s3_service.upload_file(
                key=s3_key,
                content=content,
                content_type=f.content_type,
                metadata={
                    "original_filename_b64": original_filename_b64,
                    "project_id": str(project_id),
                },
            )
        except S3FileSizeExceededError as e:
            task = await etl_service.create_failed_task(
                user_id=current_user.user_id,
                project_id=project_id,
                filename=original_filename,
                rule_id=rule_id,
                error=str(e),
                metadata={
                    "error_stage": "upload",
                    "max_size": getattr(e, "max_size", None),
                    "filename": original_filename,
                },
            )
            items.append(
                UploadAndSubmitItem(
                    filename=original_filename,
                    task_id=task.task_id or 0,
                    status=ETLTaskStatus.FAILED,
                    s3_key=None,
                    error=str(e),
                )
            )
            continue
        except S3Error as e:
            task = await etl_service.create_failed_task(
                user_id=current_user.user_id,
                project_id=project_id,
                filename=original_filename,
                rule_id=rule_id,
                error=str(e),
                metadata={"error_stage": "upload", "filename": original_filename},
            )
            items.append(
                UploadAndSubmitItem(
                    filename=original_filename,
                    task_id=task.task_id or 0,
                    status=ETLTaskStatus.FAILED,
                    s3_key=None,
                    error=str(e),
                )
            )
            continue
        except Exception as e:
            task = await etl_service.create_failed_task(
                user_id=current_user.user_id,
                project_id=project_id,
                filename=original_filename,
                rule_id=rule_id,
                error=f"Upload failed: {e}",
                metadata={"error_stage": "upload", "filename": original_filename},
            )
            items.append(
                UploadAndSubmitItem(
                    filename=original_filename,
                    task_id=task.task_id or 0,
                    status=ETLTaskStatus.FAILED,
                    s3_key=None,
                    error=f"Upload failed: {e}",
                )
            )
            continue

        # Submit task
        try:
            task = await etl_service.submit_etl_task(
                user_id=current_user.user_id,
                project_id=project_id,
                filename=original_filename,
                rule_id=rule_id,
                s3_key=s3_key,
            )
        except RuleNotFoundError as e:
            # Treat as failed (pollable), since upload already succeeded
            task = await etl_service.create_failed_task(
                user_id=current_user.user_id,
                project_id=project_id,
                filename=original_filename,
                rule_id=rule_id,
                error=str(e),
                metadata={"error_stage": "submit", "s3_key": s3_key},
            )
            items.append(
                UploadAndSubmitItem(
                    filename=original_filename,
                    task_id=task.task_id or 0,
                    status=ETLTaskStatus.FAILED,
                    s3_key=s3_key,
                    error=str(e),
                )
            )
            continue

        # Persist mount plan into task.metadata (worker will execute it)
        suffix = hashlib.sha1(s3_key.encode("utf-8")).hexdigest()
        mount_key = f"{original_basename}-{suffix[:8]}"

        task.metadata["mount_key"] = mount_key
        task.metadata["mount_json_path"] = mount_json_path
        if node_id is not None:
            task.metadata["mount_node_id"] = node_id
        else:
            task.metadata["auto_node_name"] = suffix[:10]
            task.metadata["auto_create_node"] = True

        # Ensure s3_key is persisted (submit already sets it, but keep explicit)
        task.metadata["s3_key"] = s3_key
        etl_service.task_repository.update_task(task)

        items.append(
            UploadAndSubmitItem(
                filename=original_filename,
                task_id=task.task_id or 0,
                status=task.status,
                s3_key=s3_key,
                error=None,
            )
        )

    return UploadAndSubmitResponse(items=items, total=len(items))


@router.post("/tasks/{task_id}/cancel", response_model=ETLCancelResponse)
async def cancel_etl_task(
    task_id: int,
    etl_service: Annotated[ETLService, Depends(get_etl_service)],
    current_user: CurrentUser = Depends(get_current_user),
    force: bool = Query(
        False,
        description="Force cancel even if task is running. Use with caution: it marks task as cancelled but cannot interrupt external providers immediately.",
    ),
):
    """
    Cancel a queued/pending ETL task. Running tasks cannot be cancelled.
    """
    try:
        task = await etl_service.cancel_task(
            task_id=task_id, user_id=current_user.user_id, force=force
        )
        return ETLCancelResponse(
            task_id=task.task_id,
            status=task.status,
            message="Task cancelled successfully",
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error(f"Cancel task failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tasks/{task_id}/retry", response_model=ETLRetryResponse)
async def retry_etl_task(
    task_id: int,
    request: ETLRetryRequest,
    etl_service: Annotated[ETLService, Depends(get_etl_service)],
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Retry an ETL task from a given stage: mineru|postprocess.
    """
    try:
        task = await etl_service.retry_task(
            task_id=task_id,
            user_id=current_user.user_id,
            from_stage=request.from_stage,
        )
        return ETLRetryResponse(
            task_id=task.task_id,
            status=task.status,
            message="Task retried successfully",
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error(f"Retry task failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tasks/batch", response_model=BatchETLTaskStatusResponse)
async def get_batch_etl_tasks(
    task_ids: str = Query(..., description="逗号分隔的任务ID列表，如：1,2,3"),
    etl_service: ETLService = Depends(get_etl_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    批量查询 ETL 任务状态。

    Args:
        task_ids: 逗号分隔的任务ID列表
        etl_service: ETL service dependency
        current_user: Current user (from token)

    Returns:
        BatchETLTaskStatusResponse with all task statuses

    Raises:
        HTTPException: If task_ids format is invalid
    """
    try:
        # Parse task IDs
        id_list = [int(tid.strip()) for tid in task_ids.split(",") if tid.strip()]

        if not id_list:
            raise HTTPException(status_code=400, detail="No valid task IDs provided")

        if len(id_list) > 100:
            raise HTTPException(status_code=400, detail="Too many task IDs (max 100)")

        # Get task statuses
        task_responses = []
        for task_id in id_list:
            try:
                task = await etl_service.get_task_status_with_access_check(
                    task_id=task_id, user_id=current_user.user_id
                )

                task_responses.append(
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
                )
            except Exception as e:
                # If task not found or access denied, skip it
                logger.warning(f"Failed to get task {task_id}: {e}")
                continue

        return BatchETLTaskStatusResponse(
            tasks=task_responses, total=len(task_responses)
        )

    except ValueError as e:
        raise HTTPException(
            status_code=400, detail=f"Invalid task_ids format: {str(e)}"
        )


@router.get("/tasks/{task_id}", response_model=ETLTaskResponse)
async def get_etl_task_status(
    task: ETLTask = Depends(get_verified_etl_task),
):
    """
    Get status of an ETL task.

    Args:
        task: Verified ETL task (from dependency injection)

    Returns:
        ETLTaskResponse with task details

    Raises:
        HTTPException: If task not found
    """

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
    current_user: CurrentUser = Depends(get_current_user),
    project_id: Optional[int] = Query(None, description="Filter by project ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=100, description="Maximum number of tasks"),
    offset: int = Query(0, ge=0, description="Number of tasks to skip"),
):
    """
    List ETL tasks with optional filters.

    Args:
        etl_service: ETL service dependency
        current_user: Current user (from token)
        project_id: Optional project ID filter
        status: Optional status filter
        limit: Maximum number of tasks to return
        offset: Number of tasks to skip

    Returns:
        ETLTaskListResponse with task list
    """
    status_enum = None
    if status:
        try:
            status_enum = ETLTaskStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    tasks = await etl_service.list_tasks(
        user_id=current_user.user_id,
        project_id=project_id,
        status=status_enum,
    )

    # Apply pagination
    total = len(tasks)
    paginated_tasks = tasks[offset : offset + limit]

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
    rule_repository: Annotated[RuleRepositorySupabase, Depends(get_rule_repository)],
    limit: int = Query(50, ge=1, le=100, description="Maximum number of rules"),
    offset: int = Query(0, ge=0, description="Number of rules to skip"),
):
    """
    List all ETL rules for current user.

    Args:
        limit: Maximum number of rules to return
        offset: Number of rules to skip
        rule_repository: Rule repository dependency (includes user authentication)

    Returns:
        ETLRuleListResponse with rule list
    """
    # Ensure global default rule is discoverable
    try:
        from src.etl.rules.default_rules import get_or_create_default_rule

        get_or_create_default_rule(rule_repository)
    except Exception as e:
        # Non-fatal: listing still works even if default rule creation fails
        logger.warning(f"Failed to ensure global default rule: {e}")

    rules = rule_repository.list_rules(limit=limit, offset=offset)
    total = rule_repository.count_rules()

    rule_responses = [
        ETLRuleResponse(
            rule_id=rule.rule_id,
            name=rule.name,
            description=rule.description,
            json_schema=rule.json_schema,
            system_prompt=rule.system_prompt,
            postprocess_mode=getattr(rule, "postprocess_mode", None),
            postprocess_strategy=getattr(rule, "postprocess_strategy", None),
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
    rule_repository: Annotated[RuleRepositorySupabase, Depends(get_rule_repository)],
):
    """
    Create a new ETL rule for current user.

    Args:
        request: Rule creation request
        rule_repository: Rule repository dependency (includes user authentication)

    Returns:
        ETLRuleResponse with created rule details
    """
    try:
        rule_create = RuleCreateRequest(
            name=request.name,
            description=request.description,
            json_schema=request.json_schema,
            system_prompt=request.system_prompt,
            postprocess_mode=request.postprocess_mode or "llm",
            postprocess_strategy=request.postprocess_strategy,
        )

        rule = rule_repository.create_rule(rule_create)

        logger.info(f"ETL rule created: {rule.rule_id}")

        return ETLRuleResponse(
            rule_id=rule.rule_id,
            name=rule.name,
            description=rule.description,
            json_schema=rule.json_schema,
            system_prompt=rule.system_prompt,
            postprocess_mode=getattr(rule, "postprocess_mode", None),
            postprocess_strategy=getattr(rule, "postprocess_strategy", None),
            created_at=rule.created_at,
            updated_at=rule.updated_at,
        )

    except Exception as e:
        logger.error(f"Error creating rule: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rules/{rule_id}", response_model=ETLRuleResponse)
async def get_etl_rule(
    rule_id: int,
    rule_repository: Annotated[RuleRepositorySupabase, Depends(get_rule_repository)],
):
    """
    Get an ETL rule by ID for current user.

    Args:
        rule_id: Rule ID to query
        rule_repository: Rule repository dependency (includes user authentication)

    Returns:
        ETLRuleResponse with rule details

    Raises:
        HTTPException: If rule not found or access denied
    """
    rule = rule_repository.get_rule(str(rule_id))

    if not rule:
        logger.warning(f"Rule not found: {rule_id}")
        raise HTTPException(status_code=404, detail="Rule not found")

    return ETLRuleResponse(
        rule_id=rule.rule_id,
        name=rule.name,
        description=rule.description,
        json_schema=rule.json_schema,
        system_prompt=rule.system_prompt,
        postprocess_mode=getattr(rule, "postprocess_mode", None),
        postprocess_strategy=getattr(rule, "postprocess_strategy", None),
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_etl_rule(
    rule_id: int,
    rule_repository: Annotated[RuleRepositorySupabase, Depends(get_rule_repository)],
):
    """
    Delete an ETL rule for current user.

    Args:
        rule_id: Rule ID to delete
        rule_repository: Rule repository dependency (includes user authentication)

    Raises:
        HTTPException: If rule not found or access denied
    """
    success = rule_repository.delete_rule(str(rule_id))

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
