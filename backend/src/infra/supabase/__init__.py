"""
Supabase 客户端模块

提供 Supabase 客户端的单例封装和针对数据库表的 CRUD 操作。

模块结构:
- client: Supabase 客户端单例
- repository: 统一的数据访问仓库 (Facade)
- projects: Project 相关的数据访问层
- tables: Table 相关的数据访问层
- mcps: MCP 相关的数据访问层
- dependencies: 依赖注入
- exceptions: 异常处理
- schemas: 数据模型 (向后兼容)
"""

from src.infra.supabase.client import SupabaseClient
from src.infra.supabase.repository import SupabaseRepository
from src.infra.supabase.dependencies import (
    get_supabase_client,
    get_supabase_repository,
)
from src.infra.supabase.exceptions import (
    SupabaseException,
    SupabaseDuplicateKeyError,
    SupabaseNotFoundError,
    SupabaseForeignKeyError,
    handle_supabase_error,
)

# Re-exports from domain modules (backward compat)
from src.platform.project.supabase_repo import ProjectRepository
from src.content.table.supabase_repo import TableRepository
from src.mcp.supabase_repo import McpRepository

from src.platform.project.supabase_schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
)
from src.content.table.supabase_schemas import (
    TableCreate,
    TableUpdate,
    TableResponse,
)
from src.mcp.supabase_schemas import (
    McpCreate,
    McpUpdate,
    McpResponse,
)

__all__ = [
    # 客户端和主仓库
    "SupabaseClient",
    "SupabaseRepository",
    "get_supabase_client",
    "get_supabase_repository",
    # 子模块的 Repository (可选使用)
    "ProjectRepository",
    "TableRepository",
    "McpRepository",
    # 异常
    "SupabaseException",
    "SupabaseDuplicateKeyError",
    "SupabaseNotFoundError",
    "SupabaseForeignKeyError",
    "handle_supabase_error",
    # Schema (向后兼容)
    "ProjectCreate",
    "ProjectUpdate",
    "ProjectResponse",
    "TableCreate",
    "TableUpdate",
    "TableResponse",
    "McpCreate",
    "McpUpdate",
    "McpResponse",
]
