from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional

from src.chunking.config import ChunkingConfig
from src.chunking.repository import ChunkRepository, ensure_chunks_for_pointer
from src.chunking.schemas import Chunk
from src.chunking.service import ChunkingService, iter_large_string_nodes_for_chunking
from src.content_node.models import ContentNode
from src.content_node.service import ContentNodeService
from src.llm.embedding_service import EmbeddingService
from src.s3.service import S3Service
from src.turbopuffer.schemas import TurbopufferRow
from src.turbopuffer.service import TurbopufferSearchService
from src.utils.logger import log_info, log_error


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


@dataclass(frozen=True)
class FolderIndexStats:
    """Folder search indexing statistics"""
    total_files: int
    indexed_files: int
    nodes_count: int  # Total large string nodes across all files
    chunks_count: int  # Total chunks created
    indexed_chunks_count: int  # Total chunks indexed to turbopuffer


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
    def build_folder_namespace(*, project_id: str, folder_node_id: str) -> str:
        """Build namespace for folder search"""
        return f"project_{project_id}_folder_{folder_node_id}"

    @staticmethod
    def build_doc_id(
        *, node_id: str, json_pointer: str, content_hash: str, chunk_index: int
    ) -> str:
        # Turbopuffer 要求 ID 最多 64 字节，所以用 hash 来压缩 json_pointer
        pointer_hash = hashlib.md5(json_pointer.encode("utf-8")).hexdigest()[:12]
        # 格式: {node_id[:12]}_{pointer_hash}_{content_hash[:8]}_{chunk_index}
        # UUID 太长，截取前12位
        return f"{node_id[:12]}_{pointer_hash}_{content_hash[:8]}_{chunk_index}"

    @staticmethod
    def build_folder_doc_id(
        *, file_node_id: str, json_pointer: str, content_hash: str, chunk_index: int
    ) -> str:
        """
        Build doc_id for folder search.
        Similar to build_doc_id but uses file_node_id to distinguish files.
        """
        pointer_hash = hashlib.md5(json_pointer.encode("utf-8")).hexdigest()[:12]
        # 格式: {file_node_id[:12]}_{pointer_hash}_{content_hash[:8]}_{chunk_index}
        return f"{file_node_id[:12]}_{pointer_hash}_{content_hash[:8]}_{chunk_index}"

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
            self._node_service.get_by_id, node_id, project_id
        )
        # 从 node.json_content 获取 JSON 数据，然后提取指定路径的子数据
        full_data = node.json_content or {}
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

    # ==================== Folder Search Methods ====================

    async def index_folder(
        self,
        *,
        project_id: str,
        folder_node_id: str,
        user_id: str,
        s3_service: S3Service,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> FolderIndexStats:
        """
        Index all indexable files in a folder for vector search.
        
        Args:
            project_id: Project ID
            folder_node_id: The folder node ID to index
            user_id: User ID for permission checks
            s3_service: S3 service for reading file content
            progress_callback: Optional callback(indexed_files, total_files) for progress updates
        
        Returns:
            FolderIndexStats with indexing statistics
        """
        t0 = time.perf_counter()
        log_info(
            f"[index_folder] start: project_id={project_id} folder_node_id={folder_node_id}"
        )

        # 1) Get all indexable descendants
        t1 = time.perf_counter()
        indexable_files = await asyncio.to_thread(
            self._node_service.list_indexable_descendants,
            project_id,
            folder_node_id,
        )
        total_files = len(indexable_files)
        log_info(
            f"[index_folder] step1_get_indexable_files: folder_node_id={folder_node_id} "
            f"total_files={total_files} elapsed_ms={int((time.perf_counter() - t1) * 1000)}"
        )

        if not indexable_files:
            log_info(
                f"[index_folder] done_no_files: folder_node_id={folder_node_id} "
                f"total_ms={int((time.perf_counter() - t0) * 1000)}"
            )
            return FolderIndexStats(
                total_files=0,
                indexed_files=0,
                nodes_count=0,
                chunks_count=0,
                indexed_chunks_count=0,
            )

        # 2) Process each file
        namespace = self.build_folder_namespace(
            project_id=project_id, folder_node_id=folder_node_id
        )
        
        total_nodes = 0
        total_chunks = 0
        total_indexed = 0
        indexed_files = 0

        for i, file_node in enumerate(indexable_files):
            try:
                t_file = time.perf_counter()
                stats = await self._index_file_node(
                    file_node=file_node,
                    namespace=namespace,
                    s3_service=s3_service,
                )
                total_nodes += stats.nodes_count
                total_chunks += stats.chunks_count
                total_indexed += stats.indexed_chunks_count
                indexed_files += 1

                log_info(
                    f"[index_folder] file_indexed: {i + 1}/{total_files} "
                    f"file_node_id={file_node.id} name={file_node.name} "
                    f"chunks={stats.chunks_count} elapsed_ms={int((time.perf_counter() - t_file) * 1000)}"
                )

                # Call progress callback if provided
                if progress_callback:
                    try:
                        progress_callback(indexed_files, total_files)
                    except Exception as e:
                        log_error(f"[index_folder] progress_callback error: {e}")

            except Exception as e:
                log_error(
                    f"[index_folder] file_error: file_node_id={file_node.id} "
                    f"name={file_node.name} error={e}"
                )
                # Continue with other files even if one fails
                continue

        log_info(
            f"[index_folder] done: folder_node_id={folder_node_id} "
            f"files={indexed_files}/{total_files} nodes={total_nodes} "
            f"chunks={total_chunks} total_ms={int((time.perf_counter() - t0) * 1000)}"
        )

        return FolderIndexStats(
            total_files=total_files,
            indexed_files=indexed_files,
            nodes_count=total_nodes,
            chunks_count=total_chunks,
            indexed_chunks_count=total_indexed,
        )

    async def _index_file_node(
        self,
        *,
        file_node: ContentNode,
        namespace: str,
        s3_service: S3Service,
    ) -> SearchIndexStats:
        """
        Index a single file node (json or markdown) into the folder namespace.
        
        Args:
            file_node: The file node to index
            namespace: Turbopuffer namespace for the folder
            s3_service: S3 service for reading markdown content
        
        Returns:
            SearchIndexStats for this file
        """
        t0 = time.perf_counter()

        # 1) Read file content based on type
        is_markdown = file_node.type == "markdown" or file_node.preview_type == "markdown"
        is_json = file_node.type == "json" or file_node.preview_type == "json"
        
        if is_json:
            # JSON content is stored in node.json_content
            content_data = file_node.json_content or {}
            # Use root pointer for JSON files in folder context
            scope_pointer = ""
        elif is_markdown:
            # Markdown content: prefer md_content, fallback to S3
            if file_node.md_content:
                content_data = file_node.md_content
                scope_pointer = "/"
            elif file_node.s3_key:
                try:
                    content_bytes = await s3_service.download_file(file_node.s3_key)
                    content_text = content_bytes.decode("utf-8")
                    content_data = content_text
                    scope_pointer = "/"
                except Exception as e:
                    log_error(f"[_index_file_node] s3_download_error: {file_node.id} error={e}")
                    return SearchIndexStats(nodes_count=0, chunks_count=0, indexed_chunks_count=0)
            else:
                log_info(f"[_index_file_node] skip: no content for markdown node {file_node.id}")
                return SearchIndexStats(nodes_count=0, chunks_count=0, indexed_chunks_count=0)
        else:
            # Unsupported type
            log_info(f"[_index_file_node] skip: unsupported type={file_node.type} preview_type={file_node.preview_type}")
            return SearchIndexStats(nodes_count=0, chunks_count=0, indexed_chunks_count=0)

        # 2) Extract large string nodes or use content directly
        t2 = time.perf_counter()
        if is_json:
            # For JSON, extract large string nodes
            nodes = await asyncio.to_thread(
                lambda: list(
                    iter_large_string_nodes_for_chunking(
                        self._chunking_service,
                        content_data,
                        self._chunking_config,
                        base_pointer=scope_pointer,
                    )
                )
            )
        else:
            # For markdown, create a single "node" with the whole content
            from src.chunking.schemas import LargeStringNode
            if len(content_data) >= self._chunking_config.chunk_threshold_chars:
                nodes = [LargeStringNode(json_pointer="/", content=content_data)]
            else:
                nodes = []

        log_info(
            f"[_index_file_node] extract_nodes: file={file_node.id} nodes={len(nodes)} "
            f"elapsed_ms={int((time.perf_counter() - t2) * 1000)}"
        )

        if not nodes:
            return SearchIndexStats(nodes_count=0, chunks_count=0, indexed_chunks_count=0)

        # 3) Ensure chunks (idempotent)
        t3 = time.perf_counter()
        all_chunks: list[Chunk] = []
        for n in nodes:
            ensured = await asyncio.to_thread(
                ensure_chunks_for_pointer,
                repo=self._chunk_repo,
                service=self._chunking_service,
                node_id=file_node.id,  # Use file node ID, not folder ID
                json_pointer=n.json_pointer,
                content=n.content,
                config=self._chunking_config,
            )
            all_chunks.extend(list(ensured.chunks))

        log_info(
            f"[_index_file_node] ensure_chunks: file={file_node.id} chunks={len(all_chunks)} "
            f"elapsed_ms={int((time.perf_counter() - t3) * 1000)}"
        )

        if not all_chunks:
            return SearchIndexStats(
                nodes_count=len(nodes), chunks_count=0, indexed_chunks_count=0
            )

        # 4) Generate embeddings
        t4 = time.perf_counter()
        texts = [c.chunk_text for c in all_chunks]
        vectors = await self._embedding.generate_embeddings_batch(texts)
        log_info(
            f"[_index_file_node] embedding: file={file_node.id} vectors={len(vectors)} "
            f"elapsed_ms={int((time.perf_counter() - t4) * 1000)}"
        )

        # 5) Turbopuffer upsert with file metadata
        t5 = time.perf_counter()
        upsert_rows: list[dict[str, Any]] = []
        doc_ids: list[str] = []

        for c, vec in zip(all_chunks, vectors, strict=True):
            doc_id = self.build_folder_doc_id(
                file_node_id=file_node.id,
                json_pointer=c.json_pointer,
                content_hash=c.content_hash,
                chunk_index=c.chunk_index,
            )
            doc_ids.append(doc_id)
            upsert_rows.append(
                {
                    "id": doc_id,
                    "vector": vec,
                    # Existing metadata fields
                    "json_pointer": c.json_pointer,
                    "chunk_index": c.chunk_index,
                    "total_chunks": c.total_chunks,
                    "char_start": c.char_start,
                    "char_end": c.char_end,
                    "content_hash": c.content_hash,
                    "chunk_id": int(c.id),
                    # Folder search specific fields
                    "file_node_id": file_node.id,
                    "file_id_path": file_node.id_path,
                    "file_name": file_node.name,
                    "file_type": file_node.type,
                }
            )

        await self._tp.write(
            namespace,
            upsert_rows=upsert_rows,
            distance_metric="cosine_distance",
        )
        log_info(
            f"[_index_file_node] turbopuffer: file={file_node.id} rows={len(upsert_rows)} "
            f"elapsed_ms={int((time.perf_counter() - t5) * 1000)}"
        )

        # 6) Update chunks table with turbopuffer info (best-effort)
        for c, doc_id in zip(all_chunks, doc_ids, strict=True):
            try:
                await asyncio.to_thread(
                    lambda cid=int(c.id), did=doc_id: (
                        self._chunk_repo._client.table("chunks")
                        .update(
                            {
                                "turbopuffer_namespace": namespace,
                                "turbopuffer_doc_id": did,
                            }
                        )
                        .eq("id", cid)
                        .execute()
                    )
                )
            except Exception:
                pass  # Don't block on chunk update failures

        log_info(
            f"[_index_file_node] done: file={file_node.id} "
            f"total_ms={int((time.perf_counter() - t0) * 1000)}"
        )

        return SearchIndexStats(
            nodes_count=len(nodes),
            chunks_count=len(all_chunks),
            indexed_chunks_count=len(all_chunks),
        )

    async def search_folder(
        self,
        *,
        project_id: str,
        folder_node_id: str,
        query: str,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Search in a folder namespace, returning results with file path information.
        
        Args:
            project_id: Project ID
            folder_node_id: The folder node ID
            query: Search query
            top_k: Number of results to return (max 20)
        
        Returns:
            List of search results with file and chunk information
        """
        q = (query or "").strip()
        if not q:
            raise ValueError("query must be non-empty")

        top_k = int(top_k)
        if top_k <= 0:
            raise ValueError("top_k must be > 0")
        if top_k > 20:
            top_k = 20

        namespace = self.build_folder_namespace(
            project_id=project_id, folder_node_id=folder_node_id
        )

        # 1) Generate query embedding and search
        query_vec = await self._embedding.generate_embedding(q)
        resp = await self._tp.query(
            namespace,
            rank_by=("vector", "ANN", query_vec),
            top_k=top_k,
            include_attributes=True,
        )
        rows = resp.rows or []

        # 2) Batch fetch chunk_text from DB
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

        # 3) Build output with file information
        out: list[dict[str, Any]] = []
        for r in rows[:top_k]:
            attrs = r.attributes or {}
            
            # Extract file information
            file_node_id = str(attrs.get("file_node_id") or "")
            file_id_path = str(attrs.get("file_id_path") or "")
            file_name = str(attrs.get("file_name") or "")
            file_type = str(attrs.get("file_type") or "")
            
            # Extract chunk information
            json_pointer = str(attrs.get("json_pointer") or "")
            json_pointer = _normalize_json_pointer(json_pointer)
            
            cid = attrs.get("chunk_id")
            chunk_id_int: int | None = None
            try:
                if cid is not None:
                    chunk_id_int = int(cid)
            except (TypeError, ValueError):
                chunk_id_int = None

            # Calculate score
            score = 0.0
            if r.score is not None:
                score = float(r.score)
            elif r.distance is not None:
                try:
                    dist = float(r.distance)
                    score = 1.0 / (1.0 + dist)
                except (TypeError, ValueError):
                    score = 0.0

            out.append(
                {
                    "score": float(score),
                    "file": {
                        "node_id": file_node_id,
                        "id_path": file_id_path,
                        "name": file_name,
                        "type": file_type,
                    },
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
