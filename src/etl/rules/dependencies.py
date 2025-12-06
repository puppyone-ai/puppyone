"""
ETL Rules Repository Dependencies

提供依赖注入函数，用于获取 ETL 规则仓库实例。
"""

import logging
from typing import Optional

from src.config import settings
from src.etl.rules.repository import RuleRepository
from src.etl.rules.repository_supabase import RuleRepositorySupabase
from src.etl.config import etl_config

logger = logging.getLogger(__name__)


def get_rule_repository(user_id: Optional[int] = None):
    """
    获取 ETL 规则仓库实例。
    
    根据配置返回适当的仓库实现：
    - 如果 STORAGE_TYPE 为 "supabase"，返回 RuleRepositorySupabase
    - 否则返回 RuleRepository (本地文件存储)
    
    Args:
        user_id: 用户 ID（用于 Supabase 实现）
    
    Returns:
        规则仓库实例
    """
    storage_type = getattr(settings, "STORAGE_TYPE", "json")
    
    if storage_type == "supabase":
        logger.debug(f"Using Supabase repository for user_id: {user_id}")
        return RuleRepositorySupabase(user_id=user_id)
    else:
        logger.debug(f"Using file-based repository: {etl_config.etl_rules_dir}")
        return RuleRepository(rules_dir=etl_config.etl_rules_dir)

