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
    2. 构建 file_path → node_id 映射（从 SyncWorker 的 .metadata.json）
    3. 逐文件 CollaborationService.commit(): 乐观锁 + 三方合并 + 版本记录
    4. 处理新建文件 / 删除文件
    5. cleanup workspace
    """
    import json as json_mod
    from src.workspace.provider import get_workspace_provider
    from src.collaboration.service import CollaborationService
    from src.collaboration.conflict_service import ConflictService
    from src.collaboration.lock_service import LockService
    from src.collaboration.version_service import VersionService as CollabVersionService
    from src.collaboration.version_repository import FileVersionRepository, FolderSnapshotRepository
    from src.collaboration.audit_service import AuditService
    from src.collaboration.audit_repository import AuditRepository
    from src.content_node.repository import ContentNodeRepository
    from src.content_node.service import ContentNodeService
    from src.s3.service import S3Service
    from src.supabase.client import SupabaseClient
    from src.sync.cache_manager import CacheManager

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
        audit_service=AuditService(audit_repo=AuditRepository(supabase)),
    )

    provider = get_workspace_provider()

    # 1. 检测改动 (返回 {rel_path: content} 和 [rel_path])
    changes = await provider.detect_changes(agent_id)

    if not changes.modified and not changes.deleted:
        await provider.cleanup(agent_id)
        return ApiResponse.success(data=CompleteWorkspaceResponse(
            agent_id=agent_id, total_files=0, committed=0, conflict_count=0,
        ), message="No changes detected")

    # 2. 从 .metadata.json 构建 file_path → (node_id, version) 映射
    #    SyncWorker 同步时已经记录了 {node_id: {file_path, version, ...}}
    base_dir = provider._base_dir if hasattr(provider, '_base_dir') else "/tmp/contextbase"
    cache = CacheManager(base_dir=base_dir)
    sync_metadata = cache.read_metadata(project_id)

    path_to_node: dict[str, dict] = {}
    for node_id, meta in sync_metadata.items():
        fp = meta.get("file_path", "")
        if fp:
            path_to_node[fp] = {
                "node_id": node_id,
                "version": meta.get("version", 0),
                "type": meta.get("type", "json"),
            }

    # 3. 逐文件提交修改（并收集成功提交的项用于 L2.5 PUSH）
    committed = 0
    conflict_count = 0
    strategies: list[str] = []
    created_nodes: list[str] = []
    committed_items: list[dict] = []

    for rel_path, content in changes.modified.items():
        node_type = "json" if rel_path.endswith(".json") else "markdown"

        try:
            new_content = json_mod.loads(content) if node_type == "json" else content
        except (json_mod.JSONDecodeError, TypeError):
            new_content = content
            node_type = "markdown"

        mapping = path_to_node.get(rel_path)

        if mapping:
            # --- 已有节点：通过 L2 commit ---
            node_id = mapping["node_id"]
            base_version = mapping["version"]

            # 获取 base_content 用于三方合并
            base_content = None
            if base_version > 0:
                try:
                    ver_detail = collab_service.get_version_content(node_id, base_version)
                    if ver_detail.content_text:
                        base_content = ver_detail.content_text
                    elif ver_detail.content_json is not None:
                        base_content = json_mod.dumps(ver_detail.content_json, ensure_ascii=False, indent=2)
                except Exception:
                    pass

            try:
                result = collab_service.commit(
                    node_id=node_id,
                    new_content=new_content,
                    base_version=base_version,
                    node_type=node_type,
                    base_content=base_content,
                    operator_type="external_agent",
                    operator_id=agent_id,
                    summary=f"Agent write-back: {rel_path}",
                )
                committed += 1
                committed_items.append({
                    "node_id": node_id,
                    "version": result.version,
                    "content": result.final_content,
                    "node_type": node_type,
                })
                if result.strategy and result.strategy != "direct":
                    strategies.append(result.strategy)
                log_info(
                    f"[Workspace API] Committed {rel_path} → node {node_id} "
                    f"v{base_version}→v{result.version} ({result.status})"
                )
            except Exception as e:
                conflict_count += 1
                log_error(f"[Workspace API] Commit failed for {rel_path} (node {node_id}): {e}")

        else:
            # --- 新建文件：Agent 在沙盒中创建了一个 lower 中没有的文件 ---
            node_name = os.path.basename(rel_path)
            # 去掉扩展名作为节点名
            base_name = os.path.splitext(node_name)[0] if "." in node_name else node_name

            try:
                node_svc = ContentNodeService(
                    repo=node_repo,
                    s3_service=s3_service,
                    version_service=collab_service.version_svc,
                )
                if node_type == "json":
                    new_node = node_svc.create_json_node(
                        project_id=project_id,
                        name=base_name,
                        content=new_content,
                        created_by=current_user.user_id,
                    )
                else:
                    new_node = await node_svc.create_markdown_node(
                        project_id=project_id,
                        name=base_name,
                        content=new_content if isinstance(new_content, str) else str(new_content),
                        created_by=current_user.user_id,
                    )
                committed += 1
                created_nodes.append(rel_path)
                log_info(
                    f"[Workspace API] Created new node {new_node.id} "
                    f"for {rel_path} (type={node_type})"
                )
            except Exception as e:
                conflict_count += 1
                log_error(f"[Workspace API] Failed to create node for {rel_path}: {e}")

    # 4. 处理删除（先创建 delete 版本记录，再删除节点）
    deleted_count = 0
    for rel_path in changes.deleted:
        mapping = path_to_node.get(rel_path)
        if mapping:
            node_id = mapping["node_id"]
            try:
                collab_service.version_svc.create_version(
                    node_id=node_id,
                    operator_type="external_agent",
                    operator_id=agent_id,
                    operation="delete",
                    summary=f"Agent deleted: {rel_path}",
                )
                node_repo.delete(node_id)
                deleted_count += 1
                log_info(f"[Workspace API] Deleted node {node_id} ({rel_path})")
            except Exception as e:
                log_error(f"[Workspace API] Delete failed for {rel_path} (node {node_id}): {e}")

    # 5. PUSH: 将已提交的变更推送到关联的 folder access 工作区
    if committed_items:
        try:
            from src.access.openclaw.folder_access import FolderAccessService
            fa = FolderAccessService.get_instance()
            if fa:
                for item in committed_items:
                    await fa.push_node_to_workspace(
                        source_id=item.get("source_id", 0),
                        node_id=item["node_id"],
                        version=item["version"],
                        content=item["content"],
                        node_type=item["node_type"],
                    )
        except Exception as e:
            log_error(f"[Workspace API] Folder Access PUSH failed: {e}")

    # 6. 清理工作区
    await provider.cleanup(agent_id)

    total_files = len(changes.modified) + len(changes.deleted)
    log_info(
        f"[Workspace API] Completed: agent={agent_id}, "
        f"committed={committed}, conflicts={conflict_count}, "
        f"deleted={deleted_count}, new_files={len(created_nodes)}"
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
