"""
Chunking repository & idempotent ensure entrypoint.

This layer persists to Supabase/Postgres table: public.chunks
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, List, Optional

if TYPE_CHECKING:
    pass

from src.chunking.config import ChunkingConfig
from src.chunking.schemas import Chunk, ChunkCreate, EnsureChunksResult
from src.chunking.service import ChunkingService, compute_content_hash
from src.supabase.exceptions import handle_supabase_error
from src.utils.logger import log_info


class ChunkRepository:
    def __init__(self, client: Any):
        self._client = client

    def get_by_ids(self, ids: list[int]) -> list[Chunk]:
        """
        批量按 chunks.id 读取记录。

        说明：
        - Supabase SDK 的过滤 API 在不同版本里可能略有差异，这里优先使用 `in_`；
          若不可用则降级为逐条查询（top_k <= 20 时可接受）。
        """
        if not ids:
            return []

        uniq: list[int] = sorted({int(x) for x in ids if x is not None})
        if not uniq:
            return []

        q = self._client.table("chunks").select("*")
        if hasattr(q, "in_"):
            resp = q.in_("id", uniq).execute()
            return [Chunk(**row) for row in (resp.data or [])]

        # fallback：逐条读取（避免依赖不存在的批量 API）
        out: list[Chunk] = []
        for cid in uniq:
            resp = self._client.table("chunks").select("*").eq("id", cid).execute()
            rows = resp.data or []
            if rows:
                out.append(Chunk(**rows[0]))
        return out

    def get_by_hash(
        self, *, node_id: str, json_pointer: str, content_hash: str
    ) -> list[Chunk]:
        resp = (
            self._client.table("chunks")
            .select("*")
            .eq("node_id", node_id)
            .eq("json_pointer", json_pointer)
            .eq("content_hash", content_hash)
            .order("chunk_index")
            .execute()
        )
        return [Chunk(**row) for row in (resp.data or [])]

    def bulk_create(self, chunks: list[ChunkCreate]) -> list[Chunk]:
        if not chunks:
            return []
        try:
            payload = [c.model_dump(exclude_none=True) for c in chunks]
            resp = self._client.table("chunks").insert(payload).execute()
            return [Chunk(**row) for row in (resp.data or [])]
        except Exception as e:
            raise handle_supabase_error(e, "创建 chunks")


def ensure_chunks_for_pointer(
    *,
    repo: ChunkRepository,
    service: Optional[ChunkingService] = None,
    node_id: str,
    json_pointer: str,
    content: str,
    config: Optional[ChunkingConfig] = None,
) -> EnsureChunksResult:
    t0 = time.perf_counter()
    log_info(
        f"[ensure_chunks] start: node_id={node_id} pointer={json_pointer[:50]} content_len={len(content)}"
    )

    cfg = config or ChunkingConfig()
    svc = service or ChunkingService()

    t1 = time.perf_counter()
    log_info(
        f"[ensure_chunks] validate_content_limits start: content_len={len(content)}"
    )
    svc.validate_content_limits(
        content,
        max_content_size_chars=cfg.max_content_size_chars,
        max_chunks_per_node=cfg.max_chunks_per_node,
        config=cfg,
    )
    log_info(
        f"[ensure_chunks] validate_content_limits done: elapsed_ms={int((time.perf_counter() - t1) * 1000)}"
    )

    t2 = time.perf_counter()
    content_hash = compute_content_hash(content)
    log_info(
        f"[ensure_chunks] hash computed: elapsed_ms={int((time.perf_counter() - t2) * 1000)}"
    )

    t3 = time.perf_counter()
    existing = repo.get_by_hash(
        node_id=node_id, json_pointer=json_pointer, content_hash=content_hash
    )
    log_info(
        f"[ensure_chunks] get_by_hash done: found={len(existing)} elapsed_ms={int((time.perf_counter() - t3) * 1000)}"
    )

    if existing:
        log_info(
            f"[ensure_chunks] returning existing chunks: count={len(existing)} total_ms={int((time.perf_counter() - t0) * 1000)}"
        )
        return EnsureChunksResult(
            node_id=node_id,
            json_pointer=json_pointer,
            content_hash=content_hash,
            created=False,
            chunks=existing,
        )

    t4 = time.perf_counter()
    log_info(f"[ensure_chunks] chunk_text start: content_len={len(content)}")
    segments = svc.chunk_text(
        content,
        chunk_size_chars=cfg.chunk_size_chars,
        chunk_overlap_chars=cfg.chunk_overlap_chars,
    )
    log_info(
        f"[ensure_chunks] chunk_text done: segments={len(segments)} elapsed_ms={int((time.perf_counter() - t4) * 1000)}"
    )

    total = len(segments)
    creates: List[ChunkCreate] = []
    for idx, seg in enumerate(segments):
        creates.append(
            ChunkCreate(
                node_id=node_id,
                json_pointer=json_pointer,
                chunk_index=idx,
                total_chunks=total,
                chunk_text=seg.text,
                char_start=seg.char_start,
                char_end=seg.char_end,
                content_hash=content_hash,
            )
        )

    t5 = time.perf_counter()
    log_info(f"[ensure_chunks] bulk_create start: count={len(creates)}")
    created = repo.bulk_create(creates)
    log_info(
        f"[ensure_chunks] bulk_create done: created={len(created)} elapsed_ms={int((time.perf_counter() - t5) * 1000)}"
    )

    # Ensure stable ordering
    created_sorted = sorted(created, key=lambda c: c.chunk_index)

    log_info(
        f"[ensure_chunks] done: node_id={node_id} chunks={len(created_sorted)} total_ms={int((time.perf_counter() - t0) * 1000)}"
    )
    return EnsureChunksResult(
        node_id=node_id,
        json_pointer=json_pointer,
        content_hash=content_hash,
        created=True,
        chunks=created_sorted,
        meta={"total_chunks": total},
    )
