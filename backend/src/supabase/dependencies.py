"""
Supabase 依赖注入

提供 FastAPI 依赖注入函数，用于获取 Supabase 客户端和仓库实例。
"""

from supabase import Client
from src.supabase.client import SupabaseClient
from src.supabase.repository import SupabaseRepository


# 使用全局变量存储单例，而不是 lru_cache
# 这样可以避免 reload 时的缓存问题
_supabase_client = None
_supabase_repository = None


def get_supabase_client() -> Client:
    """
    获取 Supabase 客户端实例（单例）

    Returns:
        Supabase Client 实例
    """
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = SupabaseClient().client
    return _supabase_client


def get_supabase_repository() -> SupabaseRepository:
    """
    获取 Supabase 仓库实例

    Returns:
        SupabaseRepository 实例
    """
    global _supabase_repository
    if _supabase_repository is None:
        _supabase_repository = SupabaseRepository()
    return _supabase_repository
