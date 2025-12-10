"""
ETL API Router

FastAPI routes for ETL operations.
"""

import json
import logging
from typing import Annotated, Optional

import asyncio
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from src.etl.config import etl_config
from src.etl.dependencies import get_etl_service, get_rule_repository, get_verified_etl_task
from src.etl.exceptions import ETLError, RuleNotFoundError
from src.s3.exceptions import S3Error, S3FileSizeExceededError
from src.etl.rules.repository import RuleRepository
from src.etl.rules.schemas import RuleCreateRequest
from src.etl.tasks.models import ETLTask
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.etl.schemas import (
    ETLFileUploadResponse,
    ETLHealthResponse,
    ETLMountRequest,
    ETLMountResponse,
    ETLRuleCreateRequest,
    ETLRuleListResponse,
    ETLRuleResponse,
    ETLSubmitRequest,
    ETLSubmitResponse,
    ETLTaskListResponse,
    ETLTaskResponse,
)
from src.etl.service import ETLService
from src.etl.tasks.models import ETLTaskStatus
from src.s3.dependencies import get_s3_service
from src.s3.service import S3Service
from src.table.dependencies import get_table_service
from src.table.service import TableService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/etl", tags=["etl"])


@router.post("/submit", response_model=ETLSubmitResponse)
async def submit_etl_task(
    request: ETLSubmitRequest,
    etl_service: Annotated[ETLService, Depends(get_etl_service)],
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Submit an ETL task for processing.

    Args:
        request: ETL task submission request
        etl_service: ETL service dependency
        current_user: Current user (from token)

    Returns:
        ETLSubmitResponse with task ID and status

    Raises:
        HTTPException: If rule not found or submission fails
    """
    try:
        # 将 user_id 从 str 转换为 int（因为 ETLTask 使用 int）
        task = await etl_service.submit_etl_task(
            user_id=current_user.user_id,
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
    rule_id: int,
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
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_etl_rule(
    rule_id: int,
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
    success = rule_repository.delete_rule(str(rule_id))

    if not success:
        logger.warning(f"Rule not found for deletion: {rule_id}")
        raise HTTPException(status_code=404, detail="Rule not found")

    logger.info(f"ETL rule deleted: {rule_id}")


@router.post("/tasks/{task_id}/mount", response_model=ETLMountResponse)
async def mount_etl_result(
    task: ETLTask = Depends(get_verified_etl_task),
    request: ETLMountRequest = ...,
    s3_service: Annotated[S3Service, Depends(get_s3_service)] = None,
    table_service: Annotated[TableService, Depends(get_table_service)] = None,
):
    """
    Mount ETL result JSON to a table.

    Args:
        task: Verified ETL task (from dependency injection)
        request: Mount request with table_id and json_path
        s3_service: S3 service dependency
        table_service: Table service dependency

    Returns:
        ETLMountResponse with mount status

    Raises:
        HTTPException: If task not found, not completed, or mount fails
    """
    try:

        # Check task status
        if task.status != ETLTaskStatus.COMPLETED:
            logger.warning(
                f"Task {task.task_id} not completed (status: {task.status.value})"
            )
            raise HTTPException(
                status_code=400,
                detail=f"Task not completed. Current status: {task.status.value}",
            )

        # Get result path
        if not task.result or not task.result.output_path:
            logger.error(f"Task {task.task_id} has no result path")
            raise HTTPException(status_code=500, detail="Task result not found")

        output_path = task.result.output_path

        # Download result from S3
        logger.info(f"Downloading result from S3: {output_path}")
        download_content = await s3_service.download_file(output_path)

        if not download_content:
            logger.error(f"Failed to download result from S3: {output_path}")
            raise HTTPException(
                status_code=500, detail="Failed to download result from S3"
            )

        # Parse JSON
        try:
            result_json = json.loads(download_content.decode("utf-8"))
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse result JSON: {e}")
            raise HTTPException(status_code=500, detail="Invalid JSON in result")

        # Extract filename without extension as key
        import os

        filename_without_ext = os.path.splitext(task.filename)[0]

        # Mount to table
        logger.info(
            f"Mounting result to table {request.table_id} at path {request.json_path}"
        )

        # Prepare elements for create_context_data
        elements = [
            {
                "key": filename_without_ext,
                "content": result_json
            }
        ]

        # create_context_data is a sync method, so offload to thread
        await asyncio.to_thread(
            table_service.create_context_data,
            table_id=request.table_id,
            mounted_json_pointer_path=request.json_path,
            elements=elements,
        )


        mounted_path = (
            f"{request.json_path}/{filename_without_ext}"
            if request.json_path
            else filename_without_ext
        )

        logger.info(
            f"Successfully mounted task {task.task_id} result to table {request.table_id}"
        )

        return ETLMountResponse(
            success=True,
            message="Result mounted successfully",
            mounted_path=mounted_path,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error mounting result: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


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


@router.post("/upload", response_model=ETLFileUploadResponse, status_code=201)
async def upload_etl_file(
    project_id: int = Form(..., description="Project ID"),
    file: UploadFile = File(..., description="File to upload"),
    current_user: CurrentUser = Depends(get_current_user),
    s3_service: Annotated[S3Service, Depends(get_s3_service)] = None,
):
    """
    Upload a file to S3 for ETL processing.

    The file will be automatically uploaded to the path:
    `/users/{user_id}/raw/{project_id}/{filename}`

    Args:
        project_id: Project ID
        file: File to upload
        current_user: Current user (from token)
        s3_service: S3 service dependency

    Returns:
        ETLFileUploadResponse with upload details

    Raises:
        HTTPException: If upload fails or file size exceeds limit
    """
    try:
        # 将 user_id 从 str 转换为 int（因为 S3 key 路径使用 int）
        # Generate S3 key path
        filename = file.filename
        s3_key = f"users/{current_user.user_id}/raw/{project_id}/{filename}"

        # Read file content
        content = await file.read()

        # Upload to S3
        result = await s3_service.upload_file(
            key=s3_key,
            content=content,
            content_type=file.content_type,
        )

        logger.info(
            f"File uploaded successfully to ETL: {s3_key} ({result.size} bytes)"
        )

        return ETLFileUploadResponse(
            key=result.key,
            bucket=result.bucket,
            size=result.size,
            etag=result.etag,
            content_type=result.content_type,
        )

    except S3FileSizeExceededError as e:
        logger.error(f"File size exceeded: {e}")
        raise HTTPException(
            status_code=413,
            detail={
                "error": "PayloadTooLarge",
                "message": str(e),
                "max_size": e.max_size,
                "suggestion": "Please use multipart upload or presigned URL for large files",
            },
        )

    except S3Error as e:
        logger.error(f"S3 error during ETL file upload: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "S3Error",
                "message": f"Failed to upload file to S3: {str(e)}",
            },
        )

    except Exception as e:
        logger.error(f"Unexpected error during ETL file upload: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "InternalServerError",
                "message": f"An unexpected error occurred: {str(e)}",
            },
        )
