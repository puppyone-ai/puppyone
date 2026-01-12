from __future__ import annotations

import datetime as dt
import urllib.parse
from dataclasses import dataclass
from typing import Any, Iterable

from src.chunking.repository import ChunkRepository, ensure_chunks_for_pointer
from src.chunking.schemas import Chunk, ChunkingConfig
from src.chunking.service import ChunkingService, iter_large_string_nodes_for_chunking
from src.llm.embedding_service import EmbeddingService
from src.table.service import TableService
from src.turbopuffer.schemas import TurbopufferRow
from src.turbopuffer.service import TurbopufferSearchService


def _normalize_json_pointer(pointer: str) -> str:
    p = (pointer or "").strip()
    if not p:
        return ""
    if not p.startswith("/"):
        # 这里不强制抛错，保持兼容；但内部我们统一用 RFC6901 绝对指针
        p = "/" + p
    return p


def _relative_pointer(*, base: str, absolute: str) -> str:
    """
    将绝对 json_pointer 转为相对于 base 的路径（两者均为 RFC6901）。

    例：
    - base="/articles", absolute="/articles/0/content" -> "/0/content"
    - base="", absolute="/a/b" -> "/a/b"
    """
    b = _normalize_json_pointer(base)
    a = _normalize_json_pointer(absolute)
    if not b:
        return a
    if a == b:
        return ""
    prefix = b + "/"
    if a.startswith(prefix):
        return a[len(b) :]
    # 不在 scope 内：保持返回绝对路径（更利于排障；也避免误导）
    return a


def reciprocal_rank_fusion(
    result_lists: Iterable[Iterable[TurbopufferRow]], *, k: int = 60
) -> list[tuple[TurbopufferRow, float]]:
    """
    RRF (Reciprocal Rank Fusion)
    - score(doc) = Σ 1 / (k + rank)
    """
    if k <= 0:
        raise ValueError("k must be > 0")

    scores: dict[int | str, float] = {}
    items: dict[int | str, TurbopufferRow] = {}

    for results in result_lists:
        for rank, row in enumerate(results, start=1):
            doc_id = row.id
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
            # 保留一份 row（属性一致即可；不同 query 的 row attributes 通常相同）
            items[doc_id] = row

    # 按融合分数排序（高到低）
    return [
        (items[doc_id], score)
        for doc_id, score in sorted(scores.items(), key=lambda x: x[1], reverse=True)
    ]


@dataclass(frozen=True)
class SearchIndexStats:
    nodes_count: int
    chunks_count: int
    indexed_chunks_count: int


