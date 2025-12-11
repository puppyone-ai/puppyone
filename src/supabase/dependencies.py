"""
Supabase 依赖注入

提供 FastAPI 依赖注入函数，用于获取 Supabase 客户端和仓库实例。
"""

from supabase import Client
from src.supabase.client import SupabaseClient
from src.supabase.repository import SupabaseRepository
from functools import lru_cache

@lru_cache
def get_supabase_client() -> Client:
    """
    获取 Supabase 客户端实例（单例）

    Returns:
        Supabase Client 实例
    """
    return SupabaseClient().client

@lru_cache
def get_supabase_repository() -> SupabaseRepository:
    """
    获取 Supabase 仓库实例

    Returns:
        SupabaseRepository 实例
    """
    return SupabaseRepository()
