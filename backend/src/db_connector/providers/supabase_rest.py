"""Supabase REST Provider - 通过 PostgREST API 查询 Supabase 数据库"""

import time
import logging
import os
import re
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
_SAFE_TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class SupabaseConnectionError(Exception):
    """Supabase connection/query error."""


class SupabaseAuthError(SupabaseConnectionError):
    """Supabase auth/permission error with optional frontend hints."""

    def __init__(
        self,
        message: str,
        *,
        error_code: str | None = None,
        suggested_actions: list[str] | None = None,
    ):
        super().__init__(message)
        self.error_code = error_code
        self.suggested_actions = suggested_actions or []


class SupabaseRestProvider(BaseDBProvider):
    """通过 Supabase REST API (PostgREST) 访问数据"""

    # === 公开接口 ===

    async def test_connection(self, config: dict) -> dict[str, Any]:
        """
        测试连接：尝试列出表来验证 URL 和 Key 是否有效。
        """
        base_url, headers = self._build_request(config)
        key_type = config.get("key_type", "anon")
        api_key = config.get("api_key", "").strip()
        key_format = self._detect_key_format(api_key)

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            try:
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
            except httpx.HTTPStatusError as e:
                status_code = e.response.status_code
                if status_code == 401:
                    # 某些 Supabase 配置下，新格式 key 可能仍要求 Authorization 头。
                    # 这里做一次回退重试，避免误判为 key 错误。
                    if key_format in {"sb_publishable", "sb_secret"} and "Authorization" not in headers:
                        fallback_headers = {**headers, "Authorization": f"Bearer {api_key}"}
                        try:
                            retry_resp = await client.get(f"{base_url}/rest/v1/", headers=fallback_headers)
                            retry_resp.raise_for_status()
                            data = retry_resp.json()
                            tables_count = 0
                            if isinstance(data, dict) and "paths" in data:
                                tables_count = len(data["paths"])
                            elif isinstance(data, dict) and "definitions" in data:
                                tables_count = len(data["definitions"])
                            return {"ok": True, "tables_count": tables_count}
                        except httpx.HTTPStatusError as retry_e:
                            if self._is_schema_access_forbidden(retry_e.response):
                                if key_type == "anon":
                                    return {
                                        "ok": True,
                                        "tables_count": 0,
                                        "introspection_limited": True,
                                        "message": (
                                            "Connected with anon key. Schema introspection is restricted by Supabase, "
                                            "so table auto-discovery is unavailable."
                                        ),
                                        "suggested_actions": [
                                            "Keep using anon key for least privilege",
                                            "Use manual table name input in the next step",
                                            "Ensure target table has RLS policy allowing anon SELECT",
                                        ],
                                    }
                                diagnostic = self._build_http_diagnostic(
                                    base_url=base_url,
                                    key_type=key_type,
                                    key_format=key_format,
                                    response=retry_e.response,
                                    include_verbose=True,
                                )
                                raise SupabaseAuthError(
                                    "Schema access is forbidden for this API key. "
                                    "This connector cannot auto-list tables with this key."
                                    f"{diagnostic}",
                                    error_code="SCHEMA_ACCESS_FORBIDDEN",
                                    suggested_actions=[
                                        "Keep key type as anon for least privilege when possible",
                                        "Use legacy anon JWT key (starts with 'eyJ...') from Supabase Settings > API",
                                        "Or continue with manual table name input instead of auto-discovery",
                                        "Ensure the key and Project URL belong to the same project",
                                    ],
                                ) from retry_e
                            diagnostic = self._build_http_diagnostic(
                                base_url=base_url,
                                key_type=key_type,
                                key_format=key_format,
                                response=retry_e.response,
                                include_verbose=True,
                            )
                            raise SupabaseAuthError(
                                "Authentication failed after retry. Please verify that the API key belongs to this project "
                                "and has not been rotated."
                                f"{diagnostic}",
                                suggested_actions=[
                                    "Confirm Project URL and API key are from the same Supabase project",
                                    "Try the legacy anon JWT key or a service_role key for testing",
                                    "Check if this key is revoked/rotated in Supabase Dashboard > Settings > API",
                                ],
                            ) from retry_e

                    if self._is_schema_access_forbidden(e.response):
                        if key_type == "anon":
                            return {
                                "ok": True,
                                "tables_count": 0,
                                "introspection_limited": True,
                                "message": (
                                    "Connected with anon key. Schema introspection is restricted by Supabase, "
                                    "so table auto-discovery is unavailable."
                                ),
                                "suggested_actions": [
                                    "Keep using anon key for least privilege",
                                    "Use manual table name input in the next step",
                                    "Ensure target table has RLS policy allowing anon SELECT",
                                ],
                            }
                        diagnostic = self._build_http_diagnostic(
                            base_url=base_url,
                            key_type=key_type,
                            key_format=key_format,
                            response=e.response,
                        )
                        raise SupabaseAuthError(
                            "Schema access is forbidden for this API key. "
                            "This connector cannot auto-list tables with this key."
                            f"{diagnostic}",
                            error_code="SCHEMA_ACCESS_FORBIDDEN",
                            suggested_actions=[
                                "Keep key type as anon for least privilege when possible",
                                "Use legacy anon JWT key (starts with 'eyJ...') from Supabase Settings > API",
                                "Or continue with manual table name input instead of auto-discovery",
                                "Ensure the key and Project URL belong to the same project",
                            ],
                        ) from e

                    diagnostic = self._build_http_diagnostic(
                        base_url=base_url,
                        key_type=key_type,
                        key_format=key_format,
                        response=e.response,
                    )
                    raise SupabaseAuthError(
                        "Authentication failed. Please check your API Key."
                        " Supported formats: legacy JWT ('eyJ...') or new keys ('sb_publishable_' / 'sb_secret_')."
                        f"{diagnostic}",
                        suggested_actions=[
                            "Confirm Project URL and API key are from the same Supabase project",
                            "Try key type matching your selected option (anon/service_role)",
                            "If using sb_publishable_, also test with legacy anon JWT key from the same project",
                        ],
                    ) from e
                elif status_code == 403:
                    # RLS blocking access
                    if key_type == "anon":
                        raise SupabaseAuthError(
                            "Access denied. Your Supabase has Row Level Security (RLS) enabled. "
                            "The anon key cannot access this data. "
                            "Please configure RLS to allow anon access.",
                            error_code="RLS_BLOCKED",
                            suggested_actions=[
                                "Configure RLS: ALTER TABLE your_table ENABLE ROW LEVEL SECURITY",
                                "Create policy: CREATE POLICY ... FOR SELECT TO anon USING (true)",
                                "Verify with anon role: set role anon; then run SELECT ... LIMIT 1",
                            ]
                        ) from e
                    else:
                        raise SupabaseAuthError(
                            "Access denied. Your API Key may not have correct permissions."
                        ) from e
                elif status_code == 404:
                    raise SupabaseConnectionError(
                        f"Project URL not found: {base_url}. Please check your Supabase Project URL."
                    ) from e
                else:
                    raise SupabaseConnectionError(
                        f"Connection failed (HTTP {status_code}): {e.response.text}"
                    ) from e
            except httpx.RequestError as e:
                raise SupabaseConnectionError(
                    f"Network error: Could not connect to {base_url}. Please check your network and URL."
                ) from e

    async def list_tables(self, config: dict) -> list[TableInfo]:
        """
        列出 Supabase 项目中的所有 public 表及其列信息。

        利用 PostgREST 根路径返回的 OpenAPI spec。
        """
        base_url, headers = self._build_request(config)

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            try:
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
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    if self._is_schema_access_forbidden(e.response):
                        logger.warning(
                            "Supabase schema introspection restricted; returning empty table list for manual mode. "
                            "host=%s",
                            base_url,
                        )
                        return []
                    raise SupabaseAuthError(
                        "Authentication failed. Your API Key may be invalid or expired."
                    ) from e
                raise SupabaseConnectionError(
                    f"Failed to list tables (HTTP {e.response.status_code}): {e.response.text}"
                ) from e

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

        # 安全检查：仅允许安全字符，避免路径/查询注入
        # 支持常见 Supabase 表名：字母、数字、下划线、连字符
        if not self._is_safe_table_name(table):
            raise ValueError(
                f"Invalid table name: {table}. "
                "Only letters, numbers, underscore (_) and hyphen (-) are allowed."
            )

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
            try:
                resp = await client.get(
                    f"{base_url}/rest/v1/{table}",
                    headers=headers_with_count,
                    params=params,
                )
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                status_code = e.response.status_code
                if status_code == 401:
                    raise SupabaseAuthError(
                        "Authentication failed. Your API Key may be invalid or expired."
                    ) from e
                elif status_code == 404:
                    raise SupabaseConnectionError(
                        f"Table '{table}' not found in database."
                    ) from e
                raise SupabaseConnectionError(
                    f"Query failed (HTTP {status_code}): {e.response.text}"
                ) from e

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
        - api_key: Supabase API key (anon or service_role)
        - key_type: Type of key for security tracking
        """
        project_url = config.get("project_url", "").rstrip("/")
        api_key = config.get("api_key", "").strip()
        key_type = config.get("key_type", "anon")

        if not project_url:
            raise ValueError("Project URL is required (e.g., https://your-project.supabase.co)")

        if not api_key:
            raise ValueError("API Key is required")

        # 验证 URL 格式
        if not project_url.startswith(("https://", "http://")):
            raise ValueError(
                f"Invalid Project URL format. It should start with 'https://', got: {project_url}"
            )

        # 验证域名格式
        parsed = urlparse(project_url)
        if not parsed.netloc.endswith(".supabase.co"):
            raise ValueError(
                f"Invalid Project URL. It should be a Supabase URL ending with '.supabase.co', got: {parsed.netloc}"
            )

        # 验证 key 格式（支持 Supabase 的新旧格式）：
        # 1) 旧格式 JWT：包含点号（.）分段
        # 2) 新格式前缀：sb_publishable_ / sb_secret_
        is_legacy_jwt = "." in api_key
        is_new_publishable = api_key.startswith("sb_publishable_")
        is_new_secret = api_key.startswith("sb_secret_")

        if not (is_legacy_jwt or is_new_publishable or is_new_secret):
            raise ValueError(
                "Invalid API Key format. "
                "Use a legacy JWT token (e.g., 'eyJxxx.xxx.xxx') "
                "or Supabase new-format keys with prefix "
                "'sb_publishable_' (anon) / 'sb_secret_' (service_role)."
            )

        # 兼容 Supabase 新旧 key：
        # - 旧 JWT key: 需要 Authorization: Bearer <jwt>
        # - 新 sb_publishable_/sb_secret_ key: 作为 apikey 使用，不作为 Bearer token
        #   （否则 PostgREST 可能把它当 JWT 解析导致 401）
        headers = {
            "apikey": api_key,
            "Content-Type": "application/json",
        }
        if is_legacy_jwt:
            headers["Authorization"] = f"Bearer {api_key}"

        return project_url, headers

    @staticmethod
    def _detect_key_format(api_key: str) -> str:
        if api_key.startswith("sb_publishable_"):
            return "sb_publishable"
        if api_key.startswith("sb_secret_"):
            return "sb_secret"
        if "." in api_key:
            return "legacy_jwt"
        return "unknown"

    @staticmethod
    def _build_http_diagnostic(
        *,
        base_url: str,
        key_type: str,
        key_format: str,
        response: httpx.Response,
        include_verbose: bool = False,
    ) -> str:
        """
        构造用于前端展示的安全诊断信息（不泄露完整 key）。
        通过 DB_CONNECTOR_SUPABASE_DEBUG=1 开启更详细输出。
        """
        debug_enabled = os.getenv("DB_CONNECTOR_SUPABASE_DEBUG", "0") == "1"

        host = urlparse(base_url).netloc
        request_id = (
            response.headers.get("x-request-id")
            or response.headers.get("x-supabase-request-id")
            or response.headers.get("cf-ray")
            or "n/a"
        )
        body_preview = (response.text or "").strip().replace("\n", " ")[:240]

        basic = (
            f" [debug: status={response.status_code}, host={host}, key_type={key_type}, "
            f"key_format={key_format}, request_id={request_id}]"
        )
        if not debug_enabled and not include_verbose:
            return basic

        return (
            f"{basic} [upstream_body={body_preview or 'empty'}, "
            f"www_authenticate={response.headers.get('www-authenticate', 'n/a')}]"
        )

    @staticmethod
    def _is_schema_access_forbidden(response: httpx.Response) -> bool:
        """
        Supabase 返回该错误时，说明当前 key 不能访问 schema introspection。
        """
        if response.status_code != 401:
            return False

        message = ""
        hint = ""
        try:
            payload = response.json()
            if isinstance(payload, dict):
                message = str(payload.get("message", "")).lower()
                hint = str(payload.get("hint", "")).lower()
        except Exception:
            pass

        raw = (response.text or "").lower()
        return (
            "access to schema is forbidden" in message
            or "accessing the schema via the data api is only allowed using a secret api key" in hint
            or "access to schema is forbidden" in raw
        )

    @staticmethod
    def _is_safe_table_name(table: str) -> bool:
        if not table:
            return False
        return bool(_SAFE_TABLE_NAME_PATTERN.fullmatch(table))
