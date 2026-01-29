"""
Sync Task Router

API endpoints for sync task management.
"""

from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

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
    background_tasks: BackgroundTasks,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Start a new sync import task.
    
    The task runs in the background. Use GET /sync/task/{task_id}/status 
    to poll for progress.
    """
    try:
        task = await service.create_task(
            user_id=current_user.user_id,
            project_id=request.project_id,
            url=request.url,
            task_type=request.task_type,
        )

        # Execute task in background
        background_tasks.add_task(_run_task, service, task.id)

        return ApiResponse.success(task_to_response(task))

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _run_task(service: SyncTaskService, task_id: int):
    """Background task runner."""
    try:
        await service.execute_task(task_id)
    except Exception as e:
        # Error already logged and saved to DB in service
        pass


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
    """
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
