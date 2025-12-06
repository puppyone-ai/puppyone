"""
ETL Service Dependencies

FastAPI dependency injection for ETL service.
"""

from functools import lru_cache

from src.etl.config import etl_config
from src.etl.mineru.client import MineRUClient
from src.etl.rules.dependencies import get_rule_repository
from src.etl.service import ETLService
from src.llm.dependencies import get_llm_service
from src.s3.dependencies import get_s3_service


@lru_cache
def get_mineru_client() -> MineRUClient:
    """
    Get MineRU client instance (singleton).

    Returns:
        MineRUClient instance
    """
    return MineRUClient()


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
        rule_repository=get_rule_repository(),
    )

