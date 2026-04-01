"""Input validation utilities for MUT engine.

Provides path sanitization, size limits, and depth checks to prevent
path traversal, resource exhaustion, and other input-based attacks.
"""

from __future__ import annotations

from fastapi import HTTPException

# ── Limits ──

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_FILES_PER_PUSH = 1000
MAX_TREE_DEPTH = 20
MAX_PATH_LENGTH = 500

# ── Path Validation ──

_FORBIDDEN_SEGMENTS = frozenset({"..", ".", "~"})


def validate_path(path: str) -> str:
    """Sanitize and validate a content path.

    Strips leading/trailing slashes, rejects traversal attempts
    and excessively long paths.

    Returns the cleaned path.

    Raises:
        HTTPException 400 on invalid path.
    """
    clean = path.strip("/")

    if len(clean) > MAX_PATH_LENGTH:
        raise HTTPException(400, f"Path exceeds {MAX_PATH_LENGTH} characters")

    if clean:
        segments = clean.split("/")
        for seg in segments:
            if seg in _FORBIDDEN_SEGMENTS:
                raise HTTPException(400, f"Invalid path segment: '{seg}'")
            if "\x00" in seg or "\\" in seg:
                raise HTTPException(400, "Path contains invalid characters")

    return clean


def validate_depth(max_depth: int) -> int:
    """Clamp max_depth to safe range."""
    if max_depth < 0:
        return MAX_TREE_DEPTH
    return min(max_depth, MAX_TREE_DEPTH)


def validate_limit(limit: int, default: int = 100, maximum: int = 1000) -> int:
    """Clamp limit to safe range."""
    if limit <= 0:
        return default
    return min(limit, maximum)
