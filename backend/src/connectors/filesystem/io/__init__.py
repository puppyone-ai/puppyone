"""
Folder Sync I/O Engine — Pure filesystem operations.

Provides 5 core capabilities independent of business logic:
  1. scan   — directory scanning, file reading, type detection, hashing
  2. write  — file write / delete
  3. watch  — watchdog-based real-time file monitoring
  4. diff   — snapshot comparison (full / incremental)
  5. ignore — configurable file filtering rules
"""

from src.connectors.filesystem.io.scanner import (
    scan_directory,
    scan_paths,
    read_file,
    compute_hash,
    detect_type,
)
from src.connectors.filesystem.io.writer import (
    write_file,
    delete_file,
    ensure_directory,
)
from src.connectors.filesystem.io.watcher import FolderWatcher
from src.connectors.filesystem.io.differ import diff_snapshots, diff_incremental
from src.connectors.filesystem.io.ignore import IgnoreRules, DEFAULT_IGNORE_PATTERNS
from src.connectors.filesystem.io.schemas import (
    FileEntry,
    FileContent,
    ChangeSet,
    FolderSnapshot,
)

__all__ = [
    "scan_directory", "scan_paths", "read_file", "compute_hash", "detect_type",
    "write_file", "delete_file", "ensure_directory",
    "FolderWatcher",
    "diff_snapshots", "diff_incremental",
    "IgnoreRules", "DEFAULT_IGNORE_PATTERNS",
    "FileEntry", "FileContent", "ChangeSet", "FolderSnapshot",
]
