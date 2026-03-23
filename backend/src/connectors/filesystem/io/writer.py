"""
Folder Sync Engine — Writer

File writing + deletion.

Extracted from the push() logic of sync/adapters/filesystem.py,
and the write_file() logic of sync/cache_manager.py.
"""

import json
import os
from typing import Any, Optional

from src.connectors.filesystem.io.schemas import FileEntry
from src.connectors.filesystem.io.scanner import compute_hash, detect_type


def write_file(
    base_path: str,
    rel_path: str,
    content: Any,
    content_type: str = "auto",
) -> FileEntry:
    """
    Write content to a file.

    Args:
        base_path: Root path of the target directory
        rel_path:  Relative path (e.g. "config.json" or "docs/readme.md")
        content:   Content to write (dict -> JSON serialization, str -> direct write, bytes -> binary write)
        content_type: "json" | "markdown" | "binary" | "auto" (auto infers from rel_path)

    Returns:
        FileEntry after writing (including content_hash)
    """
    full_path = os.path.join(base_path, rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    if content_type == "auto":
        content_type = detect_type(rel_path)

    if content_type == "json" and not isinstance(content, (str, bytes)):
        raw_bytes = json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")
    elif isinstance(content, bytes):
        raw_bytes = content
    elif isinstance(content, str):
        raw_bytes = content.encode("utf-8")
    else:
        raw_bytes = str(content).encode("utf-8")

    with open(full_path, "wb") as f:
        f.write(raw_bytes)

    content_hash = compute_hash(raw_bytes)
    modified_at = os.path.getmtime(full_path)

    return FileEntry(
        rel_path=rel_path,
        content_hash=content_hash,
        content_type=content_type,
        size_bytes=len(raw_bytes),
        modified_at=modified_at,
    )


def delete_file(base_path: str, rel_path: str) -> bool:
    """
    Delete a file. Returns True on success.

    Does not delete empty directories (to avoid unnecessary watcher events).
    """
    full_path = os.path.join(base_path, rel_path)
    try:
        if os.path.isfile(full_path):
            os.remove(full_path)
            return True
        return False
    except OSError:
        return False


def ensure_directory(base_path: str, rel_dir: str = "") -> str:
    """Ensure the directory exists, return the full path."""
    full_path = os.path.join(base_path, rel_dir) if rel_dir else base_path
    os.makedirs(full_path, exist_ok=True)
    return full_path
