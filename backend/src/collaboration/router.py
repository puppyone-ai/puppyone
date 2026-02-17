"""
L2 Collaboration — API 路由

新增 /api/v1/collab/* 端点（模式 B：REST API 直接调用协同层）

端点：
  POST /collab/checkout           checkout 工作副本
  POST /collab/commit             commit 修改（乐观锁 + 三方合并）
  GET  /collab/versions/{node_id}               版本历史
  GET  /collab/versions/{node_id}/{version}      版本详情
  POST /collab/rollback/{node_id}/{version}      单文件回滚
  GET  /collab/diff/{node_id}/{v1}/{v2}          版本对比
  GET  /collab/snapshots/{folder_id}             文件夹快照历史
  POST /collab/rollback-snapshot/{folder_id}/{snapshot_id}  文件夹回滚

同时保留旧路由 /api/v1/nodes/... 的兼容（通过 version_router 不变）
"""

from typing import List
from fastapi import APIRouter, Depends, Query
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.collaboration.service import CollaborationService
from src.collaboration.dependencies import get_collaboration_service
from src.collaboration.schemas import (
    CheckoutRequest, CommitRequest, RollbackRequest,
    WorkingCopy, CommitResult,
    VersionHistoryResponse, FileVersionDetail,
    RollbackResponse, FolderRollbackResponse,
    FolderSnapshotHistoryResponse,
    DiffResponse,
)
from src.common_schemas import ApiResponse


router = APIRouter(
    prefix="/collab",
    tags=["collaboration"],
)


# ============================================================
# checkout / commit
# ============================================================

@router.post("/checkout", response_model=ApiResponse[List[WorkingCopy]])
def checkout(
    body: CheckoutRequest,
    collab: CollaborationService = Depends(get_collaboration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    checkout 一组文件的工作副本

    返回每个文件的 base_version（commit 时用于乐观锁）。
    """
    copies = collab.checkout_batch(
        node_ids=body.node_ids,
        operator_type="user",
        operator_id=current_user.user_id,
    )
    return ApiResponse.success(data=copies)


@router.post("/commit", response_model=ApiResponse[CommitResult])
def commit(
    body: CommitRequest,
    collab: CollaborationService = Depends(get_collaboration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    commit 单个文件的修改

    自动处理乐观锁 + 三方合并 + 版本记录。
    """
    result = collab.commit(
        node_id=body.node_id,
        new_content=body.content,
        base_version=body.base_version,
        node_type=body.node_type,
        operator_type="user",
        operator_id=body.operator or current_user.user_id,
    )
    return ApiResponse.success(data=result)


# ============================================================
# 版本历史 & 详情
# ============================================================

@router.get("/versions/{node_id}", response_model=ApiResponse[VersionHistoryResponse])
def get_version_history(
    node_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    collab: CollaborationService = Depends(get_collaboration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取文件的版本历史"""
    history = collab.get_version_history(node_id, limit, offset)
    return ApiResponse.success(data=history)


@router.get("/versions/{node_id}/{version}", response_model=ApiResponse[FileVersionDetail])
def get_version_content(
    node_id: str,
    version: int,
    collab: CollaborationService = Depends(get_collaboration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取某个版本的完整内容"""
    detail = collab.get_version_content(node_id, version)
    return ApiResponse.success(data=detail)


# ============================================================
# 回滚
# ============================================================

@router.post("/rollback/{node_id}/{version}", response_model=ApiResponse[RollbackResponse])
def rollback_file(
    node_id: str,
    version: int,
    collab: CollaborationService = Depends(get_collaboration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """回滚文件到指定版本"""
    result = collab.rollback_file(
        node_id=node_id,
        target_version=version,
        operator_id=current_user.user_id,
    )
    return ApiResponse.success(data=result, message=f"Rolled back to v{version}")


@router.post(
    "/rollback-snapshot/{folder_id}/{snapshot_id}",
    response_model=ApiResponse[FolderRollbackResponse],
)
def rollback_folder(
    folder_id: str,
    snapshot_id: int,
    collab: CollaborationService = Depends(get_collaboration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """回滚文件夹到指定快照"""
    result = collab.rollback_folder(
        folder_node_id=folder_id,
        target_snapshot_id=snapshot_id,
        operator_id=current_user.user_id,
    )
    return ApiResponse.success(data=result, message=f"Rolled back to snapshot #{snapshot_id}")


# ============================================================
# 版本对比
# ============================================================

@router.get("/diff/{node_id}/{v1}/{v2}", response_model=ApiResponse[DiffResponse])
def diff_versions(
    node_id: str,
    v1: int,
    v2: int,
    collab: CollaborationService = Depends(get_collaboration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """对比两个版本的差异"""
    diff = collab.compute_diff(node_id, v1, v2)
    return ApiResponse.success(data=diff)


# ============================================================
# 文件夹快照
# ============================================================

@router.get("/snapshots/{folder_id}", response_model=ApiResponse[FolderSnapshotHistoryResponse])
def get_snapshot_history(
    folder_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    collab: CollaborationService = Depends(get_collaboration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取文件夹的快照历史"""
    history = collab.get_snapshot_history(folder_id, limit, offset)
    return ApiResponse.success(data=history)
