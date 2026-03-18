"""
IndexSync — Mut tree → content_nodes 同步

每次 Mut commit 后，根据 changeset 增量更新 content_nodes 表。
content_nodes 是 read-side index，可随时从 Mut tree 重建。
"""

from __future__ import annotations

import json
import os
from typing import Optional

from mut.core.object_store import ObjectStore
from mut.core.tree import read_tree, tree_to_flat
from mut.foundation.hash import hash_bytes

from src.content_node.repository import ContentNodeRepository
from src.utils.logger import log_info, log_error, log_debug


def detect_node_type(path: str) -> str:
    """从文件路径推断 content_node type"""
    if path.endswith(".json"):
        return "json"
    if path.endswith(".md") or path.endswith(".markdown"):
        return "markdown"
    return "file"


def detect_mime_type(path: str) -> str:
    """从文件路径推断 MIME type"""
    ext = os.path.splitext(path)[1].lower()
    mime_map = {
        ".json": "application/json",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".txt": "text/plain",
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".py": "text/x-python",
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }
    return mime_map.get(ext, "application/octet-stream")


class IndexSync:
    """将 Mut tree 变更同步到 content_nodes 表"""

    def __init__(self, node_repo: ContentNodeRepository):
        self._repo = node_repo

    async def sync_changeset(
        self,
        project_id: str,
        store: ObjectStore,
        changes: list[dict],
        root_hash: str,
        version: int,
        operator_id: Optional[str] = None,
    ) -> None:
        """根据 Mut commit 的 changeset 增量更新 content_nodes。

        Args:
            project_id: 项目 ID
            store: Mut ObjectStore（用于读取 blob 内容做 preview 缓存）
            changes: [{"path": "docs/a.md", "op": "added"}, ...]
            root_hash: 新的 Merkle tree root hash
            version: Mut 版本号
            operator_id: 操作者 ID
        """
        for change in changes:
            path = change["path"]
            op = change["op"]

            try:
                if op == "deleted":
                    await self._handle_delete(project_id, path)
                elif op == "added":
                    blob_hash = self._resolve_blob_hash(store, root_hash, path)
                    await self._handle_add(
                        project_id, path, blob_hash, version, store, operator_id
                    )
                elif op == "modified":
                    blob_hash = self._resolve_blob_hash(store, root_hash, path)
                    await self._handle_modify(
                        project_id, path, blob_hash, version, store
                    )
            except Exception as e:
                log_error(f"[IndexSync] Failed to sync {op} for {path}: {e}")

    async def _handle_add(
        self,
        project_id: str,
        path: str,
        blob_hash: str,
        version: int,
        store: ObjectStore,
        operator_id: Optional[str],
    ) -> None:
        name = os.path.basename(path)
        node_type = detect_node_type(path)

        size_bytes = 0
        try:
            content_bytes = await store.async_get(blob_hash)
            size_bytes = len(content_bytes)
        except Exception:
            pass

        self._repo.create_node(
            project_id=project_id,
            name=name,
            node_type=node_type,
            mut_path=path,
            content_hash=blob_hash,
            current_version=version,
            mime_type=detect_mime_type(path),
            size_bytes=size_bytes,
            created_by=operator_id,
        )
        log_debug(f"[IndexSync] Added node for {path}")

    async def _handle_modify(
        self,
        project_id: str,
        path: str,
        blob_hash: str,
        version: int,
        store: ObjectStore,
    ) -> None:
        node = self._repo.get_by_mut_path(project_id, path)
        if not node:
            log_error(f"[IndexSync] Node not found for modify: {path}")
            return

        update_data: dict = {
            "content_hash": blob_hash,
            "current_version": version,
        }

        try:
            content_bytes = await store.async_get(blob_hash)
            update_data["size_bytes"] = len(content_bytes)
        except Exception:
            pass

        self._repo.update(node_id=node.id, **update_data)
        log_debug(f"[IndexSync] Modified node for {path}")

    async def _handle_delete(self, project_id: str, path: str) -> None:
        node = self._repo.get_by_mut_path(project_id, path)
        if node:
            self._repo.delete(node.id)
            log_debug(f"[IndexSync] Deleted node for {path}")

    def _resolve_blob_hash(self, store: ObjectStore, root_hash: str, path: str) -> str:
        """从 Merkle tree 中解析文件路径对应的 blob hash"""
        if not root_hash:
            return ""
        try:
            flat = tree_to_flat(store, root_hash)
            return flat.get(path, "")
        except Exception as e:
            log_error(f"[IndexSync] Failed to resolve {path} in tree {root_hash}: {e}")
            return ""

    async def rebuild_from_tree(
        self, project_id: str, store: ObjectStore, root_hash: str, version: int
    ) -> None:
        """从 Mut tree 完全重建 content_nodes（用于修复/迁移）。

        对每个路径先检查是否已存在，存在则 update，不存在则 add。
        """
        if not root_hash:
            return

        flat = tree_to_flat(store, root_hash)
        for path, blob_hash in flat.items():
            existing = self._repo.get_by_mut_path(project_id, path)
            op = "modified" if existing else "added"
            changes = [{"path": path, "op": op}]
            await self.sync_changeset(project_id, store, changes, root_hash, version)
