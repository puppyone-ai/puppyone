"""
Supabase 客户端模块

提供 Supabase 客户端的单例封装和针对数据库表的 CRUD 操作。
"""

from src.supabase.client import SupabaseClient
from src.supabase.repository import SupabaseRepository
from src.supabase.dependencies import (
    get_supabase_client,
    get_supabase_repository,
)
from src.supabase.exceptions import (
    SupabaseException,
    SupabaseDuplicateKeyError,
    SupabaseNotFoundError,
    SupabaseForeignKeyError,
    handle_supabase_error,
)
from src.supabase.schemas import (
    UserCreate,
    UserUpdate,
    UserResponse,
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    TableCreate,
    TableUpdate,
    TableResponse,
)

__all__ = [
    "SupabaseClient",
    "SupabaseRepository",
    "get_supabase_client",
    "get_supabase_repository",
    "SupabaseException",
    "SupabaseDuplicateKeyError",
    "SupabaseNotFoundError",
    "SupabaseForeignKeyError",
    "handle_supabase_error",
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "ProjectCreate",
    "ProjectUpdate",
    "ProjectResponse",
    "TableCreate",
    "TableUpdate",
    "TableResponse",
]
