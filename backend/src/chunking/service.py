"""
Chunking service.

- Character-based chunking with overlap
- JSON traversal to extract large strings with RFC6901 JSON Pointer
"""

from __future__ import annotations

import hashlib
from typing import Any, Iterable

from src.chunking.schemas import ChunkSegment, ChunkingConfig, LargeStringNode


def compute_content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _escape_json_pointer_token(token: str) -> str:
    # RFC6901: "~" -> "~0", "/" -> "~1"
    return token.replace("~", "~0").replace("/", "~1")


def _join_json_pointer(base: str, token: str) -> str:
    if base in ("", None):
        return f"/{_escape_json_pointer_token(token)}"
    return f"{base}/{_escape_json_pointer_token(token)}"


class ChunkingService:
    def chunk_text(
        self,
        text: str,
        *,
        chunk_size_chars: int = 1000,
        chunk_overlap_chars: int = 100,
    ) -> list[ChunkSegment]:
        if chunk_size_chars <= 0:
            raise ValueError("chunk_size_chars must be > 0")
        if chunk_overlap_chars < 0:
            raise ValueError("chunk_overlap_chars must be >= 0")
        if chunk_overlap_chars >= chunk_size_chars:
            raise ValueError("chunk_overlap_chars must be < chunk_size_chars")

        chunks: list[ChunkSegment] = []
        current_pos = 0
        n = len(text)

        while current_pos < n:
            max_end = min(current_pos + chunk_size_chars, n)

            # Prefer to cut at newline boundary to preserve semantics.
            # We cut AFTER '\n' so the chunk ends with a full line.
            chunk_end = max_end
            if max_end < n:
                newline_pos = text.rfind("\n", current_pos, max_end)
                if newline_pos >= 0 and newline_pos >= current_pos:
                    # Ensure non-empty progress
                    if newline_pos + 1 > current_pos:
                        chunk_end = newline_pos + 1

            segment = text[current_pos:chunk_end]
            if segment.strip():
                chunks.append(
                    ChunkSegment(
                        text=segment, char_start=current_pos, char_end=chunk_end
                    )
                )

            if chunk_end >= n:
                break

            if chunk_overlap_chars <= 0:
                current_pos = chunk_end
                continue

            # Overlap, but keep start aligned to a line boundary (beginning of a line)
            tentative_start = max(chunk_end - chunk_overlap_chars, 0)
            if tentative_start == 0:
                current_pos = 0
                continue

            prev_newline = text.rfind("\n", 0, tentative_start)
            if prev_newline < 0:
                # No newline found: fall back to simple overlap without line alignment
                # This prevents infinite loop when text has no newlines
                current_pos = tentative_start
            else:
                current_pos = prev_newline + 1

            # Safety: ensure progress even for edge cases
            if current_pos >= chunk_end:
                current_pos = chunk_end

        return chunks

    def extract_large_strings(
        self,
        data: Any,
        *,
        threshold_chars: int,
        base_pointer: str = "",
    ) -> list[LargeStringNode]:
        if threshold_chars < 0:
            raise ValueError("threshold_chars must be >= 0")
        if base_pointer and not base_pointer.startswith("/"):
            raise ValueError("base_pointer must be '' or start with '/'")

        results: list[LargeStringNode] = []

        def traverse(obj: Any, pointer: str) -> None:
            if isinstance(obj, str):
                if len(obj) >= threshold_chars:
                    results.append(LargeStringNode(json_pointer=pointer, content=obj))
                return

            if isinstance(obj, dict):
                for k, v in obj.items():
                    # JSON object keys are strings; coerce defensively.
                    traverse(v, _join_json_pointer(pointer, str(k)))
                return

            if isinstance(obj, list):
                for idx, item in enumerate(obj):
                    traverse(item, _join_json_pointer(pointer, str(idx)))
                return

        traverse(data, base_pointer or "")
        return results

    def validate_content_limits(
        self,
        content: str,
        *,
        max_content_size_chars: int,
        max_chunks_per_node: int,
        config: ChunkingConfig,
    ) -> None:
        if len(content) > max_content_size_chars:
            raise ValueError(
                f"content size {len(content)} exceeds max_content_size_chars={max_content_size_chars}"
            )

        # Estimate chunk count by actually chunking (stable and safe for these bounds).
        chunks = self.chunk_text(
            content,
            chunk_size_chars=config.chunk_size_chars,
            chunk_overlap_chars=config.chunk_overlap_chars,
        )
        if len(chunks) > max_chunks_per_node:
            raise ValueError(
                f"content would generate {len(chunks)} chunks, exceeding max_chunks_per_node={max_chunks_per_node}"
            )


def iter_large_string_nodes_for_chunking(
    service: ChunkingService,
    data: Any,
    config: ChunkingConfig,
    *,
    base_pointer: str = "",
) -> Iterable[LargeStringNode]:
    return service.extract_large_strings(
        data,
        threshold_chars=config.chunk_threshold_chars,
        base_pointer=base_pointer,
    )
