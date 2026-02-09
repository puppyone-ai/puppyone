"""Supabase REST Provider - 通过 PostgREST API 查询 Supabase 数据库"""

import time
import logging
from typing import Any
from urllib.parse import urlparse

import httpx

from src.db_connector.providers.base import (
    BaseDBProvider,
    QueryResult,
    TableInfo,
)

logger = logging.getLogger(__name__)

# httpx 超时配置
_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class SupabaseRestProvider(BaseDBProvider):
    """通过 Supabase REST API (PostgREST) 访问数据"""

    # === 公开接口 ===

    async def test_connection(self, config: dict) -> dict[str, Any]:
        """
        测试连接：尝试列出表来验证 URL 和 Key 是否有效。
        """
        base_url, headers = self._build_request(config)

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            # PostgREST 的根路径返回所有表的 OpenAPI spec
            resp = await client.get(f"{base_url}/rest/v1/", headers=headers)
            resp.raise_for_status()

            # 解析返回的 OpenAPI spec，提取表名
            data = resp.json()
            tables_count = 0
            if isinstance(data, dict) and "paths" in data:
                tables_count = len(data["paths"])
            elif isinstance(data, dict) and "definitions" in data:
                tables_count = len(data["definitions"])

            return {
                "ok": True,
                "tables_count": tables_count,
            }

    async def list_tables(self, config: dict) -> list[TableInfo]:
        """
        列出 Supabase 项目中的所有 public 表及其列信息。

        利用 PostgREST 根路径返回的 OpenAPI spec。
        """
        base_url, headers = self._build_request(config)

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{base_url}/rest/v1/", headers=headers)
            resp.raise_for_status()

            spec = resp.json()
            tables: list[TableInfo] = []

            definitions = spec.get("definitions", {})
            paths = spec.get("paths", {})

            for path, path_info in paths.items():
                table_name = path.lstrip("/")
                if not table_name or table_name.startswith("rpc/"):
                    continue

                # 从 definitions 提取列信息
                columns: list[dict[str, str]] = []
                if table_name in definitions:
                    props = definitions[table_name].get("properties", {})
                    for col_name, col_info in props.items():
                        col_type = col_info.get("format", col_info.get("type", "unknown"))
                        columns.append({"name": col_name, "type": col_type})

                # 判断是 table 还是 view（有 POST 方法的通常是 table）
                is_table = "post" in path_info
                tables.append(TableInfo(
                    name=table_name,
                    type="table" if is_table else "view",
                    columns=columns,
                ))

            tables.sort(key=lambda t: t.name)
            return tables

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
        通过 PostgREST 查询单表数据。

        filters 格式: [{"column": "status", "op": "eq", "value": "active"}, ...]
        支持的 op: eq, neq, gt, gte, lt, lte, like, ilike, in, is
        """
        base_url, headers = self._build_request(config)

        # 安全检查：表名只允许合法字符
        if not all(c.isalnum() or c == '_' for c in table):
            raise ValueError(f"Invalid table name: {table}")

        # 构造查询参数
        params: dict[str, str] = {
            "select": select,
            "limit": str(limit),
            "offset": str(offset),
        }

        if order:
            params["order"] = order

        # 添加 filter
        if filters:
            for f in filters:
                col = f.get("column", "")
                op = f.get("op", "eq")
                val = f.get("value", "")
                # PostgREST filter: ?column=op.value
                params[col] = f"{op}.{val}"

        # 请求时要求返回 count
        headers_with_count = {**headers, "Prefer": "count=exact"}

        start = time.monotonic()

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{base_url}/rest/v1/{table}",
                headers=headers_with_count,
                params=params,
            )
            resp.raise_for_status()

        elapsed_ms = round((time.monotonic() - start) * 1000, 2)
        rows = resp.json()

        if not rows:
            return QueryResult(columns=[], rows=[], row_count=0, execution_time_ms=elapsed_ms)

        columns = list(rows[0].keys()) if rows else []

        return QueryResult(
            columns=columns,
            rows=rows,
            row_count=len(rows),
            execution_time_ms=elapsed_ms,
        )

    # === 内部方法 ===

    @staticmethod
    def _build_request(config: dict) -> tuple[str, dict[str, str]]:
        """
        从配置构造 base_url 和 headers。

        config 需要：
        - project_url: Supabase project URL (e.g. https://xxx.supabase.co)
        - service_role_key: Supabase service_role key
        """
        project_url = config.get("project_url", "").rstrip("/")
        service_role_key = config.get("service_role_key", "")

        if not project_url or not service_role_key:
            raise ValueError("Need 'project_url' and 'service_role_key'")

        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        return project_url, headers
