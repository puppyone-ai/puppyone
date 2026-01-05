"""
TurbopufferSearchService

说明：
- 本服务提供 async-first 接口；底层默认使用同步 turbopuffer SDK，并通过 `asyncio.to_thread`
  避免阻塞事件循环（后续如 SDK 提供原生 async client，可再做替换）
- 本服务不会对外暴露 turbopuffer SDK 的模型对象；返回值统一归一化为本模块 schemas
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from src.turbopuffer.config import TurbopufferConfig, turbopuffer_config
from src.turbopuffer.exceptions import TurbopufferConfigError, map_external_exception
from src.turbopuffer.schemas import (
    TurbopufferMultiQueryItem,
    TurbopufferMultiQueryResponse,
    TurbopufferQueryResponse,
    TurbopufferRow,
    TurbopufferWriteResponse,
)

logger = logging.getLogger(__name__)


def _safe_row_dict(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        return dict(row)
    if hasattr(row, "model_dump"):
        # pydantic v2
        return row.model_dump()
    if hasattr(row, "dict"):
        # pydantic v1
        return row.dict()
    if hasattr(row, "__dict__"):
        return dict(row.__dict__)
    return {}


def _normalize_rows(rows: Any) -> list[TurbopufferRow]:
    if rows is None:
        return []
    if not isinstance(rows, list):
        # 有些 SDK 返回可能是 tuple/iterable
        try:
            rows = list(rows)
        except TypeError:
            rows = []

    out: list[TurbopufferRow] = []
    for r in rows:
        d = _safe_row_dict(r)
        if not d:
            continue

        row_id = d.get("id")
        if row_id is None:
            continue

        # turbopuffer 的返回常见包含 "$dist"；也可能包含 "dist"/"distance"
        dist = None
        for k in ("$dist", "dist", "distance"):
            if k in d:
                dist = d.get(k)
                break

        score = None
        for k in ("$score", "score"):
            if k in d:
                score = d.get(k)
                break

        attributes: dict[str, Any] = {}
        for k, v in d.items():
            if k in {"id", "vector", "$dist", "dist", "distance", "$score", "score"}:
                continue
            attributes[k] = v

        out.append(
            TurbopufferRow(id=row_id, distance=dist, score=score, attributes=attributes)
        )
    return out


class TurbopufferSearchService:
    def __init__(
        self,
        config: TurbopufferConfig | None = None,
        *,
        client_factory: Callable[[TurbopufferConfig], Any] | None = None,
    ) -> None:
        self._config = config or turbopuffer_config
        self._client_factory = client_factory
        self._client: Any | None = None

    def _import_sdk(self) -> Any:
        try:
            import turbopuffer  # type: ignore
        except Exception as e:  # pragma: no cover
            raise TurbopufferConfigError("turbopuffer package is not available") from e
        return turbopuffer

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client

        if not self._config.configured:
            raise TurbopufferConfigError("TURBOPUFFER_API_KEY is not set")

        if self._client_factory is not None:
            self._client = self._client_factory(self._config)
            return self._client

        sdk = self._import_sdk()
        # 官方示例：turbopuffer.Turbopuffer(api_key=..., region=...)
        self._client = sdk.Turbopuffer(
            api_key=self._config.api_key, region=self._config.region
        )
        return self._client

    def _get_namespace(self, namespace: str) -> Any:
        client = self._get_client()

        # turbopuffer SDK 常见提供 `.namespace(name)` 返回 namespace 对象
        if hasattr(client, "namespace"):
            return client.namespace(namespace)

        # 兼容 stainless 风格：client.namespaces.<op>(namespace=..., **params)
        if hasattr(client, "namespaces"):
            return _NamespaceProxy(client.namespaces, namespace)

        raise TurbopufferConfigError("Invalid turbopuffer client: no namespace API")

    async def _call(self, fn: Callable[[], Any]) -> Any:
        try:
            return await asyncio.to_thread(fn)
        except Exception as e:
            mapped = map_external_exception(e)
            # 不输出原始异常文本，避免 request/headers 等敏感信息泄露
            logger.warning("Turbopuffer call failed: %s", type(mapped).__name__)
            raise mapped from e

    async def delete_all(self, namespace: str) -> None:
        ns = self._get_namespace(namespace)
        await self._call(lambda: ns.delete_all())

    async def schema(self, namespace: str) -> Any:
        ns = self._get_namespace(namespace)
        return await self._call(lambda: ns.schema())

    async def update_schema(self, namespace: str, *, schema: dict[str, Any]) -> Any:
        ns = self._get_namespace(namespace)
        return await self._call(lambda: ns.update_schema(schema=schema))

    async def write(
        self,
        namespace: str,
        *,
        upsert_rows: list[dict[str, Any]] | None = None,
        deletes: list[int | str] | None = None,
        distance_metric: str | None = None,
        schema: dict[str, Any] | None = None,
    ) -> TurbopufferWriteResponse:
        ns = self._get_namespace(namespace)

        params: dict[str, Any] = {}
        if upsert_rows is not None:
            params["upsert_rows"] = upsert_rows
        if deletes is not None:
            params["deletes"] = deletes
        if distance_metric is not None:
            params["distance_metric"] = distance_metric
        if schema is not None:
            params["schema"] = schema

        await self._call(lambda: ns.write(**params))
        return TurbopufferWriteResponse()

    async def query(
        self,
        namespace: str,
        *,
        rank_by: Any | None = None,
        top_k: int = 10,
        filters: Any | None = None,
        include_attributes: list[str] | None = None,
    ) -> TurbopufferQueryResponse:
        ns = self._get_namespace(namespace)
        params: dict[str, Any] = {"top_k": top_k}
        if rank_by is not None:
            params["rank_by"] = rank_by
        if filters is not None:
            params["filters"] = filters
        if include_attributes is not None:
            params["include_attributes"] = include_attributes

        raw = await self._call(lambda: ns.query(**params))
        raw_rows = None
        if isinstance(raw, dict):
            raw_rows = raw.get("rows")
        elif hasattr(raw, "rows"):
            raw_rows = getattr(raw, "rows")
        else:
            raw_rows = raw
        return TurbopufferQueryResponse(rows=_normalize_rows(raw_rows))

    async def multi_query(
        self,
        namespace: str,
        *,
        queries: list[dict[str, Any]],
    ) -> TurbopufferMultiQueryResponse:
        ns = self._get_namespace(namespace)
        raw = await self._call(lambda: ns.multi_query(queries=queries))

        raw_results = None
        if isinstance(raw, dict):
            raw_results = raw.get("results") or raw.get("responses")
        elif hasattr(raw, "results"):
            raw_results = getattr(raw, "results")
        else:
            raw_results = raw

        results: list[TurbopufferMultiQueryItem] = []
        if raw_results is None:
            raw_results = []
        for item in raw_results:
            if isinstance(item, dict):
                rows = item.get("rows")
            elif hasattr(item, "rows"):
                rows = getattr(item, "rows")
            else:
                rows = item
            results.append(TurbopufferMultiQueryItem(rows=_normalize_rows(rows)))
        return TurbopufferMultiQueryResponse(results=results)


class _NamespaceProxy:
    """
    将 stainless 风格的 `client.namespaces.<op>(namespace=..., **params)` 适配为 `ns.<op>(**params)`.
    """

    def __init__(self, namespaces_resource: Any, namespace: str) -> None:
        self._resource = namespaces_resource
        self._namespace = namespace

    def delete_all(self) -> Any:
        return self._resource.delete_all(namespace=self._namespace)

    def schema(self) -> Any:
        return self._resource.schema(namespace=self._namespace)

    def update_schema(self, *, schema: dict[str, Any]) -> Any:
        return self._resource.update_schema(namespace=self._namespace, schema=schema)

    def write(self, **params: Any) -> Any:
        return self._resource.write(namespace=self._namespace, **params)

    def query(self, **params: Any) -> Any:
        return self._resource.query(namespace=self._namespace, **params)

    def multi_query(self, **params: Any) -> Any:
        return self._resource.multi_query(namespace=self._namespace, **params)
