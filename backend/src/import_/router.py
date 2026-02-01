"""
Import Router - Unified API for all imports.
"""

from fastapi import APIRouter, Depends, status, HTTPException

from src.import_.schemas import (
    ImportSubmitRequest,
    ImportSubmitResponse,
    ImportTaskResponse,
    ImportParseRequest,
    ImportParseResponse,
    ImportStatus,
)
from src.import_.service import ImportService
from src.import_.dependencies import get_import_service
from src.common_schemas import ApiResponse
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.utils.logger import log_info, log_error


router = APIRouter(
    prefix="/import",
    tags=["import"],
    responses={
        400: {"description": "Bad request"},
        401: {"description": "Unauthorized"},
        404: {"description": "Not found"},
        500: {"description": "Internal server error"},
    },
)


@router.post(
    "/submit",
    response_model=ApiResponse[ImportSubmitResponse],
    summary="Submit import task",
    description="Submit a new import task. Supports URLs (GitHub, Notion, etc.) and files.",
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_import(
    payload: ImportSubmitRequest,
    service: ImportService = Depends(get_import_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Submit an import task.
    
    The task will be processed asynchronously. Use GET /import/tasks/{task_id}
    to check status and progress.
    """
    log_info(f"Import submit: user={current_user.user_id}, project={payload.project_id}")

    try:
        task = await service.submit(
            user_id=current_user.user_id,
            project_id=payload.project_id,
            url=payload.url,
            file_key=payload.file_key,
            name=payload.name,
            etl_rule_id=payload.etl_rule_id,
            crawl_options=payload.crawl_options,
            sync_config=payload.sync_config,
        )

        import_type = ImportService.task_type_to_import_type(task.task_type)

        return ApiResponse.success(
            data=ImportSubmitResponse(
                task_id=task.id,
                status=ImportStatus.PENDING,
                import_type=import_type,
            ),
            message="Import task submitted",
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log_error(f"Import submit failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit import task")


@router.get(
    "/tasks/{task_id}",
    response_model=ApiResponse[ImportTaskResponse],
    summary="Get import task status",
    description="Get the status and progress of an import task.",
)
async def get_task(
    task_id: str,
    service: ImportService = Depends(get_import_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get import task status."""
    task = await service.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Check ownership
    if task.user_id != current_user.user_id:
        raise HTTPException(status_code=404, detail="Task not found")

    import_type = ImportService.task_type_to_import_type(task.task_type)

    return ApiResponse.success(
        data=ImportTaskResponse(
            task_id=task.id,
            status=ImportStatus(task.status.value),
            import_type=import_type,
            progress=task.progress,
            message=task.message,
            content_node_id=task.content_node_id,
            items_count=task.items_count if task.items_count else None,
            error=task.error,
            created_at=task.created_at,
            updated_at=task.updated_at,
            completed_at=task.completed_at,
        ),
        message="Task retrieved",
    )


@router.get(
    "/tasks",
    response_model=ApiResponse[list[ImportTaskResponse]],
    summary="List import tasks",
    description="List import tasks for the current user.",
)
async def list_tasks(
    project_id: str = None,
    limit: int = 50,
    service: ImportService = Depends(get_import_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List user's import tasks."""
    tasks = await service.get_user_tasks(
        user_id=current_user.user_id,
        project_id=project_id,
        limit=min(limit, 100),
    )

    responses = []
    for task in tasks:
        import_type = ImportService.task_type_to_import_type(task.task_type)
        responses.append(
            ImportTaskResponse(
                task_id=task.id,
                status=ImportStatus(task.status.value),
                import_type=import_type,
                progress=task.progress,
                message=task.message,
                content_node_id=task.content_node_id,
                items_count=task.items_count if task.items_count else None,
                error=task.error,
                created_at=task.created_at,
                updated_at=task.updated_at,
                completed_at=task.completed_at,
            )
        )

    return ApiResponse.success(data=responses, message=f"Found {len(tasks)} tasks")


@router.delete(
    "/tasks/{task_id}",
    response_model=ApiResponse[dict],
    summary="Cancel import task",
    description="Cancel a pending or processing import task.",
)
async def cancel_task(
    task_id: str,
    service: ImportService = Depends(get_import_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Cancel an import task."""
    task = await service.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.user_id != current_user.user_id:
        raise HTTPException(status_code=404, detail="Task not found")

    success = await service.cancel_task(task_id, "Cancelled by user")

    if not success:
        raise HTTPException(status_code=400, detail="Cannot cancel task")

    return ApiResponse.success(
        data={"task_id": task_id, "cancelled": True},
        message="Task cancelled",
    )


@router.post(
    "/parse",
    response_model=ApiResponse[ImportParseResponse],
    summary="Parse URL preview",
    description="Parse a URL and return preview information without importing.",
)
async def parse_url(
    payload: ImportParseRequest,
    service: ImportService = Depends(get_import_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Parse a URL for preview.
    
    Delegates to ImportService.preview_url() which routes to the appropriate handler.
    """
    log_info(f"Import parse: user={current_user.user_id}, url={payload.url}")
    
    try:
        result, import_type = await service.preview_url(
            url=payload.url,
            user_id=current_user.user_id,
            crawl_options=payload.crawl_options,
        )
        
        return ApiResponse.success(
            data=ImportParseResponse(
                url=payload.url,
                import_type=import_type,
                title=result.title,
                description=result.description,
                fields=result.fields,
                sample_data=result.data,
                total_items=result.total_items,
            ),
            message="URL parsed successfully",
        )
        
    except Exception as e:
        log_error(f"Import parse failed: {e}")
        error_msg = str(e)
        if "auth" in error_msg.lower() or "401" in error_msg or "unauthorized" in error_msg.lower():
            raise HTTPException(status_code=401, detail=error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
