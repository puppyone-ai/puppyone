"""Input validation utilities for MUT engine.

Provides path sanitization, size limits, and depth checks to prevent
path traversal, resource exhaustion, and other input-based attacks.
"""

from __future__ import annotations

import base64

from fastapi import HTTPException

# ── Limits ──

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_FILES_PER_PUSH = 1000
MAX_TREE_DEPTH = 20
MAX_PATH_LENGTH = 500
MAX_PUSH_BODY_SIZE = 200 * 1024 * 1024  # 200 MB total push payload

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


def validate_push_objects(body: dict) -> None:
    """Validate object sizes in a MUT push request body.

    Checks each base64-encoded object blob against MAX_FILE_SIZE and
    the total payload against MAX_PUSH_BODY_SIZE.

    Raises HTTPException 413 if any limit is exceeded.
    """
    objects = body.get("objects")
    if not isinstance(objects, dict):
        return

    if len(objects) > MAX_FILES_PER_PUSH:
        raise HTTPException(
            status_code=413,
            detail=f"Push contains {len(objects)} objects, exceeds limit of {MAX_FILES_PER_PUSH}",
        )

    total_size = 0
    for obj_hash, b64_data in objects.items():
        if not isinstance(b64_data, str):
            continue
        raw_size = len(b64_data) * 3 // 4
        if raw_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"Object {obj_hash[:16]}... size ~{raw_size} bytes exceeds limit of {MAX_FILE_SIZE} bytes",
            )
        total_size += raw_size

    if total_size > MAX_PUSH_BODY_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Total push payload ~{total_size} bytes exceeds limit of {MAX_PUSH_BODY_SIZE} bytes",
        )
