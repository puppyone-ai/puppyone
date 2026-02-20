"""
ETL Rules Repository Dependencies

提供依赖注入函数，用于获取 ETL 规则仓库实例。
"""

import logging
from fastapi import Depends

from src.upload.file.rules.repository_supabase import RuleRepositorySupabase
from src.supabase.dependencies import get_supabase_client
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user

logger = logging.getLogger(__name__)


def get_rule_repository(
    current_user: CurrentUser = Depends(get_current_user),
    supabase_client=Depends(get_supabase_client),
) -> RuleRepositorySupabase:
    """
    获取 ETL 规则仓库实例。

    自动从 token 中获取 user_id 并注入到 repository 中。

    Args:
        current_user: 当前用户（从 token 中获取）
        supabase_client: Supabase 客户端实例

    Returns:
        规则仓库实例
    """
    logger.debug(f"Creating rule repository for user_id: {current_user.user_id}")
    return RuleRepositorySupabase(
        supabase_client=supabase_client, user_id=current_user.user_id
    )