class SearchService:
    """
    Search Tool 核心能力：
    - index_tool: (table_id, json_path) scope -> chunking -> embedding -> turbopuffer upsert
    - search_tool: hybrid (ANN + BM25) -> RRF -> 结构化输出
    """

    def __init__(
        self,
        *,
        table_service: TableService,
        chunk_repo: ChunkRepository,
        chunking_service: ChunkingService | None = None,
        chunking_config: ChunkingConfig | None = None,
        embedding_service: EmbeddingService | None = None,
        turbopuffer_service: TurbopufferSearchService | None = None,
    ) -> None:
        self._table_service = table_service
        self._chunk_repo = chunk_repo
        self._chunking_service = chunking_service or ChunkingService()
        self._chunking_config = chunking_config or ChunkingConfig()
        self._embedding = embedding_service or EmbeddingService()
        self._tp = turbopuffer_service or TurbopufferSearchService()

    @staticmethod
    def build_namespace(*, project_id: int, table_id: int) -> str:
        return f"project_{project_id}_table_{table_id}"

    @staticmethod
    def build_doc_id(
        *, table_id: int, json_pointer: str, content_hash: str, chunk_index: int
    ) -> str:
        pointer_encoded = urllib.parse.quote(json_pointer, safe="")
        return f"{table_id}:{pointer_encoded}:{content_hash[:12]}:chunk_{chunk_index}"

    async def ensure_namespace_schema(self, *, namespace: str) -> None:
        # 最小 schema：为 BM25 启用 full_text_search
        await self._tp.update_schema(
            namespace,
            schema={"content": {"type": "string", "full_text_search": True}},
        )

    async def index_scope(
        self,
        *,
        project_id: int,
        table_id: int,
        json_path: str,
    ) -> SearchIndexStats:
        """
        从 (table_id, json_path) 读取 scope 数据并完成 indexing。
        """
        scope_pointer = _normalize_json_pointer(json_path)

        # 1) 读取 scope 数据（同步 TableService）
        scope_data = self._table_service.get_context_data(table_id, scope_pointer)

        # 2) 提取大字符串节点（json_pointer 必须是“绝对指针”）
        nodes = list(
            iter_large_string_nodes_for_chunking(
                self._chunking_service,
                scope_data,
                self._chunking_config,
                base_pointer=scope_pointer,
            )
        )

        # 没有大文本：保持成功，但无需写入 turbopuffer
        if not nodes:
            return SearchIndexStats(
                nodes_count=0, chunks_count=0, indexed_chunks_count=0
            )

        # 3) ensure chunks（幂等）
        all_chunks: list[Chunk] = []
        for n in nodes:
            ensured = ensure_chunks_for_pointer(
                repo=self._chunk_repo,
                service=self._chunking_service,
                table_id=table_id,
                json_pointer=n.json_pointer,
                content=n.content,
                config=self._chunking_config,
            )
            all_chunks.extend(list(ensured.chunks))

        if not all_chunks:
            return SearchIndexStats(
                nodes_count=len(nodes), chunks_count=0, indexed_chunks_count=0
            )

        # 4) embedding（批量）
        texts = [c.chunk_text for c in all_chunks]
        vectors = await self._embedding.generate_embeddings_batch(texts)

        # 5) turbopuffer upsert（批量）
        namespace = self.build_namespace(project_id=project_id, table_id=table_id)
        await self.ensure_namespace_schema(namespace=namespace)

        upsert_rows: list[dict[str, Any]] = []
        doc_ids: list[str] = []
        for c, vec in zip(all_chunks, vectors, strict=True):
            doc_id = self.build_doc_id(
                table_id=c.table_id,
                json_pointer=c.json_pointer,
                content_hash=c.content_hash,
                chunk_index=c.chunk_index,
            )
            doc_ids.append(doc_id)
            upsert_rows.append(
                {
                    "id": doc_id,
                    "vector": vec,
                    # BM25 字段（全文检索）
                    "content": c.chunk_text,
                    # 其余 metadata 放 attributes（用于返回“完整 chunk 信息”）
                    "table_id": c.table_id,
                    "json_pointer": c.json_pointer,
                    "chunk_index": c.chunk_index,
                    "total_chunks": c.total_chunks,
                    "char_start": c.char_start,
                    "char_end": c.char_end,
                    "content_hash": c.content_hash,
                    "turbopuffer_namespace": namespace,
                    "turbopuffer_doc_id": doc_id,
                    "chunk_id": int(c.id),
                }
            )

        await self._tp.write(
            namespace,
            upsert_rows=upsert_rows,
            distance_metric="cosine_distance",
            # 再带一次 schema，保证首次写入即可用 BM25（与 docs 一致）
            schema={"content": {"type": "string", "full_text_search": True}},
        )

        # 6) 回写 chunks 表的 turbopuffer 字段（best-effort）
        for c, doc_id in zip(all_chunks, doc_ids, strict=True):
            try:
                (
                    self._chunk_repo._client.table("chunks")
                    .update(
                        {
                            "turbopuffer_namespace": namespace,
                            "turbopuffer_doc_id": doc_id,
                        }
                    )
                    .eq("id", int(c.id))
                    .execute()
                )
            except Exception:
                # 不阻断 indexing：后续可通过重建/补齐逻辑再修复
                pass

        return SearchIndexStats(
            nodes_count=len(nodes),
            chunks_count=len(all_chunks),
            indexed_chunks_count=len(all_chunks),
        )

    async def search_scope(
        self,
        *,
        project_id: int,
        table_id: int,
        tool_json_path: str,
        query: str,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """
        在 namespace 上执行 hybrid search，返回融合后的 rows（含 attributes）。
        """
        q = (query or "").strip()
        if not q:
            raise ValueError("query must be non-empty")

        top_k = int(top_k)
        if top_k <= 0:
            raise ValueError("top_k must be > 0")
        if top_k > 20:
            top_k = 20

        namespace = self.build_namespace(project_id=project_id, table_id=table_id)

        query_vec = await self._embedding.generate_embedding(q)
        resp = await self._tp.multi_query(
            namespace,
            queries=[
                {
                    "rank_by": ("vector", "ANN", query_vec),
                    "top_k": top_k,
                    "include_attributes": True,
                },
                {
                    "rank_by": ("content", "BM25", q),
                    "top_k": top_k,
                    "include_attributes": True,
                },
            ],
        )

        vector_rows = resp.results[0].rows if len(resp.results) > 0 else []
        bm25_rows = resp.results[1].rows if len(resp.results) > 1 else []

        fused = reciprocal_rank_fusion([vector_rows, bm25_rows], k=60)
        scope_base = _normalize_json_pointer(tool_json_path)

        out: list[dict[str, Any]] = []
        for row, score in fused[:top_k]:
            attrs = row.attributes or {}
            json_pointer = str(attrs.get("json_pointer") or "")
            json_pointer = _normalize_json_pointer(json_pointer)
            json_path = _relative_pointer(base=scope_base, absolute=json_pointer)

            out.append(
                {
                    "score": float(score),
                    "json_path": json_path,
                    "chunk": {
                        "id": attrs.get("chunk_id"),
                        "table_id": int(attrs.get("table_id") or table_id),
                        "json_pointer": json_pointer,
                        "chunk_index": int(attrs.get("chunk_index") or 0),
                        "total_chunks": int(attrs.get("total_chunks") or 0),
                        "chunk_text": str(attrs.get("content") or ""),
                        "char_start": int(attrs.get("char_start") or 0),
                        "char_end": int(attrs.get("char_end") or 0),
                        "content_hash": str(attrs.get("content_hash") or ""),
                        "turbopuffer_namespace": attrs.get("turbopuffer_namespace")
                        or namespace,
                        "turbopuffer_doc_id": attrs.get("turbopuffer_doc_id")
                        or str(row.id),
                    },
                }
            )

        return out

    @staticmethod
    def now_iso() -> str:
        return dt.datetime.now(tz=dt.timezone.utc).isoformat()
