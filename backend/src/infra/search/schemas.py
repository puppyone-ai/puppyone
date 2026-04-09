from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SearchToolQueryInput(BaseModel):
    """
    Search Tool query input (for internal API / MCP tool usage).

    Constraints:
    - query is required and must be non-empty (server-side strip validation)
    - top_k is optional, default 5, max 20
    """

    query: str = Field(
        ...,
        description="Search query text (required, non-empty)",
        examples=["How to clean LLM training data?", "What auth middleware exists in the project?"],
    )
    top_k: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of results to return (optional, default 5, max 20)",
        examples=[5, 10],
    )


class SearchChunk(BaseModel):
    """
    Chunk info in search results (only includes fields useful for the Agent).

    Internal fields (not exposed to Agent):
    - path, content_hash, turbopuffer_namespace, turbopuffer_doc_id, char_start, char_end
    """

    # DB id (optional; current implementation mainly relies on turbopuffer attributes)
    id: Optional[int] = None

    json_pointer: str

    chunk_index: int
    total_chunks: int

    chunk_text: str


class SearchResultItem(BaseModel):
    score: float
    chunk: SearchChunk
    # Path relative to tool.json_path from the Tool's perspective (RFC6901)
    json_path: str


class SearchToolQueryResponse(BaseModel):
    query: str
    results: list[SearchResultItem] = Field(default_factory=list)
