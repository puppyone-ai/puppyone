"""
Block content normalization (the shim between blocks and edges).

This module provides a single entry point `normalize_block_content(block)` that
returns a canonical, edge-friendly representation of a block's content,
abstracting away storage differences (internal vs external) and serialization
formats (e.g., JSON vs JSONL aggregation results).

Conservative defaults to avoid breaking behavior:
- For structured blocks:
  - JSON string -> parsed object when possible
  - List of JSON strings -> parse each element when possible (typical JSONL)
  - Single-element list and block not marked looped -> unwrap the single item
  - Otherwise return as is
- For text blocks:
  - bytes -> utf-8 string when possible; otherwise return original
- For other block types: return as is
"""

from __future__ import annotations

import json
from typing import Any, List


def _try_parse_json(value: Any) -> Any:
    """Attempt to parse a JSON string; on failure, return original value."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _parse_list_elements_when_possible(values: List[Any]) -> List[Any]:
    """Try to json-parse each string element; keep original on failure."""
    parsed: List[Any] = []
    for item in values:
        if isinstance(item, str):
            try:
                parsed.append(json.loads(item))
            except Exception:
                parsed.append(item)
        else:
            parsed.append(item)
    return parsed


def _is_list_of_strings(values: Any) -> bool:
    return isinstance(values, list) and all(isinstance(v, str) for v in values)


def _normalize_structured(block_like: Any, content: Any) -> Any:
    """Normalize structured content across storage modes.

    Heuristics:
    - If content is a JSON string, parse
    - If content is a list of strings, try parsing each (typical JSONL)
    - If content is a single-element list and block is not looped, unwrap
    """
    # 1) JSON string -> object
    content = _try_parse_json(content)

    # 2) JSONL-like list of strings -> list of objects/strings
    if _is_list_of_strings(content):
        content = _parse_list_elements_when_possible(content)

    # 3) Non-loop, single-element list -> unwrap to unit
    is_looped = False
    try:
        is_looped = bool(getattr(block_like, "data", {}).get("looped", False))
    except Exception:
        is_looped = False

    if not is_looped and isinstance(content, list) and len(content) == 1:
        return content[0]

    return content


def _normalize_text(content: Any) -> Any:
    if isinstance(content, bytes):
        try:
            return content.decode("utf-8")
        except Exception:
            return content
    return content


def normalize_block_content(block_like: Any) -> Any:
    """Return a canonical, edge-friendly representation of the block content.

    The `block_like` is expected to have attributes:
      - type: str (e.g., 'structured', 'text')
      - data: dict containing at least 'content'
    """
    # Fetch raw content
    try:
        content = getattr(block_like, "data", {}).get("content")
    except Exception:
        content = None

    block_type = getattr(block_like, "type", None) or (
        getattr(block_like, "data", {}).get("type")
    )

    if block_type == "structured":
        return _normalize_structured(block_like, content)

    if block_type == "text":
        return _normalize_text(content)

    # Other types: keep original
    return content
