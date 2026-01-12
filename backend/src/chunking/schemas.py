"""
Chunking schemas.

This module intentionally stays low-level and reusable by other domains
(search/tool/etl) without introducing API routes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class LargeStringNode(BaseModel):
    """A large string node extracted from a JSON tree."""

    json_pointer: str
    content: str
    node_type: str = "string"


class ChunkSegment(BaseModel):
    """A chunked segment derived from a single string."""

    text: str
    char_start: int
    char_end: int


class ChunkBase(BaseModel):
    """Database-facing chunk record base."""

    table_id: int
    json_pointer: str

    chunk_index: int
    total_chunks: int

    chunk_text: str
    char_start: int
    char_end: int

    content_hash: str

    turbopuffer_namespace: Optional[str] = None
    turbopuffer_doc_id: Optional[str] = None


class ChunkCreate(ChunkBase):
    """Create payload for inserting into `public.chunks`."""

    pass


class Chunk(ChunkBase):
    """Chunk record returned from DB."""

    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EnsureChunksResult(BaseModel):
    """Result for idempotent ensure operation."""

    table_id: int
    json_pointer: str
    content_hash: str

    created: bool
    chunks: list[Chunk]

    meta: dict[str, Any] = Field(default_factory=dict)
