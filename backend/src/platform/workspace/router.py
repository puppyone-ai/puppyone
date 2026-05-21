"""
Workspace API — Folder interface for external Agents

Endpoints:
  POST /workspace/create                Create workspace (returns path)
  POST /workspace/{agent_id}/complete   Trigger merge after Agent completes (via Version Engine)
  GET  /workspace/{agent_id}/status     View workspace status
"""

import os
import time as time_mod

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from src.common_schemas import ApiResponse
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
from src.version_engine.bootstrap.dependencies import (
    get_product_operation_adapter,
    get_version_write_command_service,
)
from src.version_engine.adapters.product.commands import VersionWriteCommandService
from src.utils.logger import log_error, log_info

router = APIRouter(
    prefix="/workspace",
    tags=["workspace"],
)


# ============================================================
# Request/Response Models
# ============================================================

class CreateWorkspaceRequest(BaseModel):
    project_id: str
    agent_id: str | None = None


class CreateWorkspaceResponse(BaseModel):
    agent_id: str
    workspace_path: str
    base_commit_id: str | None = None
    mount_command: str


class CompleteWorkspaceResponse(BaseModel):
    agent_id: str
    total_files: int
    committed: int
    conflict_count: int
    strategies: list[str] = []


class WorkspaceStatusResponse(BaseModel):
    agent_id: str
    exists: bool
    workspace_path: str | None = None
    base_commit_id: str | None = None


# ============================================================
# Create Workspace
# ============================================================

@router.post("/create", response_model=ApiResponse[CreateWorkspaceResponse])
async def create_workspace(
    request: CreateWorkspaceRequest,
    current_user: CurrentUser = Depends(get_current_user),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
):
    from src.platform.workspace.provider import get_workspace_provider
    from src.platform.workspace.sync_worker import SyncWorker

    agent_id = request.agent_id or f"ext-{int(time_mod.time() * 1000)}"

    provider = get_workspace_provider()
    sync_worker = SyncWorker(
        ops=ops,
        base_dir=provider._base_dir if hasattr(provider, '_base_dir') else "/tmp/contextbase",
    )

    sync_result = await sync_worker.sync_project(request.project_id)

    info = await provider.create_workspace(
        agent_id=agent_id,
        project_id=request.project_id,
        base_commit_id=sync_result.get("head_commit_id") or None,
    )

    mount_cmd = f"docker run -v {info.path}:/workspace your-agent-image"
    log_info(f"[Workspace API] Created workspace: agent={agent_id}, path={info.path}")

    return ApiResponse.success(data=CreateWorkspaceResponse(
        agent_id=agent_id,
        workspace_path=info.path,
        base_commit_id=info.base_commit_id,
        mount_command=mount_cmd,
    ))


# ============================================================
# Trigger merge after Agent completes (via VersionAdminService)
# ============================================================

@router.post("/{agent_id}/complete", response_model=ApiResponse[CompleteWorkspaceResponse])
async def complete_workspace(
    agent_id: str,
    project_id: str = Query(..., description="Project ID"),
    current_user: CurrentUser = Depends(get_current_user),
    commands: VersionWriteCommandService = Depends(get_version_write_command_service),
):
    """
    Called by external Agent after completion - pushes changes via Write Engine

    1. detect_changes: compare workspace vs lower
    2. Build modified/deleted lists
    3. Perform atomic commit via ProductOperationAdapter.bulk_write
    """
    from src.platform.workspace.provider import get_workspace_provider

    provider = get_workspace_provider()
    changes = await provider.detect_changes(agent_id)

    modified: dict[str, bytes] = {}
    for rel_path, content in changes.modified.items():
        if isinstance(content, str):
            modified[rel_path] = content.encode("utf-8")
        elif isinstance(content, bytes):
            modified[rel_path] = content
        else:
            modified[rel_path] = str(content).encode("utf-8")

    deleted = list(changes.deleted)
    total_files = len(changes.modified) + len(changes.deleted)

    try:
        if not changes.modified and not changes.deleted:
            return ApiResponse.success(data=CompleteWorkspaceResponse(
                agent_id=agent_id, total_files=0, committed=0, conflict_count=0,
            ), message="No changes detected")

        outcome = await commands.bulk_write(
            project_id,
            modified,
            actor=agent_id,
            deleted=deleted,
            message=f"Agent workspace merge ({len(modified)} modified, {len(deleted)} deleted)",
        )
        result = outcome.result
        committed = len(modified)
        conflict_count = result.conflicts
        strategies = ["merge"] if result.merged else []
        log_info(
            f"[Workspace API] version push: commit={result.commit_id or '(none)'} "
            f"merged={result.merged} files={committed}"
        )
    except Exception as e:
        log_error(f"[Workspace API] version push failed: {e}")
        raise HTTPException(status_code=500, detail=f"Workspace merge failed: {e}") from e
    finally:
        await provider.cleanup(agent_id)

    log_info(
        f"[Workspace API] Completed: agent={agent_id}, "
        f"committed={committed}, conflicts={conflict_count}"
    )

    return ApiResponse.success(data=CompleteWorkspaceResponse(
        agent_id=agent_id,
        total_files=total_files,
        committed=committed,
        conflict_count=conflict_count,
        strategies=strategies,
    ))


# ============================================================
# View Workspace Status
# ============================================================

@router.get("/{agent_id}/status", response_model=ApiResponse[WorkspaceStatusResponse])
async def workspace_status(
    agent_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    from src.platform.workspace.provider import get_workspace_provider

    provider = get_workspace_provider()
    info = provider._registry.get(agent_id) if hasattr(provider, '_registry') else None

    if info and os.path.exists(info.path):
        return ApiResponse.success(data=WorkspaceStatusResponse(
            agent_id=agent_id,
            exists=True,
            workspace_path=info.path,
            base_commit_id=info.base_commit_id,
        ))

    return ApiResponse.success(data=WorkspaceStatusResponse(
        agent_id=agent_id, exists=False,
    ))
