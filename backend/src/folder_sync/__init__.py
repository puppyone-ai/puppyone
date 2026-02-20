"""
Folder Sync Engine — 文件夹同步内核

独立于业务层的纯文件系统操作引擎。

提供 5 项核心能力：
  1. scan   — 目录扫描 + 文件读取 + 类型检测 + 哈希
  2. write  — 文件写入 + 删除
  3. watch  — 基于 watchdog 的实时文件系统监听
  4. diff   — 变更检测（全量 / 增量）
  5. ignore — 可配置的文件过滤规则

上层包装器根据产品语义选择不同的写入路径：
  ┌──────────────────────┐        ┌──────────────────────┐
  │  sync/folder_source  │        │  access/folder_access│
  │  (Collection 收集)    │        │  (Distribution 分发)  │
  │                      │        │                      │
  │  ContentNodeService  │        │  CollaborationService│
  │  .update()           │        │  .commit()           │
  │  (直接覆写，无版本锁)  │        │  (乐观锁 + 三方合并)  │
  └──────────┬───────────┘        └──────────┬───────────┘
             │                               │
             └───────────┐   ┌───────────────┘
                         ▼   ▼
                  ┌──────────────────┐
                  │    folder_sync   │
                  │    (本模块)       │
                  │                  │
                  │  scan · write    │
                  │  watch · diff    │
                  │  ignore          │
                  └──────────────────┘

Usage:
    from src.folder_sync import (
        scan_directory, scan_paths, read_file,
        write_file, delete_file,
        FolderWatcher,
        diff_snapshots, diff_incremental,
        IgnoreRules,
        FolderSnapshot, FileEntry, FileContent, ChangeSet,
    )
"""

from src.folder_sync.scanner import (
    scan_directory,
    scan_paths,
    read_file,
    compute_hash,
    detect_type,
)
from src.folder_sync.writer import (
    write_file,
    delete_file,
    ensure_directory,
)
from src.folder_sync.watcher import FolderWatcher
from src.folder_sync.differ import diff_snapshots, diff_incremental
from src.folder_sync.ignore import IgnoreRules, DEFAULT_IGNORE_PATTERNS
from src.folder_sync.schemas import (
    FileEntry,
    FileContent,
    ChangeSet,
    FolderSnapshot,
)

__all__ = [
    # scanner
    "scan_directory",
    "scan_paths",
    "read_file",
    "compute_hash",
    "detect_type",
    # writer
    "write_file",
    "delete_file",
    "ensure_directory",
    # watcher
    "FolderWatcher",
    # differ
    "diff_snapshots",
    "diff_incremental",
    # ignore
    "IgnoreRules",
    "DEFAULT_IGNORE_PATTERNS",
    # schemas
    "FileEntry",
    "FileContent",
    "ChangeSet",
    "FolderSnapshot",
]
