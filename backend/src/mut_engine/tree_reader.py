"""
MutTreeReader — Mut Merkle tree 的直接读取接口

直接从 S3 ObjectStore 中的 Merkle tree 读取文件树，
不经过 content_nodes (PG)。

这是 content_nodes 被删除后，所有树浏览和文件读取的唯一入口。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

from mut.core.object_store import ObjectStore
from mut.core.tree import read_tree, tree_to_flat

from src.mut_engine.repo_manager import MutRepoManager
from src.utils.logger import log_error


def detect_type(name: str) -> str:
    if name.endswith(".json"):
        return "json"
    if name.endswith(".md") or name.endswith(".markdown"):
        return "markdown"
    return "file"


def detect_mime(name: str) -> str:
    ext = os.path.splitext(name)[1].lower()
    return {
        ".json": "application/json",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".txt": "text/plain",
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".ts": "application/typescript",
        ".py": "text/x-python",
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
    }.get(ext, "application/octet-stream")


@dataclass
class MutEntry:
    """Mut tree 中的一个条目（文件或目录）。"""
    name: str
    path: str
    type: str              # "folder" | "json" | "markdown" | "file"
    content_hash: Optional[str] = None
    size_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    children_count: Optional[int] = None


class MutTreeReader:
    """直接读 Mut Merkle tree，不经过 PG。

    所有文件浏览和内容读取的唯一入口。
    替代 ContentNodeRepository + ContentNodeService 的所有读操作。
    """

    def __init__(self, repo_manager: MutRepoManager):
        self._repos = repo_manager

    def list_dir(self, project_id: str, path: str = "") -> list[MutEntry]:
        """列出目录内容（类似 ls）。

        直接读 Mut tree object，返回子条目列表。
        空路径 = 项目根目录。
        """
        try:
            repo = self._repos.get_repo(project_id)
            root_hash = repo.history.get_root_hash()
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get root hash for {project_id}: {e}")
            return []
        if not root_hash:
            return []

        tree_hash = root_hash
        if path:
            tree_hash = self._navigate_to_subtree(repo.store, root_hash, path)
            if not tree_hash:
                return []

        try:
            entries = read_tree(repo.store, tree_hash)
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to read tree at {path}: {e}")
            return []

        result = []
        for name, (typ, hash_val) in entries.items():
            if name == ".keep":
                continue

            entry_path = f"{path}/{name}" if path else name

            if typ == "T":
                child_count = self._count_children(repo.store, hash_val)
                result.append(MutEntry(
                    name=name,
                    path=entry_path,
                    type="folder",
                    children_count=child_count,
                ))
            else:
                size = None
                try:
                    blob = repo.store.get(hash_val)
                    size = len(blob)
                except Exception:
                    pass

                result.append(MutEntry(
                    name=name,
                    path=entry_path,
                    type=detect_type(name),
                    content_hash=hash_val,
                    size_bytes=size,
                    mime_type=detect_mime(name),
                ))

        result.sort(key=lambda e: (e.type != "folder", e.name.lower()))
        return result

    def read_file(self, project_id: str, path: str) -> bytes:
        """读取文件内容。"""
        try:
            repo = self._repos.get_repo(project_id)
            root_hash = repo.history.get_root_hash()
        except Exception as e:
            raise FileNotFoundError(f"Project {project_id} is not initialized: {e}")
        if not root_hash:
            raise FileNotFoundError(f"Project {project_id} has no content")

        blob_hash = self._resolve_blob(repo.store, root_hash, path)
        if not blob_hash:
            raise FileNotFoundError(f"File not found: {path}")

        return repo.store.get(blob_hash)

    def stat(self, project_id: str, path: str) -> Optional[MutEntry]:
        """获取单个条目信息（类似 stat）。"""
        try:
            repo = self._repos.get_repo(project_id)
            root_hash = repo.history.get_root_hash()
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get root hash for stat: {e}")
            return None
        if not root_hash:
            return None

        if not path:
            return MutEntry(name="", path="", type="folder")

        parent_path = os.path.dirname(path)
        name = os.path.basename(path)

        parent_hash = root_hash
        if parent_path:
            parent_hash = self._navigate_to_subtree(repo.store, root_hash, parent_path)
            if not parent_hash:
                return None

        try:
            entries = read_tree(repo.store, parent_hash)
        except Exception:
            return None

        if name not in entries:
            return None

        typ, hash_val = entries[name]

        if typ == "T":
            child_count = self._count_children(repo.store, hash_val)
            return MutEntry(
                name=name,
                path=path,
                type="folder",
                children_count=child_count,
            )

        size = None
        try:
            blob = repo.store.get(hash_val)
            size = len(blob)
        except Exception:
            pass

        return MutEntry(
            name=name,
            path=path,
            type=detect_type(name),
            content_hash=hash_val,
            size_bytes=size,
            mime_type=detect_mime(name),
        )

    def list_tree(
        self, project_id: str, path: str = "", max_depth: int = -1
    ) -> list[MutEntry]:
        """递归列出目录树（用于完整 tree view）。

        max_depth = -1 表示无限递归。
        """
        try:
            repo = self._repos.get_repo(project_id)
            root_hash = repo.history.get_root_hash()
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get root hash for list_tree: {e}")
            return []
        if not root_hash:
            return []

        tree_hash = root_hash
        if path:
            tree_hash = self._navigate_to_subtree(repo.store, root_hash, path)
            if not tree_hash:
                return []

        result: list[MutEntry] = []
        self._walk_tree(repo.store, tree_hash, path, result, 0, max_depth)
        return result

    def exists(self, project_id: str, path: str) -> bool:
        """检查路径是否存在。"""
        return self.stat(project_id, path) is not None

    def get_root_hash(self, project_id: str) -> str:
        """获取项目当前的 root hash。"""
        try:
            repo = self._repos.get_repo(project_id)
            return repo.history.get_root_hash() or ""
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get root hash: {e}")
            return ""

    def get_version(self, project_id: str) -> int:
        """获取项目当前版本号。"""
        try:
            repo = self._repos.get_repo(project_id)
            return repo.history.get_latest_version()
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get version: {e}")
            return 0

    # ── Internal helpers ──

    def _navigate_to_subtree(
        self, store: ObjectStore, root_hash: str, path: str
    ) -> Optional[str]:
        parts = [p for p in path.split("/") if p]
        current = root_hash
        for part in parts:
            try:
                entries = read_tree(store, current)
            except Exception:
                return None
            if part not in entries:
                return None
            typ, h = entries[part]
            if typ != "T":
                return None
            current = h
        return current

    def _resolve_blob(
        self, store: ObjectStore, root_hash: str, path: str
    ) -> Optional[str]:
        if not root_hash:
            return None
        try:
            flat = tree_to_flat(store, root_hash)
            return flat.get(path)
        except Exception:
            return None

    def _count_children(self, store: ObjectStore, tree_hash: str) -> int:
        try:
            entries = read_tree(store, tree_hash)
            return sum(1 for name in entries if name != ".keep")
        except Exception:
            return 0

    def _walk_tree(
        self,
        store: ObjectStore,
        tree_hash: str,
        prefix: str,
        result: list[MutEntry],
        depth: int,
        max_depth: int,
    ) -> None:
        if max_depth >= 0 and depth > max_depth:
            return

        try:
            entries = read_tree(store, tree_hash)
        except Exception:
            return

        for name, (typ, hash_val) in sorted(entries.items()):
            if name == ".keep":
                continue

            entry_path = f"{prefix}/{name}" if prefix else name

            if typ == "T":
                child_count = self._count_children(store, hash_val)
                result.append(MutEntry(
                    name=name,
                    path=entry_path,
                    type="folder",
                    children_count=child_count,
                ))
                self._walk_tree(
                    store, hash_val, entry_path, result, depth + 1, max_depth
                )
            else:
                result.append(MutEntry(
                    name=name,
                    path=entry_path,
                    type=detect_type(name),
                    content_hash=hash_val,
                    mime_type=detect_mime(name),
                ))
