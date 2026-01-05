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

    def set_raise(self, exc: Exception) -> None:
        self._raise = exc

    def delete_all(self) -> Any:
        self.calls.append(("delete_all", {}))
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

    def write(self, **params: Any) -> Any:
        self.calls.append(("write", dict(params)))
        if self._raise:
            raise self._raise
        return {"ok": True}

    def query(self, **params: Any) -> Any:
        self.calls.append(("query", dict(params)))
        if self._raise:
            raise self._raise
        # 返回形状尽量贴近官方示例：包含 rows，其中每个 row 有 id 和 $dist
        return {
            "rows": [
                {"id": 1, "$dist": 0.12, "name": "foo"},
                {"id": 2, "$dist": 0.34, "name": "bar"},
            ]
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
        self.namespaces: dict[str, _FakeNamespace] = {}

    def namespace(self, namespace: str) -> _FakeNamespace:
        if namespace not in self.namespaces:
            self.namespaces[namespace] = _FakeNamespace()
        return self.namespaces[namespace]


def _service(fake_client: _FakeClient, *, api_key: str | None = "tpuf-secret") -> TurbopufferSearchService:
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


def test_exception_mapping_auth_not_found_and_generic() -> None:
    fc = _FakeClient()
    svc = _service(fc)

    request = httpx.Request("POST", "https://example.invalid")

    ns = fc.namespace("ns4")
    ns.set_raise(httpx.HTTPStatusError("unauthorized", request=request, response=httpx.Response(401, request=request)))
    with pytest.raises(TurbopufferAuthError):
        asyncio.run(svc.query("ns4", rank_by=("content", "BM25", "x")))

    ns.set_raise(httpx.HTTPStatusError("not found", request=request, response=httpx.Response(404, request=request)))
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
        httpx.HTTPStatusError("unauthorized", request=request, response=httpx.Response(401, request=request))
    )

    caplog.set_level(logging.WARNING)
    with pytest.raises(TurbopufferAuthError):
        asyncio.run(svc.query("ns5", rank_by=("content", "BM25", "x")))

    assert secret not in caplog.text


