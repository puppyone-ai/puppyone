"""
Table 模块

提供 Table 相关的数据访问层和数据模型。
"""

from src.supabase.tables.repository import TableRepository
from src.supabase.tables.schemas import (
    TableBase,
    TableCreate,
    TableUpdate,
    TableResponse,
)

__all__ = [
    "TableRepository",
    "TableBase",
    "TableCreate",
    "TableUpdate",
    "TableResponse",
]
