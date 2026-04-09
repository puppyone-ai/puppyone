"""
Supabase dependency injection.

Provides FastAPI dependency injection functions for obtaining Supabase client and repository instances.
"""

from supabase import Client
from src.infra.supabase.client import SupabaseClient
from src.infra.supabase.repository import SupabaseRepository


# Use global variables to store singletons instead of lru_cache
# This avoids cache issues during reload
_supabase_client = None
_supabase_repository = None


def get_supabase_client() -> Client:
    """
    Get Supabase client instance (singleton).

    Returns:
        Supabase Client instance
    """
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = SupabaseClient().client
    return _supabase_client


def get_supabase_repository() -> SupabaseRepository:
    """
    Get Supabase repository instance.

    Returns:
        SupabaseRepository instance
    """
    global _supabase_repository
    if _supabase_repository is None:
        _supabase_repository = SupabaseRepository()
    return _supabase_repository
