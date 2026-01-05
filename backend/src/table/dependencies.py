from fastapi import Depends, Path
from src.table.repository import TableRepositorySupabase
from src.table.service import TableService
from src.table.models import Table
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user


# 使用全局变量存储单例，而不是每次都创建新实例
# 这样可以避免重复初始化和提升性能
_table_repository = None
_table_service = None


def get_table_repository() -> TableRepositorySupabase:
    """
    获取 table repository 单例

    Returns:
        TableRepositorySupabase 实例
    """
    global _table_repository
    if _table_repository is None:
        _table_repository = TableRepositorySupabase()
    return _table_repository


def get_table_service() -> TableService:
    """
    table_service的依赖注入工厂。使用Supabase作为存储后端

    Returns:
        TableService 单例
    """
    global _table_service
    if _table_service is None:
        _table_service = TableService(get_table_repository())
    return _table_service


def get_verified_table(
    table_id: int = Path(..., description="表格ID"),
    table_service: TableService = Depends(get_table_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> Table:
    """
    依赖注入函数：获取并验证用户对表格的访问权限

    这个依赖会自动验证：
    1. 表格是否存在
    2. 表格是否关联到项目
    3. 项目是否属于当前用户

    如果验证失败，会抛出 NotFoundException

    Args:
        table_id: 表格ID（从路径参数获取）
        table_service: TableService 实例（通过依赖注入）
        current_user: 当前用户（通过依赖注入）

    Returns:
        已验证的 Table 对象

    Raises:
        NotFoundException: 如果表格不存在或用户无权限
    """
    return table_service.get_by_id_with_access_check(table_id, current_user.user_id)
