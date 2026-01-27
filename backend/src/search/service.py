from __future__ import annotations

import asyncio
import datetime as dt
import time
from dataclasses import dataclass
from typing import Any, Iterable, Optional

from src.chunking.config import ChunkingConfig
from src.chunking.repository import ChunkRepository, ensure_chunks_for_pointer
from src.chunking.schemas import Chunk
from src.chunking.service import ChunkingService, iter_large_string_nodes_for_chunking
from src.content_node.service import ContentNodeService
from src.llm.embedding_service import EmbeddingService
from src.turbopuffer.schemas import TurbopufferRow
from src.turbopuffer.service import TurbopufferSearchService
from src.utils.logger import log_info


def _normalize_json_pointer(pointer: str) -> str:
    p = (pointer or "").strip()
    if not p:
        return ""
    if not p.startswith("/"):
        # 这里不强制抛错，保持兼容；但内部我们统一用 RFC6901 绝对指针
        p = "/" + p
    return p


def _extract_by_pointer(data: Any, pointer: str) -> Any:
    """
    从 JSON 数据中提取指定 JSON Pointer 路径的子数据。
    """
    if not pointer or pointer == "/":
        return data
    
    segments = [s for s in pointer.split("/") if s]
    current = data
    for seg in segments:
        if current is None:
            return None
        if isinstance(current, list):
            try:
                idx = int(seg)
                if 0 <= idx < len(current):
                    current = current[idx]
                else:
                    return None
            except ValueError:
                return None
        elif isinstance(current, dict):
            current = current.get(seg)
        else:
            return None
    return current


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
    - index_tool: (node_id, json_path) scope -> chunking -> embedding -> turbopuffer upsert
    - search_tool: ANN -> 结构化输出（chunk_text 通过 DB 回填）
    """

    def __init__(
        self,
        *,
        node_service: ContentNodeService,
        chunk_repo: ChunkRepository,
        chunking_service: ChunkingService | None = None,
        chunking_config: ChunkingConfig | None = None,
        embedding_service: EmbeddingService | None = None,
        turbopuffer_service: TurbopufferSearchService | None = None,
    ) -> None:
        self._node_service = node_service
        self._chunk_repo = chunk_repo
        self._chunking_service = chunking_service or ChunkingService()
        self._chunking_config = chunking_config or ChunkingConfig()
        self._embedding = embedding_service or EmbeddingService()
        self._tp = turbopuffer_service or TurbopufferSearchService()

    @staticmethod
    def build_namespace(*, project_id: str, node_id: str) -> str:
        return f"project_{project_id}_node_{node_id}"

    @staticmethod
    def build_doc_id(
        *, node_id: str, json_pointer: str, content_hash: str, chunk_index: int
    ) -> str:
        # Turbopuffer 要求 ID 最多 64 字节，所以用 hash 来压缩 json_pointer
        import hashlib

        pointer_hash = hashlib.md5(json_pointer.encode("utf-8")).hexdigest()[:12]
        # 格式: {node_id[:12]}_{pointer_hash}_{content_hash[:8]}_{chunk_index}
        # UUID 太长，截取前12位
        return f"{node_id[:12]}_{pointer_hash}_{content_hash[:8]}_{chunk_index}"

    async def ensure_namespace_schema(self, *, namespace: str) -> None:
        # 兼容保留：当前实现不再依赖 turbopuffer 的 BM25，因此无需 schema。
        # 若未来重新引入 BM25，可在此恢复 update_schema。
        _ = namespace
        return None

    async def index_scope(
        self,
        *,
        project_id: str,
        node_id: str,
        user_id: str,
        json_path: str,
    ) -> SearchIndexStats:
        """
        从 (node_id, json_path) 读取 scope 数据并完成 indexing。
        """
        t0 = time.perf_counter()
        scope_pointer = _normalize_json_pointer(json_path)
        log_info(
            f"[index_scope] start: project_id={project_id} node_id={node_id} json_path='{json_path}'"
        )

        # 1) 读取 scope 数据（从 content_nodes 获取）
        t1 = time.perf_counter()
        node = await asyncio.to_thread(
            self._node_service.get_by_id, node_id, user_id
        )
        # 从 node.content 获取 JSON 数据，然后提取指定路径的子数据
        full_data = node.content or {}
        scope_data = _extract_by_pointer(full_data, scope_pointer)
        log_info(
            f"[index_scope] step1_get_scope_data: node_id={node_id} elapsed_ms={int((time.perf_counter() - t1) * 1000)}"
        )

        # 2) 提取大字符串节点（json_pointer 必须是"绝对指针"）
        t2 = time.perf_counter()
        nodes = await asyncio.to_thread(
            lambda: list(
                iter_large_string_nodes_for_chunking(
                    self._chunking_service,
                    scope_data,
                    self._chunking_config,
                    base_pointer=scope_pointer,
                )
            )
        )
        log_info(
            f"[index_scope] step2_extract_nodes: node_id={node_id} nodes_count={len(nodes)} elapsed_ms={int((time.perf_counter() - t2) * 1000)}"
        )

        # 没有大文本：保持成功，但无需写入 turbopuffer
        if not nodes:
            log_info(
                f"[index_scope] done_no_nodes: node_id={node_id} total_ms={int((time.perf_counter() - t0) * 1000)}"
            )
            return SearchIndexStats(
                nodes_count=0, chunks_count=0, indexed_chunks_count=0
            )

        # 3) ensure chunks（幂等）
        t3 = time.perf_counter()
        all_chunks: list[Chunk] = []
        for i, n in enumerate(nodes):
            ensured = await asyncio.to_thread(
                ensure_chunks_for_pointer,
                repo=self._chunk_repo,
                service=self._chunking_service,
                node_id=node_id,
                json_pointer=n.json_pointer,
                content=n.content,
                config=self._chunking_config,
            )
            all_chunks.extend(list(ensured.chunks))
            if (i + 1) % 10 == 0:
                log_info(
                    f"[index_scope] step3_chunking_progress: node_id={node_id} processed={i + 1}/{len(nodes)}"
                )
        log_info(
            f"[index_scope] step3_ensure_chunks: node_id={node_id} chunks_count={len(all_chunks)} elapsed_ms={int((time.perf_counter() - t3) * 1000)}"
        )

        if not all_chunks:
            log_info(
                f"[index_scope] done_no_chunks: node_id={node_id} nodes={len(nodes)} total_ms={int((time.perf_counter() - t0) * 1000)}"
            )
            return SearchIndexStats(
                nodes_count=len(nodes), chunks_count=0, indexed_chunks_count=0
            )

        # 4) embedding（批量）
        t4 = time.perf_counter()
        texts = [c.chunk_text for c in all_chunks]
        log_info(
            f"[index_scope] step4_embedding_start: node_id={node_id} texts_count={len(texts)}"
        )
        vectors = await self._embedding.generate_embeddings_batch(texts)
        log_info(
            f"[index_scope] step4_embedding_done: node_id={node_id} vectors_count={len(vectors)} elapsed_ms={int((time.perf_counter() - t4) * 1000)}"
        )

        # 5) turbopuffer upsert（批量）
        # 注意：write 带 schema 参数会自动创建 namespace，支持增量更新
        t5 = time.perf_counter()
        namespace = self.build_namespace(project_id=project_id, node_id=node_id)

        upsert_rows: list[dict[str, Any]] = []
        doc_ids: list[str] = []
        for c, vec in zip(all_chunks, vectors, strict=True):
            doc_id = self.build_doc_id(
                node_id=c.node_id,
                json_pointer=c.json_pointer,
                content_hash=c.content_hash,
                chunk_index=c.chunk_index,
            )
            doc_ids.append(doc_id)
            upsert_rows.append(
                {
                    "id": doc_id,
                    "vector": vec,
                    # metadata（用于回填 chunk_text 与定位）
                    "json_pointer": c.json_pointer,
                    "chunk_index": c.chunk_index,
                    "total_chunks": c.total_chunks,
                    "char_start": c.char_start,
                    "char_end": c.char_end,
                    "content_hash": c.content_hash,
                    "chunk_id": int(c.id),
                }
            )

        log_info(
            f"[index_scope] step5_turbopuffer_write_start: node_id={node_id} rows_count={len(upsert_rows)}"
        )
        await self._tp.write(
            namespace,
            upsert_rows=upsert_rows,
            distance_metric="cosine_distance",
        )
        log_info(
            f"[index_scope] step5_turbopuffer_done: node_id={node_id} elapsed_ms={int((time.perf_counter() - t5) * 1000)}"
        )

        # 6) 回写 chunks 表的 turbopuffer 字段（best-effort）
        t6 = time.perf_counter()
        for c, doc_id in zip(all_chunks, doc_ids, strict=True):
            try:
                await asyncio.to_thread(
                    lambda: (
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
                )
            except Exception:
                # 不阻断 indexing：后续可通过重建/补齐逻辑再修复
                pass
        log_info(
            f"[index_scope] step6_update_chunks_done: node_id={node_id} elapsed_ms={int((time.perf_counter() - t6) * 1000)}"
        )

        log_info(
            f"[index_scope] done: node_id={node_id} nodes={len(nodes)} chunks={len(all_chunks)} total_ms={int((time.perf_counter() - t0) * 1000)}"
        )
        return SearchIndexStats(
            nodes_count=len(nodes),
            chunks_count=len(all_chunks),
            indexed_chunks_count=len(all_chunks),
        )

    async def search_scope(
        self,
        *,
        project_id: str,
        node_id: str,
        tool_json_path: str,
        query: str,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """
        在 namespace 上执行向量 ANN 检索，返回 rows（chunk_text 通过 DB 回填）。
        """
        q = (query or "").strip()
        if not q:
            raise ValueError("query must be non-empty")

        top_k = int(top_k)
        if top_k <= 0:
            raise ValueError("top_k must be > 0")
        if top_k > 20:
            top_k = 20

        namespace = self.build_namespace(project_id=project_id, node_id=node_id)

        query_vec = await self._embedding.generate_embedding(q)
        resp = await self._tp.query(
            namespace,
            rank_by=("vector", "ANN", query_vec),
            top_k=top_k,
            include_attributes=True,
        )
        rows = resp.rows or []
        scope_base = _normalize_json_pointer(tool_json_path)

        # 批量回填 chunk_text（避免在 turbopuffer 存储冗余大字段）
        chunk_ids: list[int] = []
        for r in rows[:top_k]:
            attrs = r.attributes or {}
            cid = attrs.get("chunk_id")
            try:
                if cid is not None:
                    chunk_ids.append(int(cid))
            except (TypeError, ValueError):
                pass
        chunks = await asyncio.to_thread(self._chunk_repo.get_by_ids, chunk_ids)
        chunk_text_by_id = {int(c.id): c.chunk_text for c in chunks}

        out: list[dict[str, Any]] = []
        for r in rows[:top_k]:
            attrs = r.attributes or {}
            json_pointer = str(attrs.get("json_pointer") or "")
            json_pointer = _normalize_json_pointer(json_pointer)
            json_path = _relative_pointer(base=scope_base, absolute=json_pointer)

            # 仅返回对 Agent 有用的字段
            # 移除内部字段: node_id, content_hash, turbopuffer_namespace, turbopuffer_doc_id, char_start, char_end
            cid = attrs.get("chunk_id")
            chunk_id_int: int | None = None
            try:
                if cid is not None:
                    chunk_id_int = int(cid)
            except (TypeError, ValueError):
                chunk_id_int = None

            # 尽量用 score；否则用距离构造一个单调分数（越接近越大）
            score = None
            if r.score is not None:
                score = float(r.score)
            elif r.distance is not None:
                try:
                    dist = float(r.distance)
                    score = 1.0 / (1.0 + dist)
                except (TypeError, ValueError):
                    score = 0.0
            else:
                score = 0.0

            out.append(
                {
                    "score": float(score),
                    "json_path": json_path,
                    "chunk": {
                        "id": chunk_id_int,
                        "json_pointer": json_pointer,
                        "chunk_index": int(attrs.get("chunk_index") or 0),
                        "total_chunks": int(attrs.get("total_chunks") or 0),
                        "chunk_text": (
                            chunk_text_by_id.get(chunk_id_int, "")
                            if chunk_id_int is not None
                            else ""
                        ),
                    },
                }
            )

        return out

    @staticmethod
    def now_iso() -> str:
        return dt.datetime.now(tz=dt.timezone.utc).isoformat()
