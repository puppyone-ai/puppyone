"""
ETL Service Dependencies

FastAPI dependency injection for ETL service.
"""

from functools import lru_cache
from fastapi import Depends, Path

from src.etl.config import etl_config
from src.etl.mineru.client import MineRUClient
from src.etl.service import ETLService
from src.etl.tasks.models import ETLTask
from src.etl.tasks.repository import ETLTaskRepositoryBase, ETLTaskRepositorySupabase
from src.llm.dependencies import get_llm_service
from src.s3.dependencies import get_s3_service
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user


@lru_cache
def get_mineru_client() -> MineRUClient:
    """
    Get MineRU client instance (singleton).

    Returns:
        MineRUClient instance
    """
    return MineRUClient()


@lru_cache
def get_etl_task_repository() -> ETLTaskRepositoryBase:
    """
    Get ETL task repository instance (singleton).

    Returns:
        ETLTaskRepositoryBase instance
    """
    return ETLTaskRepositorySupabase()


@lru_cache
def get_etl_service() -> ETLService:
    """
    Get ETL service instance (singleton).

    Returns:
        ETLService instance
    """
    return ETLService(
        s3_service=get_s3_service(),
        llm_service=get_llm_service(),
        mineru_client=get_mineru_client(),
        task_repository=get_etl_task_repository(),
    )


async def get_verified_etl_task(
    task_id: int = Path(..., description="ETL任务ID"),
    etl_service: ETLService = Depends(get_etl_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> ETLTask:
    """
    依赖注入函数：获取并验证用户对 ETL 任务的访问权限

    这个依赖会自动验证：
    1. 任务是否存在
    2. 任务是否属于当前用户

    如果验证失败，会抛出 NotFoundException

    Args:
        task_id: ETL 任务ID（从路径参数获取）
        etl_service: ETLService 实例（通过依赖注入）
        current_user: 当前用户（通过依赖注入）

    Returns:
        已验证的 ETLTask 对象

    Raises:
        NotFoundException: 如果任务不存在或用户无权限
    """
    return await etl_service.get_task_status_with_access_check(
        task_id, current_user.user_id
    )

