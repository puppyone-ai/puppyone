"""
L3-Folder: Workspace API — 给外部 Agent 使用的文件夹接口

端点：
  POST /workspace/create                创建工作区（返回路径）
  POST /workspace/{agent_id}/complete   Agent 完成后触发合并（通过 L2 CollaborationService）
  GET  /workspace/{agent_id}/status     查看工作区状态

依赖链：
  L3-Folder Router → L2.5 SyncWorker → L2 CollaborationService → L1 (PG/S3)
"""

import os
import time as time_mod

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
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
# 创建工作区（L3-Folder → L2.5 Sync → L3 Provider）
# ============================================================

@router.post("/create", response_model=ApiResponse[CreateWorkspaceResponse])
async def create_workspace(
    request: CreateWorkspaceRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    创建 Agent 工作区

    1. SyncWorker 同步 PG/S3 数据到 Lower 目录
    2. WorkspaceProvider 创建隔离工作区（APFS Clone / 全量复制）
    3. 返回工作区路径，bind mount 到 Agent 容器
    """
    from src.workspace.provider import get_workspace_provider
    from src.sync.sync_worker import SyncWorker
    from src.content_node.repository import ContentNodeRepository
    from src.supabase.client import SupabaseClient

    agent_id = request.agent_id or f"ext-{int(time_mod.time() * 1000)}"

    provider = get_workspace_provider()
    node_repo = ContentNodeRepository(SupabaseClient())
    sync_worker = SyncWorker(
        node_repo=node_repo,
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
# Agent 完成后触发合并（L3-Folder → L2 CollaborationService）
# ============================================================

@router.post("/{agent_id}/complete", response_model=ApiResponse[CompleteWorkspaceResponse])
async def complete_workspace(
    agent_id: str,
    project_id: str = Query(..., description="项目 ID"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    外部 Agent 完成后调用此接口

    1. detect_changes: 对比 workspace vs lower
    2. 逐文件 CollaborationService.commit(): 乐观锁 + 三方合并 + 版本记录
    3. cleanup workspace
    """
    from src.workspace.provider import get_workspace_provider
    from src.collaboration.service import CollaborationService
    from src.collaboration.conflict_service import ConflictService
    from src.collaboration.lock_service import LockService
    from src.collaboration.version_service import VersionService as CollabVersionService
    from src.collaboration.version_repository import FileVersionRepository, FolderSnapshotRepository
    from src.collaboration.audit_service import AuditService
    from src.content_node.repository import ContentNodeRepository
    from src.s3.service import S3Service
    from src.supabase.client import SupabaseClient

    supabase = SupabaseClient()
    node_repo = ContentNodeRepository(supabase)
    s3_service = S3Service()
    version_repo = FileVersionRepository(supabase)
    snapshot_repo = FolderSnapshotRepository(supabase)

    collab_service = CollaborationService(
        node_repo=node_repo,
        lock_service=LockService(node_repo),
        conflict_service=ConflictService(),
        version_service=CollabVersionService(
            node_repo=node_repo,
            version_repo=version_repo,
            snapshot_repo=snapshot_repo,
            s3_service=s3_service,
        ),
        audit_service=AuditService(),
    )

    provider = get_workspace_provider()

    # 1. 检测改动
    changes = await provider.detect_changes(agent_id)

    if not changes.modified and not changes.deleted:
        await provider.cleanup(agent_id)
        return ApiResponse.success(data=CompleteWorkspaceResponse(
            agent_id=agent_id, total_files=0, committed=0, conflict_count=0,
        ), message="No changes detected")

    # 2. 逐文件通过 CollaborationService 提交
    committed = 0
    conflict_count = 0
    strategies = []

    for filename, content in changes.modified.items():
        base_name = os.path.splitext(filename)[0]
        node_id = base_name

        node_type = "json" if filename.endswith(".json") else "markdown"

        try:
            import json
            new_content = json.loads(content) if node_type == "json" else content

            result = collab_service.commit(
                node_id=node_id,
                new_content=new_content,
                base_version=0,
                node_type=node_type,
                base_content=None,
                operator_type="external_agent",
                operator_id=agent_id,
                summary=f"External agent write-back: {filename}",
            )
            committed += 1
            if result.strategy:
                strategies.append(result.strategy)
            log_info(f"[Workspace API] Committed {filename}: strategy={result.strategy}")
        except Exception as e:
            conflict_count += 1
            log_error(f"[Workspace API] Failed to commit {filename}: {e}")

    # 3. 清理工作区
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
    """查看工作区是否存在"""
    from src.workspace.provider import get_workspace_provider

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
