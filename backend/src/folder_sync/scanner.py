"""
Folder Sync Engine — Scanner

目录扫描、文件读取、类型检测、哈希计算。

提取自 sync/adapters/filesystem.py 的核心 I/O 逻辑，
去除对 SyncSource/SyncMapping 的依赖。

核心函数：
  - scan_directory()  : 全量扫描目录 → FolderSnapshot
  - read_file()       : 读取单个文件 → FileContent
  - compute_hash()    : SHA-256
  - detect_type()     : 根据扩展名 + 内容探测 content_type
"""

import hashlib
import json
import os
import time
from typing import Optional

from src.folder_sync.schemas import FileEntry, FileContent, FolderSnapshot
from src.folder_sync.ignore import IgnoreRules, DEFAULT_IGNORE_PATTERNS


def compute_hash(data: bytes) -> str:
    """SHA-256 哈希。"""
    return hashlib.sha256(data).hexdigest()


def detect_type(rel_path: str, raw_bytes: Optional[bytes] = None) -> str:
    """
    文件类型检测。

    策略（与现有代码一致）：
      1. .json 扩展名 → 尝试 parse，成功则 "json"，否则 "markdown"
      2. 其它文本文件 → "markdown"
      3. 无法 decode UTF-8 → "binary"
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
    读取单个文件，返回内容 + 元信息。

    Returns:
        FileContent 或 None（文件不存在 / 读取失败）
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
    全量扫描目录，生成 FolderSnapshot。

    不读取文件内容（只计算 hash + 检测类型），保持轻量。
    如需内容，后续调用 read_file()。
    """
    if ignore_rules is None:
        ignore_rules = IgnoreRules()

    entries: dict[str, FileEntry] = {}

    if not os.path.isdir(root_path):
        return FolderSnapshot(root_path=root_path, scanned_at=time.time())

    for dirpath, dirnames, filenames in os.walk(root_path):
        # 原地修改 dirnames 以跳过忽略的目录（阻止 os.walk 递归进入）
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
    增量扫描：只扫描指定的相对路径。

    用于 watcher 回调后，只检查变更的文件。
    返回 rel_path → FileEntry（None 表示文件已删除）。
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
