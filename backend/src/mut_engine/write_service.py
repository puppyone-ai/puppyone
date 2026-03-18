"""
MutWriteService — PuppyOne 的唯一内容写入入口

替代 CollaborationService。所有内容变更通过 Mut 操作:
  1. 内容 → ObjectStore (S3, content-addressable)
  2. 树更新 → Merkle tree (graft)
  3. 版本记录 → SupabaseHistoryManager
  4. 审计日志 → SupabaseAuditManager
  5. Index 同步 → content_nodes 表

设计原则：
  - Mut 是 source of truth（内容 + 树结构）
  - content_nodes 是 read index（从 Mut 同步）
  - commit 永远成功（三方合并 + LWW 兜底）
"""

from __future__ import annotations

import json
import os
from typing import Optional, Any

from mut.core.object_store import ObjectStore
from mut.core.tree import write_blob, write_tree, read_tree, tree_to_flat
from mut.core.merge import three_way_merge, ConflictResolver
from mut.core.diff import diff_trees
from mut.server.graft import graft_subtree

from src.content.repository import ContentNodeRepository
from src.mut_engine.repo_manager import MutRepoManager, ProjectRepo
from src.mut_engine.index_sync import IndexSync
from src.mut_engine.schemas import WriteResult, DeleteResult, MoveResult
from src.utils.logger import log_info, log_error, log_warning


