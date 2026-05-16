"""Path helpers owned by PuppyOne's version engine."""

from __future__ import annotations


def normalize_path(path: str) -> str:
    """Normalize repository paths for scope and tree comparisons.

    This matches the legacy MUT helper behavior: leading/trailing slashes are
    removed, and ``..`` path traversal segments are rejected.
    """

    clean = (path or "").strip("/")
    if clean and ".." in clean.split("/"):
        raise ValueError(f"path traversal not allowed: {path}")
    return clean
