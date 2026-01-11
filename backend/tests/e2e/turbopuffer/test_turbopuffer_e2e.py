from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

import pytest
from dotenv import load_dotenv

from src.turbopuffer.config import TurbopufferConfig
from src.turbopuffer.exceptions import TurbopufferNotFound, TurbopufferRequestError
from src.turbopuffer.service import TurbopufferSearchService
from tests.e2e._reporter import E2EReporter


def _utc_ts_compact() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _make_namespace(prefix: str = "e2e-tpuf-") -> str:
    # 符合 turbopuffer namespace 约束：[A-Za-z0-9-_.]{1,128}
    return f"{prefix}{_utc_ts_compact()}-{uuid4().hex[:8]}"


def simple_chunk(text: str, *, max_chars: int = 80) -> list[str]:
    """
    一个“足够简单”的 chunker：
    - 以句号分句
    - 按 max_chars 聚合
    """
    parts = [p.strip() for p in text.replace("\n", " ").split(".") if p.strip()]
    out: list[str] = []
    cur = ""
    for p in parts:
        sentence = p + "."
        if not cur:
            cur = sentence
            continue
        if len(cur) + 1 + len(sentence) <= max_chars:
            cur = f"{cur} {sentence}"
        else:
            out.append(cur)
            cur = sentence
    if cur:
        out.append(cur)
    return out


def _retry(
    fn: Callable[[], Any],
    *,
    attempts: int = 5,
    delay_seconds: float = 1.0,
    retry_on: tuple[type[BaseException], ...] = (TurbopufferRequestError,),
) -> Any:
    last: BaseException | None = None
    for i in range(attempts):
        try:
            return fn()
        except retry_on as e:
            last = e
            if i == attempts - 1:
                raise
            time.sleep(delay_seconds)
    if last is not None:
        raise last
    raise RuntimeError("unreachable")


