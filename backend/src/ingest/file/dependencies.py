"""
ETL Service Dependencies

FastAPI dependency injection for ETL service.
"""

from fastapi import Depends, Path

from arq.connections import create_pool, RedisSettings

from src.ingest.file.arq_client import ETLArqClient
from src.ingest.file.service import ETLService
from src.ingest.file.state.repository import ETLStateRepositoryRedis
from src.ingest.file.tasks.models import ETLTask
from src.ingest.file.tasks.repository import ETLTaskRepositoryBase, ETLTaskRepositorySupabase
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user


# 使用全局变量存储单例
_etl_task_repository = None
_etl_service = None
_etl_arq_client = None
_etl_arq_pool = None
_etl_state_repo = None


def get_etl_task_repository() -> ETLTaskRepositoryBase:
    """
    Get ETL task repository instance (singleton).

    Returns:
        ETLTaskRepositoryBase instance
    """
    global _etl_task_repository
    if _etl_task_repository is None:
        _etl_task_repository = ETLTaskRepositorySupabase()
    return _etl_task_repository


def get_etl_arq_client() -> ETLArqClient:
    global _etl_arq_client
    if _etl_arq_client is None:
        _etl_arq_client = ETLArqClient()
    return _etl_arq_client


async def get_etl_arq_pool():
    global _etl_arq_pool
    if _etl_arq_pool is None:
        client = get_etl_arq_client()
        settings = RedisSettings.from_dsn(client.redis_url)
        _etl_arq_pool = await create_pool(settings)
    return _etl_arq_pool


async def get_etl_state_repo() -> ETLStateRepositoryRedis:
    global _etl_state_repo
    if _etl_state_repo is None:
        pool = await get_etl_arq_pool()
        _etl_state_repo = ETLStateRepositoryRedis(pool)
    return _etl_state_repo


async def get_etl_service() -> ETLService:
    """
    Get ETL service instance (singleton, async deps ready).
    """
    global _etl_service
    if _etl_service is None:
        arq_client = get_etl_arq_client()
        state_repo = await get_etl_state_repo()
        _etl_service = ETLService(
            task_repository=get_etl_task_repository(),
            arq_client=arq_client,
            state_repo=state_repo,
        )
    return _etl_service


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