class MutWriteService:
    """PuppyOne 的唯一写入入口。所有内容变更通过 Mut 操作。"""

    def __init__(
        self,
        repo_manager: MutRepoManager,
        node_repo: ContentNodeRepository,
        index_sync: IndexSync,
    ):
        self._repos = repo_manager
        self._node_repo = node_repo
        self._index_sync = index_sync

    # ================================================================
    # 写入操作
    # ================================================================

    async def write_file(
        self,
        project_id: str,
        path: str,
        content: bytes,
        operator: str,
        message: str = "",
        base_version: int = 0,
    ) -> WriteResult:
        """创建或更新文件 — 核心写操作。

        Args:
            project_id: 项目 ID
            path: Mut 树中的文件路径（如 "docs/notes.md"）
            content: 文件内容（bytes）
            operator: 操作者标识（如 "user:uuid", "agent:uuid", "sync:gmail"）
            message: commit message
            base_version: 客户端基于的版本号（用于冲突检测，0 = 不检测）

        Returns:
            WriteResult
        """
        repo = self._repos.get_repo(project_id)

        blob_hash = repo.store.put(content)

        current_root = repo.history.get_root_hash()
        current_version = repo.history.get_latest_version()

        final_hash = blob_hash
        conflicts: list[dict] = []

        if current_root and base_version > 0 and base_version < current_version:
            existing_hash = _resolve_path_hash(repo.store, current_root, path)
            if existing_hash and existing_hash != blob_hash:
                base_content = b""
                try:
                    base_entry = repo.history.get_entry(base_version)
                    if base_entry:
                        base_root = base_entry.get("root_hash", "")
                        base_hash = _resolve_path_hash(repo.store, base_root, path)
                        if base_hash:
                            base_content = repo.store.get(base_hash)
                except Exception:
                    pass

                current_content = repo.store.get(existing_hash)
                result = three_way_merge(
                    base_content, current_content, content, path, repo.resolver
                )
                final_hash = repo.store.put(result.content)
                conflicts = [
                    {"path": c.path, "strategy": c.strategy, "detail": c.detail}
                    for c in result.conflicts
                ]
                if conflicts:
                    log_warning(f"[MutWrite] Merged {path} with {len(conflicts)} conflict(s)")

        op = "added"
        if current_root:
            existing = _resolve_path_hash(repo.store, current_root, path)
            if existing:
                if existing == final_hash:
                    node = self._node_repo.get_by_mut_path(project_id, path)
                    return WriteResult(
                        node_id=node.id if node else "",
                        version=current_version,
                        content_hash=final_hash,
                        root_hash=current_root,
                        path=path,
                        op="unchanged",
                    )
                op = "modified"

        new_root = _update_tree(repo.store, current_root, path, final_hash)

        new_version = current_version + 1
        changes = [{"path": path, "op": op}]

        repo.history.record(
            version=new_version,
            who=operator,
            message=message or f"{op} {path}",
            scope_path="",
            changes=changes,
            conflicts=conflicts or None,
            root_hash=new_root,
        )
        repo.history.set_latest_version(new_version)
        repo.history.set_root_hash(new_root)

        repo.audit.record("write", operator, {"path": path, "op": op, "version": new_version})

        await self._index_sync.sync_changeset(
            project_id, repo.store, changes, new_root, new_version, operator
        )

        node = self._node_repo.get_by_mut_path(project_id, path)
        node_id = node.id if node else ""

        log_info(f"[MutWrite] v{new_version}: {op} {path} (project={project_id})")

        return WriteResult(
            node_id=node_id,
            version=new_version,
            content_hash=final_hash,
            root_hash=new_root,
            path=path,
            op=op,
            conflicts=conflicts,
        )

    async def delete_file(
        self,
        project_id: str,
        path: str,
        operator: str,
        message: str = "",
    ) -> DeleteResult:
        """删除文件"""
        repo = self._repos.get_repo(project_id)
        current_root = repo.history.get_root_hash()
        current_version = repo.history.get_latest_version()

        node = self._node_repo.get_by_mut_path(project_id, path)
        node_id = node.id if node else ""

        new_root = _remove_from_tree(repo.store, current_root, path)

        new_version = current_version + 1
        changes = [{"path": path, "op": "deleted"}]

        repo.history.record(
            version=new_version,
            who=operator,
            message=message or f"deleted {path}",
            scope_path="",
            changes=changes,
            root_hash=new_root,
        )
        repo.history.set_latest_version(new_version)
        repo.history.set_root_hash(new_root)

        repo.audit.record("delete", operator, {"path": path, "version": new_version})

        await self._index_sync.sync_changeset(
            project_id, repo.store, changes, new_root, new_version, operator
        )

        log_info(f"[MutWrite] v{new_version}: deleted {path}")

        return DeleteResult(
            node_id=node_id,
            version=new_version,
            root_hash=new_root,
            path=path,
        )

    async def move_file(
        self,
        project_id: str,
        old_path: str,
        new_path: str,
        operator: str,
        message: str = "",
    ) -> MoveResult:
        """移动/重命名文件"""
        repo = self._repos.get_repo(project_id)
        current_root = repo.history.get_root_hash()
        current_version = repo.history.get_latest_version()

        node = self._node_repo.get_by_mut_path(project_id, old_path)
        node_id = node.id if node else ""

        blob_hash = _resolve_path_hash(repo.store, current_root, old_path)
        if not blob_hash:
            raise ValueError(f"File not found in tree: {old_path}")

        intermediate_root = _remove_from_tree(repo.store, current_root, old_path)
        new_root = _update_tree(repo.store, intermediate_root, new_path, blob_hash)

        new_version = current_version + 1
        changes = [
            {"path": old_path, "op": "deleted"},
            {"path": new_path, "op": "added"},
        ]

        repo.history.record(
            version=new_version,
            who=operator,
            message=message or f"moved {old_path} → {new_path}",
            scope_path="",
            changes=changes,
            root_hash=new_root,
        )
        repo.history.set_latest_version(new_version)
        repo.history.set_root_hash(new_root)

        repo.audit.record("move", operator, {
            "old_path": old_path, "new_path": new_path, "version": new_version
        })

        await self._index_sync.sync_changeset(
            project_id, repo.store, changes, new_root, new_version, operator
        )

        log_info(f"[MutWrite] v{new_version}: moved {old_path} → {new_path}")

        return MoveResult(
            node_id=node_id,
            version=new_version,
            root_hash=new_root,
            old_path=old_path,
            new_path=new_path,
        )

    async def create_folder(
        self,
        project_id: str,
        path: str,
        operator: str,
    ) -> str:
        """创建文件夹（在 content_nodes 中创建 folder 类型节点）。

        Mut 树中文件夹是隐式的（通过路径前缀），这里只更新 index。
        """
        node = self._node_repo.create_node(
            project_id=project_id,
            name=os.path.basename(path),
            node_type="folder",
            mut_path=path,
        )
        log_info(f"[MutWrite] Created folder: {path}")
        return node.id if hasattr(node, "id") else ""

    # ================================================================
    # 读取操作
    # ================================================================

    async def read_file(self, project_id: str, path: str) -> bytes:
        """从 Mut ObjectStore 读取文件内容"""
        repo = self._repos.get_repo(project_id)
        root = repo.history.get_root_hash()
        if not root:
            raise FileNotFoundError(f"Project {project_id} has no content")

        blob_hash = _resolve_path_hash(repo.store, root, path)
        if not blob_hash:
            raise FileNotFoundError(f"File not found: {path}")

        return repo.store.get(blob_hash)

    async def get_version_history(
        self,
        project_id: str,
        path: str | None = None,
        limit: int = 50,
        since_version: int = 0,
    ) -> list[dict]:
        """获取版本历史"""
        repo = self._repos.get_repo(project_id)
        entries = repo.history.get_since(since_version, limit=limit)

        if path:
            entries = [
                e for e in entries
                if any(c.get("path") == path for c in e.get("changes", []))
            ]

        return entries

    async def get_version_content(
        self,
        project_id: str,
        path: str,
        version: int,
    ) -> bytes:
        """获取某个版本的文件内容"""
        repo = self._repos.get_repo(project_id)
        entry = repo.history.get_entry(version)
        if not entry:
            raise ValueError(f"Version {version} not found")

        root = entry.get("root_hash", "")
        if not root:
            raise ValueError(f"Version {version} has no root hash")

        blob_hash = _resolve_path_hash(repo.store, root, path)
        if not blob_hash:
            raise FileNotFoundError(f"File {path} not found at v{version}")

        return repo.store.get(blob_hash)

    async def compute_diff(
        self, project_id: str, v1: int, v2: int
    ) -> list[dict]:
        """对比两个版本的差异"""
        repo = self._repos.get_repo(project_id)

        entry1 = repo.history.get_entry(v1)
        entry2 = repo.history.get_entry(v2)
        if not entry1 or not entry2:
            raise ValueError(f"Version {v1} or {v2} not found")

        root1 = entry1.get("root_hash", "")
        root2 = entry2.get("root_hash", "")

        if not root1 or not root2:
            return []

        return diff_trees(repo.store, root1, root2)

    async def rollback(
        self,
        project_id: str,
        target_version: int,
        operator: str,
    ) -> int:
        """回滚到指定版本（创建新版本，内容来自目标版本的 tree）"""
        repo = self._repos.get_repo(project_id)

        entry = repo.history.get_entry(target_version)
        if not entry:
            raise ValueError(f"Version {target_version} not found")

        target_root = entry.get("root_hash", "")
        current_root = repo.history.get_root_hash()
        current_version = repo.history.get_latest_version()

        if target_root == current_root:
            return current_version

        changes_list = diff_trees(repo.store, current_root, target_root)

        new_version = current_version + 1
        repo.history.record(
            version=new_version,
            who=operator,
            message=f"Rollback to v{target_version}",
            scope_path="",
            changes=changes_list,
            root_hash=target_root,
        )
        repo.history.set_latest_version(new_version)
        repo.history.set_root_hash(target_root)

        repo.audit.record("rollback", operator, {
            "target_version": target_version, "new_version": new_version
        })

        await self._index_sync.sync_changeset(
            project_id, repo.store, changes_list, target_root, new_version, operator
        )

        log_info(f"[MutWrite] Rolled back to v{target_version} as v{new_version}")
        return new_version