def _rows_brief(rows: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in rows:
        d: dict[str, Any] = {"id": r.id}
        if getattr(r, "distance", None) is not None:
            d["distance"] = r.distance
        if getattr(r, "score", None) is not None:
            d["score"] = r.score
        attrs = getattr(r, "attributes", None) or {}
        # 避免把 vector 打印出来（大、且没必要）
        attrs = {k: v for k, v in attrs.items() if k != "vector"}
        if attrs:
            d["attributes"] = attrs
        out.append(d)
    return out


def _rrf_rank(*ranked_id_lists: list[str], k: int = 60) -> list[str]:
    """
    Reciprocal Rank Fusion (RRF) 的最小实现：
    score(d) = Σ 1 / (k + rank_i(d))
    """
    scores: dict[str, float] = {}
    for ids in ranked_id_lists:
        for rank, doc_id in enumerate(ids, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return [doc_id for doc_id, _ in sorted(scores.items(), key=lambda kv: kv[1], reverse=True)]


@dataclass(frozen=True)
class _Doc:
    id: str
    vector: list[float]
    title: str
    content: str
    category: str
    views: int
    status: str = "published"

    def as_row(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "vector": self.vector,
            "title": self.title,
            "content": self.content,
            "category": self.category,
            "views": self.views,
            "status": self.status,
        }


@pytest.mark.e2e
def test_turbopuffer_e2e_query_write_keep_namespace() -> None:
    """
    e2e 覆盖点（对齐 docs/turbopuffer/api/query.md）：
    1) 入库 + schema/索引参数（distance_metric / full_text_search）
    2) 向量搜索、全文搜索、混合搜索（multi_query + RRF）
    3) 不删除 namespace（用于人工在后台检查写入/修改是否生效）
    4) 其他：metadata / warm cache / list namespaces / patch_by_filter / delete_by_filter
    """

    report = E2EReporter(suite_name="turbopuffer-e2e")

    # 仅对 e2e：尝试加载项目根目录的 .env（避免用户把 key 放在 .env 时 pytest 进程读不到）
    project_root = Path(__file__).resolve().parents[3]  # backend/
    env_path = project_root / ".env"
    loaded_env = False
    if env_path.exists():
        loaded_env = load_dotenv(dotenv_path=env_path, override=False)
        report.log_ok(
            "dotenv.load",
            details={"env_path": str(env_path), "loaded": bool(loaded_env)},
        )
    else:
        report.log_ok(
            "dotenv.load",
            details={"env_path": str(env_path), "loaded": False, "note": ".env not found"},
        )

    cfg = TurbopufferConfig()
    if not cfg.configured:
        # 即使被 skip，也输出报告，方便 CI/本地定位环境问题
        report.log_ok(
            "skip.missing_turbopuffer_api_key",
            details={
                "reason": "TURBOPUFFER_API_KEY is not set (or empty) in current process environment",
                "expected_env_var": "TURBOPUFFER_API_KEY",
                "dotenv_loaded": bool(loaded_env),
            },
        )
        report.finalize(summary={"skipped": True})
        pytest.skip("未检测到 TURBOPUFFER_API_KEY，跳过 turbopuffer e2e 测试")

    svc = TurbopufferSearchService(config=cfg)
    ns_prefix = "e2e-tpuf-"
    namespace = _make_namespace(ns_prefix)
    # 将本次 namespace 写入文件，供第二个测试（删除）读取
    last_ns_path = Path(__file__).with_name(".last_namespace.json")

    report.log_ok("env.configured", details={"region": cfg.region, "namespace": namespace})

    def cleanup_namespace() -> None:
        try:
            asyncio.run(svc.delete_namespace(namespace))
        except TurbopufferNotFound:
            return

    # 预清理（理论上不存在，但保证可重复跑）
    try:
        cleanup_namespace()
        report.log_ok("namespace.precleanup")
    except Exception as e:
        report.log_fail("namespace.precleanup", exc=e)
        raise

    source_text = (
        "The quick brown fox jumps over the lazy dog. "
        "A quick red fox runs through the forest. "
        "This document is about fruit like apple and banana. "
        "Banana smoothies are tasty and easy to make."
    )
    chunks = simple_chunk(source_text, max_chars=80)
    # 我们只取前 4 个 chunks（可控、稳定）
    chunks = (chunks + ["(padding chunk)."] * 4)[:4]

    docs: list[_Doc] = [
        _Doc(
            id="doc-0",
            vector=[1.0, 0.0],
            title="fox-0",
            content=chunks[0],
            category="animal",
            views=10,
        ),
        _Doc(
            id="doc-1",
            vector=[0.9, 0.1],
            title="fox-1",
            content=chunks[1],
            category="animal",
            views=50,
        ),
        _Doc(
            id="doc-2",
            vector=[0.0, 1.0],
            title="fruit-0",
            content=chunks[2],
            category="food",
            views=2500,
        ),
        _Doc(
            id="doc-3",
            vector=[0.1, 0.9],
            title="fruit-1",
            content=chunks[3],
            category="food",
            views=5,
        ),
    ]

    schema = {
        # doc id 为 string，可不显式指定；这里显式更清晰
        "id": "string",
        "title": "string",
        "content": {"type": "string", "full_text_search": True},
        "category": "string",
        "views": "int",
        "status": "string",
        # 向量维度：2；ann 开启
        "vector": {"type": "[2]f32", "ann": True},
    }

    # 1) 写入 + 设置 schema / distance_metric
    try:
        write_resp = asyncio.run(
            svc.write(
                namespace,
                upsert_rows=[d.as_row() for d in docs],
                distance_metric="cosine_distance",
                schema=schema,
            )
        )
        report.log_ok(
            "write.upsert_rows",
            details={"rows": [d.id for d in docs]},
            data=write_resp.model_dump(),
        )
    except Exception as e:
        report.log_fail("write.upsert_rows", exc=e)
        cleanup_namespace()
        raise

    # 额外：metadata / warm cache
    try:
        meta = asyncio.run(svc.metadata(namespace))
        report.log_ok("namespace.metadata", data=meta)
    except Exception as e:
        report.log_fail("namespace.metadata", exc=e)
        cleanup_namespace()
        raise

    try:
        warm = asyncio.run(svc.hint_cache_warm(namespace))
        report.log_ok("namespace.hint_cache_warm", data=warm)
    except Exception as e:
        report.log_fail("namespace.hint_cache_warm", exc=e)
        cleanup_namespace()
        raise

    # 2) 向量搜索（ANN）
    try:
        vq = _retry(
            lambda: asyncio.run(
                svc.query(
                    namespace,
                    rank_by=("vector", "ANN", [1.0, 0.0]),
                    top_k=3,
                    include_attributes=["title", "content", "category", "views", "status"],
                )
            )
        )
        report.log_ok("query.vector.ANN", data={"rows": _rows_brief(vq.rows)})
        assert vq.rows, "向量搜索无结果"
        assert str(vq.rows[0].id) == "doc-0"
    except Exception as e:
        report.log_fail("query.vector.ANN", exc=e)
        cleanup_namespace()
        raise

    # 2) 全文搜索（BM25）
    try:
        tq = _retry(
            lambda: asyncio.run(
                svc.query(
                    namespace,
                    rank_by=("content", "BM25", "quick fox"),
                    top_k=3,
                    include_attributes=["title", "content", "category"],
                )
            )
        )
        report.log_ok("query.full_text.BM25", data={"rows": _rows_brief(tq.rows)})
        assert tq.rows, "全文搜索无结果"
        # 由于 `content` 的 chunk 中包含 quick/fox，我们期望前两条是 animal 类
        top_categories = [r.attributes.get("category") for r in tq.rows[:2]]
        assert "animal" in top_categories
    except Exception as e:
        report.log_fail("query.full_text.BM25", exc=e)
        cleanup_namespace()
        raise

    # 2) 混合搜索：multi_query + 简单 RRF（客户端融合）
    try:
        mq = _retry(
            lambda: asyncio.run(
                svc.multi_query(
                    namespace,
                    queries=[
                        {
                            "rank_by": ("vector", "ANN", [1.0, 0.0]),
                            "top_k": 3,
                            "include_attributes": ["title", "category"],
                        },
                        {
                            "rank_by": ("content", "BM25", "quick fox"),
                            "top_k": 3,
                            "include_attributes": ["title", "category"],
                        },
                    ],
                )
            )
        )
        assert len(mq.results) == 2
        ids_a = [str(r.id) for r in mq.results[0].rows]
        ids_b = [str(r.id) for r in mq.results[1].rows]
        fused = _rrf_rank(ids_a, ids_b)
        report.log_ok(
            "query.hybrid.multi_query.rrf",
            data={
                "subquery_vector_ids": ids_a,
                "subquery_bm25_ids": ids_b,
                "rrf_ranked_ids": fused,
            },
        )
        assert fused and fused[0] == "doc-0"
    except Exception as e:
        report.log_fail("query.hybrid.multi_query.rrf", exc=e)
        cleanup_namespace()
        raise

    # 4) filters + lookup（rank_by=id asc）
    try:
        fq = _retry(
            lambda: asyncio.run(
                svc.query(
                    namespace,
                    rank_by=("id", "asc"),
                    top_k=10,
                    filters=("category", "Eq", "food"),
                    include_attributes=["title", "category", "views"],
                )
            )
        )
        report.log_ok("query.filters.lookup", data={"rows": _rows_brief(fq.rows)})
        assert fq.rows
        assert all(r.attributes.get("category") == "food" for r in fq.rows)
    except Exception as e:
        report.log_fail("query.filters.lookup", exc=e)
        cleanup_namespace()
        raise

    # 4) aggregations + group_by（对齐 query.md 的聚合能力）
    try:
        agg = _retry(
            lambda: asyncio.run(
                svc.query(
                    namespace,
                    aggregate_by={"my_count": ("Count",)},
                    filters=("id", "Gte", "doc-0"),
                )
            )
        )
        report.log_ok("query.aggregations.count", data=agg.model_dump())
        assert agg.aggregations is not None
        assert "my_count" in agg.aggregations

        grp = _retry(
            lambda: asyncio.run(
                svc.query(
                    namespace,
                    aggregate_by={"count_by_category": ("Count",)},
                    group_by=["category"],
                    top_k=10,
                )
            )
        )
        report.log_ok("query.aggregations.group_by", data=grp.model_dump())
        assert grp.aggregation_groups is not None
        categories = {g.get("category") for g in grp.aggregation_groups}
        assert "animal" in categories and "food" in categories
    except Exception as e:
        report.log_fail("query.aggregations", exc=e)
        cleanup_namespace()
        raise

    # 4) patch_by_filter：把 views <= 100 的 published 标记为 archived
    try:
        patch_resp = asyncio.run(
            svc.write(
                namespace,
                patch_by_filter={
                    "filters": ("And", [("status", "Eq", "published"), ("views", "Lte", 100)]),
                    "patch": {"status": "archived"},
                },
            )
        )
        report.log_ok("write.patch_by_filter", data=patch_resp.model_dump())

        verify = _retry(
            lambda: asyncio.run(
                svc.query(
                    namespace,
                    rank_by=("id", "asc"),
                    top_k=10,
                    include_attributes=["status", "views"],
                )
            )
        )
        archived_ids = [
            str(r.id)
            for r in verify.rows
            if r.attributes.get("status") == "archived"
        ]
        report.log_ok("verify.patch_by_filter", data={"archived_ids": archived_ids})
        assert "doc-0" in archived_ids
        assert "doc-1" in archived_ids
        assert "doc-3" in archived_ids
    except Exception as e:
        report.log_fail("write.patch_by_filter", exc=e)
        cleanup_namespace()
        raise

    # 4) delete_by_filter：删除 food 类别里 views <= 10 的文档（应命中 doc-3）
    try:
        del_resp = asyncio.run(
            svc.write(
                namespace,
                delete_by_filter=("And", [("category", "Eq", "food"), ("views", "Lte", 10)]),
            )
        )
        report.log_ok("write.delete_by_filter", data=del_resp.model_dump())

        verify2 = _retry(
            lambda: asyncio.run(
                svc.query(namespace, rank_by=("id", "asc"), top_k=10, include_attributes=["category", "views"])
            )
        )
        remaining_ids = [str(r.id) for r in verify2.rows]
        report.log_ok("verify.delete_by_filter", data={"remaining_ids": remaining_ids})
        assert "doc-3" not in remaining_ids
    except Exception as e:
        report.log_fail("write.delete_by_filter", exc=e)
        cleanup_namespace()
        raise

    # 4) list namespaces：确认能通过 prefix 找到本次 namespace（带简单重试）
    try:
        ns_list = _retry(lambda: asyncio.run(svc.list_namespaces(prefix=ns_prefix, page_size=100)))
        ids = [n.id for n in ns_list.namespaces]
        report.log_ok("namespaces.list", data={"prefix": ns_prefix, "namespaces": ids})
        assert namespace in ids
    except Exception as e:
        report.log_fail("namespaces.list", exc=e)
        cleanup_namespace()
        raise

    finally:
        # 不做删除：把 namespace 持久化，方便你去后台核对写入/修改是否生效
        try:
            payload = {
                "namespace": namespace,
                "region": cfg.region,
                "created_at_utc": datetime.now(timezone.utc).isoformat(),
            }
            last_ns_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
            report.log_ok(
                "namespace.persist_for_manual_review",
                details={"path": str(last_ns_path), "namespace": namespace},
            )
        except Exception as e:
            # 不因为写文件失败而让 e2e 主流程失败
            report.log_fail("namespace.persist_for_manual_review", exc=e)
        report.finalize(
            summary={
                "namespace": namespace,
                "deleted": False,
                "next_step": "run delete test when ready",
            }
        )


@pytest.mark.e2e
def test_turbopuffer_e2e_delete_namespace_from_last_run() -> None:
    """
    删除上一次 `test_turbopuffer_e2e_query_write_keep_namespace` 生成的 namespace。

    读取顺序：
    1) 环境变量 `TURBOPUFFER_E2E_NAMESPACE_TO_DELETE`（手动指定时用）
    2) 本文件目录下 `.last_namespace.json`
    """

    report = E2EReporter(suite_name="turbopuffer-e2e")

    project_root = Path(__file__).resolve().parents[3]  # backend/
    env_path = project_root / ".env"
    loaded_env = False
    if env_path.exists():
        loaded_env = load_dotenv(dotenv_path=env_path, override=False)
        report.log_ok(
            "dotenv.load",
            details={"env_path": str(env_path), "loaded": bool(loaded_env)},
        )
    else:
        report.log_ok(
            "dotenv.load",
            details={"env_path": str(env_path), "loaded": False, "note": ".env not found"},
        )

    cfg = TurbopufferConfig()
    if not cfg.configured:
        report.log_ok(
            "skip.missing_turbopuffer_api_key",
            details={
                "reason": "TURBOPUFFER_API_KEY is not set (or empty) in current process environment",
                "expected_env_var": "TURBOPUFFER_API_KEY",
                "dotenv_loaded": bool(loaded_env),
            },
        )
        report.finalize(summary={"skipped": True})
        pytest.skip("未检测到 TURBOPUFFER_API_KEY，跳过 turbopuffer e2e 删除测试")

    last_ns_path = Path(__file__).with_name(".last_namespace.json")
    namespace = (os.environ.get("TURBOPUFFER_E2E_NAMESPACE_TO_DELETE") or "").strip()
    source = "env:TURBOPUFFER_E2E_NAMESPACE_TO_DELETE"
    if not namespace:
        if not last_ns_path.exists():
            report.log_ok(
                "skip.missing_last_namespace",
                details={
                    "reason": "no namespace provided and .last_namespace.json not found",
                    "env_var": "TURBOPUFFER_E2E_NAMESPACE_TO_DELETE",
                    "expected_file": str(last_ns_path),
                },
            )
            report.finalize(summary={"skipped": True})
            pytest.skip("未找到要删除的 namespace（请先运行 keep_namespace 测试）")
        try:
            payload = json.loads(last_ns_path.read_text())
            namespace = str(payload.get("namespace") or "").strip()
            source = f"file:{last_ns_path}"
        except Exception as e:
            report.log_fail("last_namespace.read", exc=e)
            report.finalize(summary={"skipped": True})
            pytest.skip("读取 .last_namespace.json 失败（请重新运行 keep_namespace 测试）")

    if not namespace:
        report.log_ok(
            "skip.invalid_namespace",
            details={"reason": "namespace empty after reading", "source": source},
        )
        report.finalize(summary={"skipped": True})
        pytest.skip("namespace 为空，跳过删除测试")

    svc = TurbopufferSearchService(config=cfg)
    report.log_ok(
        "delete.env.configured",
        details={"region": cfg.region, "namespace": namespace, "source": source},
    )

    # 3) delete namespace，并验证再次访问会 NotFound
    try:
        try:
            asyncio.run(svc.delete_namespace(namespace))
            report.log_ok("namespace.delete_namespace")
        except TurbopufferNotFound:
            # 允许重复运行 delete test
            report.log_ok("namespace.delete_namespace", details={"already_deleted": True})

        # 删除后，metadata 应该 NotFound（若 API 最终一致性导致短暂可见，会重试）
        def _call_meta() -> Any:
            return asyncio.run(svc.metadata(namespace))

        try:
            _retry(
                _call_meta,
                attempts=3,
                delay_seconds=1.0,
                retry_on=(TurbopufferRequestError,),
            )
            raise AssertionError("namespace 删除后 metadata 仍可访问（预期 NotFound）")
        except TurbopufferNotFound:
            pass
        report.log_ok("namespace.delete.verify_not_found")
    except Exception as e:
        report.log_fail("namespace.delete", exc=e)
        raise
    finally:
        report.finalize(summary={"namespace": namespace, "deleted": True, "source": source})
