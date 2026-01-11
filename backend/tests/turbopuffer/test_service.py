from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
import pytest

from src.turbopuffer.config import TurbopufferConfig
from src.turbopuffer.exceptions import (
    TurbopufferAuthError,
    TurbopufferConfigError,
    TurbopufferNotFound,
    TurbopufferRequestError,
)
from src.turbopuffer.service import TurbopufferSearchService


class _FakeNamespace:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._raise: Exception | None = None
        self._metadata: dict[str, Any] = {"schema": {"content": {"type": "string"}}}

    def set_raise(self, exc: Exception) -> None:
        self._raise = exc

    def set_metadata(self, metadata: dict[str, Any]) -> None:
        self._metadata = metadata

    def delete_all(self) -> Any:
        self.calls.append(("delete_all", {}))
        if self._raise:
            raise self._raise
        return {"ok": True}

    def delete(self) -> Any:
        self.calls.append(("delete", {}))
        if self._raise:
            raise self._raise
        return {"ok": True}

    def schema(self) -> Any:
        self.calls.append(("schema", {}))
        if self._raise:
            raise self._raise
        return {"schema": {"content": {"type": "string"}}}

    def update_schema(self, *, schema: dict[str, Any]) -> Any:
        self.calls.append(("update_schema", {"schema": schema}))
        if self._raise:
            raise self._raise
        return {"ok": True}

    def metadata(self) -> Any:
        self.calls.append(("metadata", {}))
        if self._raise:
            raise self._raise
        return dict(self._metadata)

    def hint_cache_warm(self) -> Any:
        self.calls.append(("hint_cache_warm", {}))
        if self._raise:
            raise self._raise
        return {"status": "ACCEPTED", "message": "cache warm hint accepted"}

    def recall(self, **params: Any) -> Any:
        self.calls.append(("recall", dict(params)))
        if self._raise:
            raise self._raise
        return {"avg_recall": 1.0, "avg_exhaustive_count": 10.0, "avg_ann_count": 10.0}

    def write(self, **params: Any) -> Any:
        self.calls.append(("write", dict(params)))
        if self._raise:
            raise self._raise
        return {"rows_affected": 1, "rows_upserted": 1, "rows_deleted": 0}

    def query(self, **params: Any) -> Any:
        self.calls.append(("query", dict(params)))
        if self._raise:
            raise self._raise
        # 返回形状尽量贴近官方示例：包含 rows，其中每个 row 有 id 和 $dist
        if "aggregate_by" in params and "group_by" not in params:
            return {"aggregations": {"my_count": 42}}
        if "aggregate_by" in params and "group_by" in params:
            return {"aggregation_groups": [{"color": "red", "my_count": 2}]}
        return {
            "rows": [
                {"id": 1, "$dist": 0.12, "name": "foo"},
                {"id": 2, "$dist": 0.34, "name": "bar"},
            ],
            "billing": {
                "billable_logical_bytes_queried": 1,
                "billable_logical_bytes_returned": 1,
            },
            "performance": {"cache_temperature": "warm"},
        }

    def multi_query(self, **params: Any) -> Any:
        self.calls.append(("multi_query", dict(params)))
        if self._raise:
            raise self._raise
        return {
            "results": [
                {"rows": [{"id": 1, "$dist": 0.1, "name": "foo"}]},
                {"rows": [{"id": 2, "$dist": 0.2, "name": "bar"}]},
            ]
        }


class _FakeClient:
    def __init__(self) -> None:
        self._namespaces: dict[str, _FakeNamespace] = {}
        self.list_calls: list[dict[str, Any]] = []

    def namespace(self, namespace: str) -> _FakeNamespace:
        if namespace not in self._namespaces:
            self._namespaces[namespace] = _FakeNamespace()
        return self._namespaces[namespace]

    def namespaces(self, **params: Any):  # type: ignore[override]
        self.list_calls.append(dict(params))

        class _NsObj:
            def __init__(self, _id: str) -> None:
                self.id = _id

        # 简化：返回 iterable；真实 SDK 可能是 generator/paginator
        return [_NsObj("ns-a"), _NsObj("ns-b")]


def _service(
    fake_client: _FakeClient, *, api_key: str | None = "tpuf-secret"
) -> TurbopufferSearchService:
    cfg = TurbopufferConfig(api_key=api_key, region="gcp-us-central1")
    return TurbopufferSearchService(config=cfg, client_factory=lambda _cfg: fake_client)


def test_missing_config_raises_config_error() -> None:
    svc = TurbopufferSearchService(config=TurbopufferConfig(api_key=None))
    with pytest.raises(TurbopufferConfigError):
        asyncio.run(svc.query("ns", rank_by=("content", "BM25", "hello")))


def test_write_passthrough_params() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    asyncio.run(
        svc.write(
            "ns1",
            upsert_rows=[{"id": 1, "vector": [0.1, 0.2], "content": "hi"}],
            distance_metric="cosine_distance",
            schema={"content": {"type": "string", "full_text_search": True}},
        )
    )

    ns = fc.namespace("ns1")
    assert ns.calls
    name, params = ns.calls[-1]
    assert name == "write"
    assert params["distance_metric"] == "cosine_distance"
    assert params["schema"]["content"]["full_text_search"] is True
    assert params["upsert_rows"][0]["id"] == 1


