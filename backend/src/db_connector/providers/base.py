"""Base DB Provider - 所有数据库 Provider 的抽象接口"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class QueryResult:
    """统一的查询结果"""
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    execution_time_ms: float


@dataclass
class TableInfo:
    """表基本信息"""
    name: str
    type: str = "table"  # table | view
    columns: list[dict[str, str]] = field(default_factory=list)  # [{"name": "id", "type": "uuid"}, ...]


class BaseDBProvider(ABC):
    """
    数据库 Provider 抽象基类。

    添加新数据库只需：
    1. 继承此类，实现下面的方法
    2. 在 providers/__init__.py 注册
    """

    @abstractmethod
    async def test_connection(self, config: dict) -> dict[str, Any]:
        """
        测试连接，返回连接信息。

        Returns:
            {"ok": True, "tables_count": 23}
        Raises:
            Exception on failure
        """
        pass

    @abstractmethod
    async def list_tables(self, config: dict) -> list[TableInfo]:
        """列出所有表（含字段信息）"""
        pass

    @abstractmethod
    async def query_table(
        self,
        config: dict,
        table: str,
        select: str = "*",
        filters: list[dict] | None = None,
        order: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> QueryResult:
        """
        查询单张表。

        Args:
            config: 连接配置
            table: 表名
            select: 要查询的列，逗号分隔 (e.g. "id,name,email")
            filters: PostgREST 风格的 filter 列表 [{"column": "status", "op": "eq", "value": "active"}]
            order: 排序 (e.g. "created_at.desc")
            limit: 最大行数
            offset: 偏移量
        """
        pass
