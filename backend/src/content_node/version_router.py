"""
版本管理 — API 路由

端点：
  GET  /nodes/{node_id}/versions                     文件版本历史
  GET  /nodes/{node_id}/versions/{version}            获取某个版本内容
  POST /nodes/{node_id}/rollback/{version}            单文件回滚
  GET  /nodes/{node_id}/diff/{v1}/{v2}                对比两个版本
  GET  /nodes/{folder_id}/snapshots                   文件夹快照历史
  POST /nodes/{folder_id}/rollback-snapshot/{snapshot_id}  文件夹回滚
"""

from fastapi import APIRouter, Depends, Query
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.project.service import ProjectService
from src.project.dependencies import get_project_service
from src.collaboration.version_service import VersionService
from src.content_node.dependencies import get_version_service
from src.collaboration.schemas import (
    VersionHistoryResponse,
    FileVersionDetail,
    RollbackResponse,
    FolderSnapshotHistoryResponse,
    FolderRollbackResponse,
    DiffResponse,
)
from src.common_schemas import ApiResponse


router = APIRouter(
    prefix="/nodes",
    tags=["content-node-versions"],
)


def _ensure_project_access(
    project_service: ProjectService, current_user: CurrentUser, project_id: str
):
    """验证用户有权访问该项目"""
    project = project_service.get_project(project_id)
    if not project:
        from src.exceptions import NotFoundException, ErrorCode
        raise NotFoundException("Project not found", code=ErrorCode.NOT_FOUND)


# ============================================================
# 文件版本历史
# ============================================================

@router.get("/{node_id}/versions", response_model=ApiResponse[VersionHistoryResponse])
def get_version_history(
    node_id: str,
    project_id: str = Query(..., description="项目 ID"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    version_service: VersionService = Depends(get_version_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取文件的版本历史"""
    _ensure_project_access(project_service, current_user, project_id)
    history = version_service.get_version_history(node_id, limit, offset)
    return ApiResponse.success(data=history)


@router.get("/{node_id}/versions/{version}", response_model=ApiResponse[FileVersionDetail])
def get_version_content(
    node_id: str,
    version: int,
    project_id: str = Query(..., description="项目 ID"),
    version_service: VersionService = Depends(get_version_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取某个版本的完整内容"""
    _ensure_project_access(project_service, current_user, project_id)
    detail = version_service.get_version_content(node_id, version)
    return ApiResponse.success(data=detail)


# ============================================================
# 单文件回滚
# ============================================================

@router.post("/{node_id}/rollback/{version}", response_model=ApiResponse[RollbackResponse])
def rollback_file(
    node_id: str,
    version: int,
    project_id: str = Query(..., description="项目 ID"),
    version_service: VersionService = Depends(get_version_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """回滚文件到指定版本"""
    _ensure_project_access(project_service, current_user, project_id)
    result = version_service.rollback_file(
        node_id=node_id,
        target_version=version,
        operator_id=current_user.user_id,
    )
    return ApiResponse.success(data=result, message=f"已回滚到 v{version}")


# ============================================================
# 版本对比
# ============================================================

@router.get("/{node_id}/diff/{v1}/{v2}", response_model=ApiResponse[DiffResponse])
def diff_versions(
    node_id: str,
    v1: int,
    v2: int,
    project_id: str = Query(..., description="项目 ID"),
    version_service: VersionService = Depends(get_version_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """对比两个版本的差异"""
    _ensure_project_access(project_service, current_user, project_id)
    diff = version_service.compute_diff(node_id, v1, v2)
    return ApiResponse.success(data=diff)


# ============================================================
# 文件夹快照历史
# ============================================================

@router.get("/{folder_id}/snapshots", response_model=ApiResponse[FolderSnapshotHistoryResponse])
def get_snapshot_history(
    folder_id: str,
    project_id: str = Query(..., description="项目 ID"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    version_service: VersionService = Depends(get_version_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取文件夹的快照历史"""
    _ensure_project_access(project_service, current_user, project_id)
    history = version_service.get_snapshot_history(folder_id, limit, offset)
    return ApiResponse.success(data=history)


# ============================================================
# 文件夹回滚
# ============================================================

@router.post("/{folder_id}/rollback-snapshot/{snapshot_id}", response_model=ApiResponse[FolderRollbackResponse])
def rollback_folder(
    folder_id: str,
    snapshot_id: int,
    project_id: str = Query(..., description="项目 ID"),
    version_service: VersionService = Depends(get_version_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """回滚文件夹到指定快照"""
    _ensure_project_access(project_service, current_user, project_id)
    result = version_service.rollback_folder(
        folder_node_id=folder_id,
        target_snapshot_id=snapshot_id,
        operator_id=current_user.user_id,
    )
    return ApiResponse.success(data=result, message=f"已回滚到快照 #{snapshot_id}")