def test_write_supports_columns_and_filter_ops() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    asyncio.run(
        svc.write(
            "ns-columns",
            upsert_columns={"id": [1], "name": ["a"]},
            patch_rows=[{"id": 1, "name": "b"}],
            delete_by_filter=("id", "Eq", 999),
            delete_by_filter_allow_partial=True,
            distance_metric="cosine_distance",
        )
    )

    ns = fc.namespace("ns-columns")
    name, params = ns.calls[-1]
    assert name == "write"
    assert params["upsert_columns"]["id"] == [1]
    assert params["patch_rows"][0]["name"] == "b"
    assert params["delete_by_filter"] == ("id", "Eq", 999)
    assert params["delete_by_filter_allow_partial"] is True


def test_query_passthrough_and_normalization() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    resp = asyncio.run(
        svc.query(
            "ns2",
            rank_by=("vector", "ANN", [0.1, 0.2]),
            top_k=2,
            filters=("name", "Eq", "foo"),
            include_attributes=["name"],
        )
    )

    ns = fc.namespace("ns2")
    name, params = ns.calls[-1]
    assert name == "query"
    assert params["top_k"] == 2
    assert params["filters"] == ("name", "Eq", "foo")
    assert params["include_attributes"] == ["name"]

    assert [r.id for r in resp.rows] == [1, 2]
    assert resp.rows[0].distance == 0.12
    assert resp.rows[0].attributes["name"] == "foo"
    assert resp.billing is not None
    assert resp.performance is not None


def test_query_aggregations_and_group_by() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    resp = asyncio.run(
        svc.query(
            "ns-agg",
            aggregate_by={"my_count": ("Count",)},
            filters=("id", "Gte", 1),
        )
    )
    assert resp.aggregations == {"my_count": 42}

    resp2 = asyncio.run(
        svc.query(
            "ns-agg-group",
            aggregate_by={"my_count": ("Count",)},
            group_by=["color"],
        )
    )
    assert resp2.aggregation_groups is not None
    assert resp2.aggregation_groups[0]["color"] == "red"


def test_query_raw_passthrough() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    resp = asyncio.run(
        svc.query_raw(
            "ns-raw",
            {
                "rank_by": ("id", "asc"),
                "top_k": 2,
                "exclude_attributes": ["vector"],
            },
        )
    )

    ns = fc.namespace("ns-raw")
    name, params = ns.calls[-1]
    assert name == "query"
    assert params["exclude_attributes"] == ["vector"]
    assert len(resp.rows) == 2


def test_write_raw_passthrough() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    asyncio.run(
        svc.write_raw(
            "ns-raw-write",
            {
                "upsert_rows": [{"id": 1, "name": "x"}],
                "distance_metric": "cosine_distance",
            },
        )
    )
    ns = fc.namespace("ns-raw-write")
    name, params = ns.calls[-1]
    assert name == "write"
    assert params["upsert_rows"][0]["name"] == "x"


def test_multi_query_passthrough_and_normalization() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    resp = asyncio.run(
        svc.multi_query(
            "ns3",
            queries=[
                {"top_k": 1, "rank_by": ("content", "BM25", "foo")},
                {"top_k": 1, "rank_by": ("content", "BM25", "bar")},
            ],
        )
    )

    ns = fc.namespace("ns3")
    name, params = ns.calls[-1]
    assert name == "multi_query"
    assert len(params["queries"]) == 2

    assert [item.rows[0].id for item in resp.results] == [1, 2]


def test_list_namespaces() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    resp = asyncio.run(svc.list_namespaces(prefix="ns-", page_size=2))
    assert [n.id for n in resp.namespaces] == ["ns-a", "ns-b"]
    assert fc.list_calls[-1]["prefix"] == "ns-"


def test_namespace_metadata_warm_cache_and_recall() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    fc.namespace("ns-meta").set_metadata({"approx_row_count": 123})
    meta = asyncio.run(svc.metadata("ns-meta"))
    assert meta["approx_row_count"] == 123

    warm = asyncio.run(svc.hint_cache_warm("ns-meta"))
    assert warm["status"] == "ACCEPTED"

    recall = asyncio.run(svc.recall("ns-meta", num=3, top_k=7))
    assert recall["avg_recall"] == 1.0


def test_delete_namespace() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    asyncio.run(svc.delete_namespace("ns-del"))
    ns = fc.namespace("ns-del")
    assert ns.calls[-1][0] == "delete"


def test_exception_mapping_auth_not_found_and_generic() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    request = httpx.Request("POST", "https://example.invalid")

    ns = fc.namespace("ns4")
    ns.set_raise(
        httpx.HTTPStatusError(
            "unauthorized",
            request=request,
            response=httpx.Response(401, request=request),
        )
    )
    with pytest.raises(TurbopufferAuthError):
        asyncio.run(svc.query("ns4", rank_by=("content", "BM25", "x")))

    ns.set_raise(
        httpx.HTTPStatusError(
            "not found", request=request, response=httpx.Response(404, request=request)
        )
    )
    with pytest.raises(TurbopufferNotFound):
        asyncio.run(svc.query("ns4", rank_by=("content", "BM25", "x")))

    ns.set_raise(httpx.RequestError("boom", request=request))
    with pytest.raises(TurbopufferRequestError):
        asyncio.run(svc.query("ns4", rank_by=("content", "BM25", "x")))


def test_logs_do_not_leak_api_key(caplog: pytest.LogCaptureFixture) -> None:
    fc = _FakeClient()
    secret = "tpuf-super-secret-key"
    svc = _service(fc, api_key=secret)

    request = httpx.Request("POST", "https://example.invalid")
    fc.namespace("ns5").set_raise(
        httpx.HTTPStatusError(
            "unauthorized",
            request=request,
            response=httpx.Response(401, request=request),
        )
    )

    caplog.set_level(logging.WARNING)
    with pytest.raises(TurbopufferAuthError):
        asyncio.run(svc.query("ns5", rank_by=("content", "BM25", "x")))

    assert secret not in caplog.text
