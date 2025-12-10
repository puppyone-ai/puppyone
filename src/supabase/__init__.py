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

# 导入子模块的 Repository (可选，供高级用户使用)
from src.supabase.projects.repository import ProjectRepository
from src.supabase.tables.repository import TableRepository
from src.supabase.mcps.repository import McpRepository

# 从子模块导入 Schema，保持向后兼容
from src.supabase.projects.schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
)
from src.supabase.tables.schemas import (
    TableCreate,
    TableUpdate,
    TableResponse,
)
from src.supabase.mcps.schemas import (
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
