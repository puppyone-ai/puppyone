"""
Project 依赖注入
"""

from src.supabase.repository import SupabaseRepository


def get_supabase_repository() -> SupabaseRepository:
    """获取 Supabase 仓库实例"""
    return SupabaseRepository()

