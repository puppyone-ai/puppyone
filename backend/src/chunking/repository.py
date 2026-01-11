"""
Chunking repository & idempotent ensure entrypoint.

This layer persists to Supabase/Postgres table: public.chunks
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, List, Optional

if TYPE_CHECKING:
    pass

from src.chunking.schemas import Chunk, ChunkCreate, ChunkingConfig, EnsureChunksResult
from src.chunking.service import ChunkingService, compute_content_hash
from src.supabase.exceptions import handle_supabase_error


class ChunkRepository:
    def __init__(self, client: Any):
        self._client = client

    def get_by_hash(
        self, *, table_id: int, json_pointer: str, content_hash: str
    ) -> list[Chunk]:
        resp = (
            self._client.table("chunks")
            .select("*")
            .eq("table_id", table_id)
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
    table_id: int,
    json_pointer: str,
    content: str,
    config: Optional[ChunkingConfig] = None,
) -> EnsureChunksResult:
    cfg = config or ChunkingConfig()
    svc = service or ChunkingService()

    svc.validate_content_limits(
        content,
        max_content_size_chars=cfg.max_content_size_chars,
        max_chunks_per_node=cfg.max_chunks_per_node,
        config=cfg,
    )

    content_hash = compute_content_hash(content)
    existing = repo.get_by_hash(
        table_id=table_id, json_pointer=json_pointer, content_hash=content_hash
    )
    if existing:
        return EnsureChunksResult(
            table_id=table_id,
            json_pointer=json_pointer,
            content_hash=content_hash,
            created=False,
            chunks=existing,
        )

    segments = svc.chunk_text(
        content,
        chunk_size_chars=cfg.chunk_size_chars,
        chunk_overlap_chars=cfg.chunk_overlap_chars,
    )

    total = len(segments)
    creates: List[ChunkCreate] = []
    for idx, seg in enumerate(segments):
        creates.append(
            ChunkCreate(
                table_id=table_id,
                json_pointer=json_pointer,
                chunk_index=idx,
                total_chunks=total,
                chunk_text=seg.text,
                char_start=seg.char_start,
                char_end=seg.char_end,
                content_hash=content_hash,
            )
        )

    created = repo.bulk_create(creates)
    # Ensure stable ordering
    created_sorted = sorted(created, key=lambda c: c.chunk_index)

    return EnsureChunksResult(
        table_id=table_id,
        json_pointer=json_pointer,
        content_hash=content_hash,
        created=True,
        chunks=created_sorted,
        meta={"total_chunks": total},
    )
