"""
Sync Task Router

API endpoints for sync task management.

NOTE: This router is being kept for backward compatibility.
The new architecture uses /api/v1/import/saas routes,
but existing clients may still use /api/v1/sync routes.
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse

from .dependencies import get_sync_task_service
from .models import SyncTask, SyncTaskStatus
from .schemas import (
    BatchStatusRequest,
    BatchStatusResponse,
    StartSyncRequest,
    SyncTaskResponse,
    SyncTaskStatusResponse,
    task_to_response,
    task_to_status_response,
)
from .service import SyncTaskService

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/import")
async def start_import(
    request: StartSyncRequest,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Start a new sync import task.
    
    The task runs in the background via ARQ worker. 
    Use GET /sync/task/{task_id}/status to poll for progress.
    """
    try:
        # Create task record in database
        task = await service.create_task(
            user_id=current_user.user_id,
            project_id=request.project_id,
            url=request.url,
            task_type=request.task_type,
        )

        # Enqueue task to ARQ worker (replaces BackgroundTasks)
        await service.enqueue_task(task.id, task.task_type.value)

        return ApiResponse.success(task_to_response(task))

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/task/{task_id}")
async def get_task(
    task_id: int,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get full details of a sync task."""
    task = await service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return ApiResponse.success(task_to_response(task))


@router.get("/task/{task_id}/status")
async def get_task_status(
    task_id: int,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get lightweight status of a sync task (for polling).
    
    This endpoint returns minimal data for efficient polling.
    First checks Redis runtime state, falls back to database.
    """
    # Try to get real-time state from Redis first
    runtime_state = await service.get_runtime_state(task_id)
    if runtime_state:
        # Verify ownership
        if runtime_state.user_id != current_user.user_id:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Convert runtime state to status response
        return ApiResponse.success(SyncTaskStatusResponse(
            id=runtime_state.task_id,
            status=runtime_state.status.value,
            progress=runtime_state.progress,
            progress_message=runtime_state.progress_message,
            root_node_id=runtime_state.root_node_id,
            files_total=runtime_state.files_total,
            files_processed=runtime_state.files_processed,
            bytes_total=runtime_state.bytes_total,
            bytes_downloaded=runtime_state.bytes_downloaded,
            error=runtime_state.error_message,
            is_terminal=runtime_state.status in [
                SyncTaskStatus.COMPLETED,
                SyncTaskStatus.FAILED,
                SyncTaskStatus.CANCELLED,
            ],
        ))
    
    # Fall back to database
    task = await service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return ApiResponse.success(task_to_status_response(task))


@router.post("/task/batch-status")
async def get_batch_status(
    request: BatchStatusRequest,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get status for multiple tasks at once.
    
    Useful for polling multiple active tasks efficiently.
    """
    tasks = {}
    for task_id in request.task_ids:
        # Try Redis first, then database
        runtime_state = await service.get_runtime_state(task_id)
        if runtime_state and runtime_state.user_id == current_user.user_id:
            tasks[task_id] = SyncTaskStatusResponse(
                id=runtime_state.task_id,
                status=runtime_state.status.value,
                progress=runtime_state.progress,
                progress_message=runtime_state.progress_message,
                root_node_id=runtime_state.root_node_id,
                files_total=runtime_state.files_total,
                files_processed=runtime_state.files_processed,
                bytes_total=runtime_state.bytes_total,
                bytes_downloaded=runtime_state.bytes_downloaded,
                error=runtime_state.error_message,
                is_terminal=runtime_state.status in [
                    SyncTaskStatus.COMPLETED,
                    SyncTaskStatus.FAILED,
                    SyncTaskStatus.CANCELLED,
                ],
            )
        else:
            task = await service.get_task(task_id)
            if task and task.user_id == current_user.user_id:
                tasks[task_id] = task_to_status_response(task)

    return ApiResponse.success(BatchStatusResponse(tasks=tasks))


@router.get("/tasks")
async def list_tasks(
    include_completed: bool = True,
    limit: int = 50,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List all sync tasks for the current user."""
    tasks = await service.get_user_tasks(
        current_user.user_id, include_completed=include_completed
    )
    return ApiResponse.success([task_to_response(t) for t in tasks[:limit]])


@router.get("/tasks/active")
async def list_active_tasks(
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List all active (non-terminal) sync tasks for polling."""
    tasks = await service.get_active_tasks(current_user.user_id)
    return ApiResponse.success([task_to_status_response(t) for t in tasks])


@router.delete("/task/{task_id}")
async def cancel_task(
    task_id: int,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Cancel a sync task."""
    task = await service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    success = await service.cancel_task(task_id, "Cancelled by user")
    if not success:
        raise HTTPException(
            status_code=400, detail="Task cannot be cancelled (already completed)"
        )

    return ApiResponse.success({"status": "cancelled"})
