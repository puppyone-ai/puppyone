"""
Block Content Normalization

This module provides a single entry point `normalize_block_content(block)` that
returns a canonical, edge-friendly representation of a block's content,
abstracting away storage differences (internal vs external) and serialization
formats (e.g., JSON vs JSONL aggregation results).

Normalization rules:
- Structured blocks:
  - JSON string → parsed object
  - List of JSON strings → parse each element (typical JSONL)
  - Single-element list (non-looped) → unwrap to single item
  - Otherwise → return as-is
- Text blocks:
  - bytes → UTF-8 string (when possible)
  - Otherwise → return as-is
- Other block types → return as-is
"""

from __future__ import annotations

import json
from typing import Any, List, Optional


def _try_parse_json(value: Any) -> Any:
    """
    Attempt to parse a JSON string; return original value on failure.
    
    Args:
        value: Value to parse (typically a string)
        
    Returns:
        Parsed JSON object or original value if parsing fails
    """
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _parse_list_elements_when_possible(values: List[Any]) -> List[Any]:
    """
    Try to JSON-parse each string element in a list.
    
    Args:
        values: List of values to parse
        
    Returns:
        List with parsed JSON objects where possible
    """
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
    """Check if value is a list containing only strings."""
    return isinstance(values, list) and all(isinstance(v, str) for v in values)


def _normalize_structured(content: Any, is_looped: bool) -> Any:
    """
    Normalize structured content across storage modes.

    Applies these transformations in order:
    1. JSON string → parsed object
    2. List of JSON strings → list of parsed objects (typical JSONL)
    3. Single-element list (non-looped) → unwrap to single item
    
    Args:
        content: Raw content to normalize
        is_looped: Whether the block is marked as looped
        
    Returns:
        Normalized content suitable for edge consumption
    """
    # Step 1: Parse JSON string
    content = _try_parse_json(content)

    # Step 2: Parse JSONL-like list of strings
    if _is_list_of_strings(content):
        content = _parse_list_elements_when_possible(content)

    # Step 3: Unwrap single-element lists for non-looped blocks
    if not is_looped and isinstance(content, list) and len(content) == 1:
        return content[0]

    return content


def _normalize_text(content: Any) -> Any:
    """
    Normalize text content, converting bytes to UTF-8 strings.
    
    Args:
        content: Raw text content
        
    Returns:
        UTF-8 decoded string or original value if conversion fails
    """
    if isinstance(content, bytes):
        try:
            return content.decode("utf-8")
        except Exception:
            return content
    return content


def normalize_block_content(block_like: Any, is_looped: Optional[bool] = None) -> Any:
    """
    Return a canonical, edge-friendly representation of the block content.
    
    This function abstracts away storage differences (internal vs external) and
    serialization formats, providing a consistent interface for downstream edges.

    Args:
        block_like: Block object with 'type' and 'data' attributes
        is_looped: Override for loop flag (defaults to reading from block)

    Returns:
        Normalized content appropriate for the block type

    Block requirements:
        - type: str (e.g., 'structured', 'text')
        - data: dict containing at least 'content'

    Note:
        If `is_looped` is not provided, falls back to reading from
        block.data.looped for backward compatibility.
    """
    # Extract raw content
    try:
        content = getattr(block_like, "data", {}).get("content")
    except Exception:
        content = None

    # Determine block type
    block_type = getattr(block_like, "type", None) or (
        getattr(block_like, "data", {}).get("type")
    )

    if block_type == "structured":
        # Determine loop flag (prefer explicit parameter)
        if is_looped is None:
            try:
                is_looped_flag = bool(
                    getattr(block_like, "data", {}).get("looped", False)
                )
            except Exception:
                is_looped_flag = False
        else:
            is_looped_flag = bool(is_looped)
        return _normalize_structured(content, is_looped_flag)

    if block_type == "text":
        return _normalize_text(content)

    # Other types: return as-is
    return content