# ================================================================
# Tree 操作辅助函数
# ================================================================

def _resolve_path_hash(store: ObjectStore, root_hash: str, path: str) -> str:
    """从 Merkle tree 中解析文件路径对应的 blob hash"""
    if not root_hash:
        return ""
    try:
        flat = tree_to_flat(store, root_hash)
        return flat.get(path, "")
    except Exception:
        return ""


def _update_tree(store: ObjectStore, current_root: str, path: str, blob_hash: str) -> str:
    """在 Merkle tree 中添加或更新文件，返回新的 root hash。

    策略：读取当前 tree 的扁平映射，更新目标路径，重建整棵树。
    简单可靠，避免 graft 层级计算出错。
    """
    if not current_root:
        return _build_tree_from_single_file(store, path, blob_hash)

    flat = tree_to_flat(store, current_root)
    flat[path] = blob_hash
    return _build_tree_from_flat(store, flat)


def _build_tree_from_single_file(store: ObjectStore, path: str, blob_hash: str) -> str:
    """从单个文件构建 Merkle tree"""
    parts = path.split("/")
    if len(parts) == 1:
        entries = {parts[0]: ["B", blob_hash]}
        return store.put(json.dumps(entries, sort_keys=True).encode())

    current_entries = {parts[-1]: ["B", blob_hash]}
    current_hash = store.put(json.dumps(current_entries, sort_keys=True).encode())

    for dirname in reversed(parts[:-1]):
        parent_entries = {dirname: ["T", current_hash]}
        current_hash = store.put(json.dumps(parent_entries, sort_keys=True).encode())

    return current_hash



def _remove_from_tree(store: ObjectStore, root_hash: str, path: str) -> str:
    """从 Merkle tree 中删除文件，返回新的 root hash"""
    if not root_hash:
        return ""

    flat = tree_to_flat(store, root_hash)
    flat.pop(path, None)

    if not flat:
        return store.put(json.dumps({}, sort_keys=True).encode())

    return _build_tree_from_flat(store, flat)


def _build_tree_from_flat(store: ObjectStore, flat: dict[str, str]) -> str:
    """从扁平的 {path: blob_hash} 字典构建 Merkle tree"""
    nested: dict = {}
    for filepath, blob_hash in flat.items():
        parts = filepath.split("/")
        d = nested
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        d[parts[-1]] = ("B", blob_hash)

    return _write_nested_tree(store, nested)


def _write_nested_tree(store: ObjectStore, node: dict) -> str:
    """递归写入嵌套树结构"""
    entries: dict = {}
    for name, val in sorted(node.items()):
        if isinstance(val, tuple):
            entries[name] = list(val)
        else:
            sub_hash = _write_nested_tree(store, val)
            entries[name] = ["T", sub_hash]
    return store.put(json.dumps(entries, sort_keys=True).encode())
