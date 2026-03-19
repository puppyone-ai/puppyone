"""
Workspace API — 给外部 Agent 使用的文件夹接口

端点：
  POST /workspace/create                创建工作区（返回路径）
  POST /workspace/{agent_id}/complete   Agent 完成后触发合并（通过 Mut 内核）
  GET  /workspace/{agent_id}/status     查看工作区状态
"""

import json as json_mod
import os
import time as time_mod

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.utils.logger import log_info, log_error


router = APIRouter(
    prefix="/workspace",
    tags=["workspace"],
)


# ============================================================
# 请求/响应模型
# ============================================================

class CreateWorkspaceRequest(BaseModel):
    project_id: str
    agent_id: Optional[str] = None


class CreateWorkspaceResponse(BaseModel):
    agent_id: str
    workspace_path: str
    base_snapshot_id: Optional[int] = None
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
    workspace_path: Optional[str] = None
    base_snapshot_id: Optional[int] = None


# ============================================================
# 创建工作区
# ============================================================

@router.post("/create", response_model=ApiResponse[CreateWorkspaceResponse])
async def create_workspace(
    request: CreateWorkspaceRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    from src.platform.workspace.provider import get_workspace_provider
    from src.connectors.filesystem.worker import SyncWorker
    from src.mut_engine.dependencies import create_tree_reader

    agent_id = request.agent_id or f"ext-{int(time_mod.time() * 1000)}"

    provider = get_workspace_provider()
    tree_reader = create_tree_reader()
    sync_worker = SyncWorker(
        tree_reader=tree_reader,
        base_dir=provider._base_dir if hasattr(provider, '_base_dir') else "/tmp/contextbase",
    )

    await sync_worker.sync_project(request.project_id)

    info = await provider.create_workspace(
        agent_id=agent_id,
        project_id=request.project_id,
    )

    mount_cmd = f"docker run -v {info.path}:/workspace your-agent-image"
    log_info(f"[Workspace API] Created workspace: agent={agent_id}, path={info.path}")

    return ApiResponse.success(data=CreateWorkspaceResponse(
        agent_id=agent_id,
        workspace_path=info.path,
        base_snapshot_id=info.base_snapshot_id,
        mount_command=mount_cmd,
    ))


# ============================================================
# Agent 完成后触发合并（通过 MutWriteService）
# ============================================================

@router.post("/{agent_id}/complete", response_model=ApiResponse[CompleteWorkspaceResponse])
async def complete_workspace(
    agent_id: str,
    project_id: str = Query(..., description="项目 ID"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    外部 Agent 完成后调用此接口 — 通过 MUT protocol push 变更

    1. detect_changes: 对比 workspace vs lower
    2. 构建修改/删除列表
    3. 通过 MutEphemeralClient clone → push 完成原子提交
    """
    from src.platform.workspace.provider import get_workspace_provider
    from src.mut_engine.dependencies import create_ephemeral_client
    from src.connectors.filesystem.cache import CacheManager
    import asyncio

    provider = get_workspace_provider()

    changes = await provider.detect_changes(agent_id)

    if not changes.modified and not changes.deleted:
        await provider.cleanup(agent_id)
        return ApiResponse.success(data=CompleteWorkspaceResponse(
            agent_id=agent_id, total_files=0, committed=0, conflict_count=0,
        ), message="No changes detected")

    auth_context = {
        "agent": f"agent:{agent_id}",
        "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
    }
    client = create_ephemeral_client(project_id, auth_context)
    await asyncio.to_thread(client.clone)

    modified: dict[str, bytes] = {}
    for rel_path, content in changes.modified.items():
        if isinstance(content, str):
            modified[rel_path] = content.encode("utf-8")
        elif isinstance(content, bytes):
            modified[rel_path] = content
        else:
            modified[rel_path] = str(content).encode("utf-8")

    deleted = list(changes.deleted)

    try:
        result = await asyncio.to_thread(
            client.push,
            modified=modified,
            deleted=deleted,
            message=f"Agent workspace merge ({len(modified)} modified, {len(deleted)} deleted)",
            who=agent_id,
        )
        committed = len(modified)
        conflict_count = result.get("conflicts", 0)
        strategies = ["merge"] if result.get("merged") else []
        log_info(
            f"[Workspace API] MUT push: v={result.get('version')} "
            f"merged={result.get('merged', False)} files={committed}"
        )
    except Exception as e:
        committed = 0
        conflict_count = len(modified)
        strategies = []
        log_error(f"[Workspace API] MUT push failed: {e}")

    await provider.cleanup(agent_id)

    total_files = len(changes.modified) + len(changes.deleted)
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
# 查看工作区状态
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
            base_snapshot_id=info.base_snapshot_id,
        ))

    return ApiResponse.success(data=WorkspaceStatusResponse(
        agent_id=agent_id, exists=False,
    ))
