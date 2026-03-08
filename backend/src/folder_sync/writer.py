"""
Folder Sync Engine — Writer

文件写入 + 删除。

提取自 sync/adapters/filesystem.py 的 push() 逻辑，
以及 sync/cache_manager.py 的 write_file() 逻辑。
"""

import json
import os
from typing import Any, Optional

from src.folder_sync.schemas import FileEntry
from src.folder_sync.scanner import compute_hash, detect_type


def write_file(
    base_path: str,
    rel_path: str,
    content: Any,
    content_type: str = "auto",
) -> FileEntry:
    """
    将内容写入文件。

    Args:
        base_path: 目标目录的根路径
        rel_path:  相对路径（如 "config.json" 或 "docs/readme.md"）
        content:   写入内容（dict → JSON 序列化, str → 直接写入, bytes → 二进制写入）
        content_type: "json" | "markdown" | "binary" | "auto"（auto 根据 rel_path 推断）

    Returns:
        写入后的 FileEntry（含 content_hash）
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
    删除文件。成功返回 True。

    不会删除空目录（避免与 watcher 产生不必要的事件）。
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
    """确保目录存在，返回完整路径。"""
    full_path = os.path.join(base_path, rel_dir) if rel_dir else base_path
    os.makedirs(full_path, exist_ok=True)
    return full_path
