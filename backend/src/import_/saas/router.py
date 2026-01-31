"""
SaaS Import Router

API endpoints for SaaS-based data imports.

Supported sources:
- GitHub repositories
- Notion databases/pages (future)
- Airtable bases (future)
- Google Sheets (future)
- Linear projects (future)
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.sync_task.dependencies import get_sync_task_service
from src.sync_task.models import SyncTaskStatus, SyncTaskType
from src.sync_task.schemas import (
    SyncTaskResponse,
    SyncTaskStatusResponse,
    task_to_response,
    task_to_status_response,
)
from src.sync_task.service import SyncTaskService

router = APIRouter(prefix="/saas", tags=["import-saas"])


# ============ Request/Response Schemas ============

class ImportGitHubRequest(BaseModel):
    """Request to import a GitHub repository."""
    url: str = Field(..., description="GitHub repository URL")
    project_id: str = Field(..., description="Target project ID")


class ImportNotionRequest(BaseModel):
    """Request to import from Notion."""
    url: str = Field(..., description="Notion page or database URL")
    project_id: str = Field(..., description="Target project ID")
    import_type: str = Field(
        default="database",
        description="Type of import: 'database' or 'page'"
    )


class ImportStatusResponse(BaseModel):
    """Response for import task status."""
    task_id: int
    status: str
    progress: int
    progress_message: Optional[str] = None
    root_node_id: Optional[str] = None
    error: Optional[str] = None
    is_terminal: bool


# ============ GitHub Routes ============

@router.post("/github")
async def import_github_repo(
    request: ImportGitHubRequest,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Import a GitHub repository.
    
    The repository will be downloaded and its text files will be
    converted to content nodes in the specified project.
    
    The import runs asynchronously via the ARQ worker.
    Use GET /import/saas/task/{task_id}/status to poll for progress.
    """
    # Validate URL
    if "github.com" not in request.url.lower():
        raise HTTPException(
            status_code=400,
            detail="Invalid GitHub URL"
        )
    
    try:
        # Create task and enqueue to ARQ
        task = await service.create_task(
            user_id=current_user.user_id,
            project_id=request.project_id,
            url=request.url,
            task_type=SyncTaskType.GITHUB_REPO,
        )
        
        await service.enqueue_task(task.id, task.task_type.value)
        
        return ApiResponse.success(task_to_response(task))
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Notion Routes (Future) ============

@router.post("/notion")
async def import_notion(
    request: ImportNotionRequest,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Import from Notion.
    
    NOTE: This endpoint is a placeholder. Full implementation coming soon.
    """
    # Validate URL
    if "notion" not in request.url.lower():
        raise HTTPException(
            status_code=400,
            detail="Invalid Notion URL"
        )
    
    task_type = (
        SyncTaskType.NOTION_DATABASE
        if request.import_type == "database"
        else SyncTaskType.NOTION_PAGE
    )
    
    try:
        task = await service.create_task(
            user_id=current_user.user_id,
            project_id=request.project_id,
            url=request.url,
            task_type=task_type,
        )
        
        await service.enqueue_task(task.id, task.task_type.value)
        
        return ApiResponse.success(task_to_response(task))
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Common Task Management Routes ============

@router.get("/task/{task_id}")
async def get_import_task(
    task_id: int,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get full details of an import task."""
    task = await service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return ApiResponse.success(task_to_response(task))


@router.get("/task/{task_id}/status")
async def get_import_task_status(
    task_id: int,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get lightweight status of an import task (for polling).
    
    Checks Redis runtime state first for real-time progress,
    falls back to database if not available.
    """
    # Try Redis first
    runtime_state = await service.get_runtime_state(task_id)
    if runtime_state:
        if runtime_state.user_id != current_user.user_id:
            raise HTTPException(status_code=403, detail="Access denied")
        
        return ApiResponse.success(ImportStatusResponse(
            task_id=runtime_state.task_id,
            status=runtime_state.status.value,
            progress=runtime_state.progress,
            progress_message=runtime_state.progress_message,
            root_node_id=runtime_state.root_node_id,
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

    return ApiResponse.success(ImportStatusResponse(
        task_id=task.id,
        status=task.status.value,
        progress=task.progress,
        progress_message=task.progress_message,
        root_node_id=task.root_node_id,
        error=task.error,
        is_terminal=task.status.is_terminal(),
    ))


@router.get("/tasks")
async def list_import_tasks(
    include_completed: bool = True,
    limit: int = 50,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List all import tasks for the current user."""
    tasks = await service.get_user_tasks(
        current_user.user_id, include_completed=include_completed
    )
    return ApiResponse.success([task_to_response(t) for t in tasks[:limit]])


@router.get("/tasks/active")
async def list_active_import_tasks(
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List all active (non-terminal) import tasks for polling."""
    tasks = await service.get_active_tasks(current_user.user_id)
    return ApiResponse.success([task_to_status_response(t) for t in tasks])


@router.delete("/task/{task_id}")
async def cancel_import_task(
    task_id: int,
    service: SyncTaskService = Depends(get_sync_task_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Cancel an import task."""
    task = await service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    success = await service.cancel_task(task_id, "Cancelled by user")
    if not success:
        raise HTTPException(
            status_code=400,
            detail="Task cannot be cancelled (already completed)"
        )

    return ApiResponse.success({"status": "cancelled"})

