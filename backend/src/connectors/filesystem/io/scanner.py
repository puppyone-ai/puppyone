"""
Folder Sync Engine — Scanner

Directory scanning, file reading, type detection, hash computation.

Extracted from the core I/O logic of sync/adapters/filesystem.py,
with dependencies on SyncSource/SyncMapping removed.

Core functions:
  - scan_directory()  : Full directory scan -> FolderSnapshot
  - read_file()       : Read a single file -> FileContent
  - compute_hash()    : SHA-256
  - detect_type()     : Detect content_type based on extension + content
"""

import hashlib
import json
import os
import time
from typing import Optional

from src.connectors.filesystem.io.schemas import FileEntry, FileContent, FolderSnapshot
from src.connectors.filesystem.io.ignore import IgnoreRules, DEFAULT_IGNORE_PATTERNS


def compute_hash(data: bytes) -> str:
    """SHA-256 hash."""
    return hashlib.sha256(data).hexdigest()


def detect_type(rel_path: str, raw_bytes: Optional[bytes] = None) -> str:
    """
    File type detection.

    Strategy (consistent with existing code):
      1. .json extension -> try to parse; if successful "json", otherwise "markdown"
      2. Other text files -> "markdown"
      3. Cannot decode UTF-8 -> "binary"
    """
    if rel_path.endswith(".json"):
        if raw_bytes is not None:
            try:
                raw_bytes.decode("utf-8")
                json.loads(raw_bytes)
                return "json"
            except (UnicodeDecodeError, json.JSONDecodeError):
                return "markdown"
        return "json"

    if raw_bytes is not None:
        try:
            raw_bytes.decode("utf-8")
            return "markdown"
        except UnicodeDecodeError:
            return "binary"

    return "markdown"


def read_file(base_path: str, rel_path: str) -> Optional[FileContent]:
    """
    Read a single file, return content + metadata.

    Returns:
        FileContent or None (file does not exist / read failed)
    """
    full_path = os.path.join(base_path, rel_path)
    if not os.path.isfile(full_path):
        return None

    try:
        with open(full_path, "rb") as f:
            raw_bytes = f.read()
    except (IOError, OSError):
        return None

    content_hash = compute_hash(raw_bytes)
    content_type = detect_type(rel_path, raw_bytes)

    if content_type == "json":
        try:
            content = json.loads(raw_bytes.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            content = raw_bytes.decode("utf-8", errors="replace")
            content_type = "markdown"
    elif content_type == "markdown":
        content = raw_bytes.decode("utf-8", errors="replace")
    else:
        content = raw_bytes

    return FileContent(
        rel_path=rel_path,
        raw_bytes=raw_bytes,
        content=content,
        content_type=content_type,
        content_hash=content_hash,
        size_bytes=len(raw_bytes),
    )


def scan_directory(
    root_path: str,
    ignore_rules: Optional[IgnoreRules] = None,
) -> FolderSnapshot:
    """
    Full directory scan, generating a FolderSnapshot.

    Does not read file contents (only computes hash + detects type) to stay lightweight.
    For content, call read_file() afterwards.
    """
    if ignore_rules is None:
        ignore_rules = IgnoreRules()

    entries: dict[str, FileEntry] = {}

    if not os.path.isdir(root_path):
        return FolderSnapshot(root_path=root_path, scanned_at=time.time())

    for dirpath, dirnames, filenames in os.walk(root_path):
        # Modify dirnames in-place to skip ignored directories (prevent os.walk from recursing into them)
        dirnames[:] = [
            d for d in dirnames
            if not ignore_rules.should_ignore_dir(d)
        ]

        for fname in filenames:
            full_path = os.path.join(dirpath, fname)
            rel_path = os.path.relpath(full_path, root_path)

            if ignore_rules.should_ignore_file(rel_path):
                continue

            try:
                stat = os.stat(full_path)
            except OSError:
                continue

            try:
                with open(full_path, "rb") as f:
                    raw = f.read()
                content_hash = compute_hash(raw)
            except (IOError, OSError):
                continue

            content_type = detect_type(rel_path, raw)

            entries[rel_path] = FileEntry(
                rel_path=rel_path,
                content_hash=content_hash,
                content_type=content_type,
                size_bytes=stat.st_size,
                modified_at=stat.st_mtime,
            )

    return FolderSnapshot(
        root_path=root_path,
        entries=entries,
        scanned_at=time.time(),
    )


def scan_paths(
    root_path: str,
    rel_paths: set[str],
    ignore_rules: Optional[IgnoreRules] = None,
) -> dict[str, Optional[FileEntry]]:
    """
    Incremental scan: only scan specified relative paths.

    Used after a watcher callback to check only changed files.
    Returns rel_path -> FileEntry (None means the file has been deleted).
    """
    if ignore_rules is None:
        ignore_rules = IgnoreRules()

    results: dict[str, Optional[FileEntry]] = {}

    for rel_path in rel_paths:
        if ignore_rules.should_ignore_file(rel_path):
            results[rel_path] = None
            continue

        full_path = os.path.join(root_path, rel_path)
        if not os.path.isfile(full_path):
            results[rel_path] = None
            continue

        try:
            stat = os.stat(full_path)
            with open(full_path, "rb") as f:
                raw = f.read()
            content_hash = compute_hash(raw)
            content_type = detect_type(rel_path, raw)
            results[rel_path] = FileEntry(
                rel_path=rel_path,
                content_hash=content_hash,
                content_type=content_type,
                size_bytes=stat.st_size,
                modified_at=stat.st_mtime,
            )
        except (IOError, OSError):
            results[rel_path] = None

    return results
