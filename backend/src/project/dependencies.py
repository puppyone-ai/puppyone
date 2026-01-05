"""
Project 依赖注入
"""

from fastapi import Depends, Path
from src.project.repository import ProjectRepositorySupabase
from src.project.service import ProjectService
from src.project.models import Project
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user


# 使用全局变量存储单例，而不是每次都创建新实例
# 这样可以避免重复初始化和提升性能
_project_repository = None
_project_service = None


def get_project_repository() -> ProjectRepositorySupabase:
    """
    获取 project repository 单例

    Returns:
        ProjectRepositorySupabase 实例
    """
    global _project_repository
    if _project_repository is None:
        _project_repository = ProjectRepositorySupabase()
    return _project_repository


def get_project_service() -> ProjectService:
    """
    project_service的依赖注入工厂。使用Supabase作为存储后端

    Returns:
        ProjectService 单例
    """
    global _project_service
    if _project_service is None:
        _project_service = ProjectService(get_project_repository())
    return _project_service


def get_verified_project(
    project_id: int = Path(..., description="项目ID"),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> Project:
    """
    依赖注入函数：获取并验证用户对项目的访问权限

    这个依赖会自动验证：
    1. 项目是否存在
    2. 项目是否属于当前用户

    如果验证失败，会抛出 NotFoundException

    Args:
        project_id: 项目ID（从路径参数获取）
        project_service: ProjectService 实例（通过依赖注入）
        current_user: 当前用户（通过依赖注入）

    Returns:
        已验证的 Project 对象

    Raises:
        NotFoundException: 如果项目不存在或用户无权限
    """
    return project_service.get_by_id_with_access_check(project_id, current_user.user_id)
