"""
MutWriteService — PuppyOne 的唯一内容写入入口

所有内容变更通过 Mut 操作:
  1. 内容 → ObjectStore (S3, content-addressable)
  2. 树更新 → Merkle tree (graft)
  3. 版本记录 → SupabaseHistoryManager
  4. 审计日志 → SupabaseAuditManager
  5. 一致性维护 → post-commit hook (connections path + scope path)

设计原则：
  - Mut tree 是唯一 SOT（内容 + 树结构）
  - connections.path 和 scope.path 通过 post-commit 保持一致
"""

from __future__ import annotations

import json
import os
import time
from typing import Optional, Any

from mut.core.object_store import ObjectStore
from mut.core.tree import write_blob, write_tree, read_tree, tree_to_flat
from mut.core.merge import three_way_merge, ConflictResolver
from mut.core.diff import diff_trees
from mut.server.graft import graft_subtree

from src.mut_engine.repo_manager import MutRepoManager, ProjectRepo
from src.mut_engine.schemas import WriteResult, DeleteResult, MoveResult
from src.utils.logger import log_info, log_error, log_warning


class MutWriteService:
    """PuppyOne 的唯一写入入口。所有内容变更通过 Mut 操作。"""

    def __init__(self, repo_manager: MutRepoManager):
        self._repos = repo_manager

    def _get_supabase_client(self):
        from src.infra.supabase.client import SupabaseClient
        return SupabaseClient()

    # ================================================================
    # Post-commit hook: 维护 connections 表一致性
    # ================================================================

    def _post_commit_delete(self, project_id: str, deleted_paths: list[str]) -> None:
        """After deleting paths from MUT tree, clean up dangling connections.

        Nullifies path on connections that referenced deleted paths.
        Also updates scope.path if it falls under a deleted subtree.
        """
        if not deleted_paths:
            return
        try:
            client = self._get_supabase_client().client
            resp = (
                client.table("connections")
                .select("id, path, config")
                .eq("project_id", project_id)
                .execute()
            )
            for row in resp.data or []:
                node_path = row.get("path") or ""
                conn_id = row["id"]

                if node_path and self._path_matches_any(node_path, deleted_paths):
                    client.table("connections").update(
                        {"path": None}
                    ).eq("id", conn_id).execute()
                    log_info(f"[PostCommit] Cleared dangling path on connection {conn_id}")

                config = row.get("config") or {}
                scope = config.get("scope") or {}
                scope_path = scope.get("path", "")
                if scope_path and self._path_matches_any(scope_path, deleted_paths):
                    config = dict(config)
                    config["scope"] = {**scope, "path": "", "_orphaned_from": scope_path}
                    client.table("connections").update(
                        {"config": config}
                    ).eq("id", conn_id).execute()
                    log_warning(f"[PostCommit] Orphaned scope path on connection {conn_id}")

        except Exception as e:
            log_error(f"[PostCommit] delete hook failed: {e}")

    def _post_commit_move(self, project_id: str, old_prefix: str, new_prefix: str) -> None:
        """After moving/renaming paths in MUT tree, update connections references."""
        try:
            client = self._get_supabase_client().client
            resp = (
                client.table("connections")
                .select("id, path, config")
                .eq("project_id", project_id)
                .execute()
            )
            for row in resp.data or []:
                node_path = row.get("path") or ""
                conn_id = row["id"]
                updates: dict = {}

                if node_path:
                    new_node_path = self._rewrite_path(node_path, old_prefix, new_prefix)
                    if new_node_path != node_path:
                        updates["path"] = new_node_path

                config = row.get("config") or {}
                scope = config.get("scope") or {}
                scope_path = scope.get("path", "")
                if scope_path:
                    new_scope_path = self._rewrite_path(scope_path, old_prefix, new_prefix)
                    if new_scope_path != scope_path:
                        config = dict(config)
                        config["scope"] = {**scope, "path": new_scope_path}
                        updates["config"] = config

                if updates:
                    client.table("connections").update(updates).eq("id", conn_id).execute()
                    log_info(f"[PostCommit] Updated connection {conn_id} after move")

        except Exception as e:
            log_error(f"[PostCommit] move hook failed: {e}")

    @staticmethod
    def _path_matches_any(path: str, deleted_paths: list[str]) -> bool:
        """Check if path equals or is a child of any deleted path."""
        normalized = path.strip("/")
        for dp in deleted_paths:
            dp_norm = dp.strip("/")
            if normalized == dp_norm or normalized.startswith(dp_norm + "/"):
                return True
        return False

    @staticmethod
    def _rewrite_path(path: str, old_prefix: str, new_prefix: str) -> str:
        """Replace old_prefix with new_prefix in path."""
        old_norm = old_prefix.rstrip("/")
        new_norm = new_prefix.rstrip("/")
        if path == old_norm:
            return new_norm
        if path.startswith(old_norm + "/"):
            return new_norm + path[len(old_norm):]
        return path

    # ================================================================
    # 初始化
    # ================================================================

    async def init_tree(self, project_id: str) -> str:
        """为项目初始化一个空的 Mut tree。

        如果项目已有 root_hash 且 blob 存在于 S3，则不操作（幂等）。
        返回 root_hash。
        """
        repo = self._repos.get_repo(project_id)
        existing = repo.history.get_root_hash()
        backend = repo.store._backend

        if existing and hasattr(backend, 'async_exists'):
            if await backend.async_exists(existing):
                return existing
            log_warning(f"[MutWrite] root_hash {existing} set in PG but missing in S3, re-uploading")

        empty_tree = json.dumps({}, sort_keys=True).encode()

        from mut.core.object_store import hash_bytes
        root_hash = hash_bytes(empty_tree)

        if hasattr(backend, 'async_put'):
            await backend.async_put(root_hash, empty_tree)
        else:
            import asyncio
            await asyncio.to_thread(repo.store.put, empty_tree)

        repo.history.set_root_hash(root_hash)
        if not existing:
            repo.history.set_latest_version(0)

        log_info(f"[MutWrite] Initialized empty tree for project {project_id}")
        return root_hash

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
        """创建或更新文件 — 核心写操作。"""
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
                    return WriteResult(
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

        log_info(f"[MutWrite] v{new_version}: {op} {path} (project={project_id})")

        return WriteResult(
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
        """删除文件（从 Mut tree 中移除）。"""
        repo = self._repos.get_repo(project_id)
        current_root = repo.history.get_root_hash()
        current_version = repo.history.get_latest_version()

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

        log_info(f"[MutWrite] v{new_version}: deleted {path}")

        self._post_commit_delete(project_id, [path])

        return DeleteResult(
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
        """移动/重命名文件。"""
        repo = self._repos.get_repo(project_id)
        current_root = repo.history.get_root_hash()
        current_version = repo.history.get_latest_version()

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

        log_info(f"[MutWrite] v{new_version}: moved {old_path} → {new_path}")

        self._post_commit_move(project_id, old_path, new_path)

        return MoveResult(
            version=new_version,
            root_hash=new_root,
            old_path=old_path,
            new_path=new_path,
        )

    async def move_folder(
        self,
        project_id: str,
        old_path: str,
        new_path: str,
        operator: str,
        message: str = "",
    ) -> MoveResult:
        """移动/重命名文件夹（批量移动子树中所有文件）。"""
        repo = self._repos.get_repo(project_id)
        current_root = repo.history.get_root_hash()
        current_version = repo.history.get_latest_version()

        if not current_root:
            raise ValueError(f"Folder not found: {old_path}")

        flat = tree_to_flat(repo.store, current_root)

        old_prefix = old_path.rstrip("/") + "/"
        files_to_move = {p: h for p, h in flat.items() if p.startswith(old_prefix) or p == old_path}

        if not files_to_move:
            raise ValueError(f"Folder not found or empty: {old_path}")

        new_flat = dict(flat)
        changes = []
        for old_p, blob_hash in files_to_move.items():
            new_p = new_path + old_p[len(old_path.rstrip("/")):]
            del new_flat[old_p]
            new_flat[new_p] = blob_hash
            changes.append({"path": old_p, "op": "deleted"})
            changes.append({"path": new_p, "op": "added"})

        new_root = _build_tree_from_flat(repo.store, new_flat)

        new_version = current_version + 1
        repo.history.record(
            version=new_version,
            who=operator,
            message=message or f"moved folder {old_path} → {new_path}",
            scope_path="",
            changes=changes,
            root_hash=new_root,
        )
        repo.history.set_latest_version(new_version)
        repo.history.set_root_hash(new_root)

        repo.audit.record("move_folder", operator, {
            "old_path": old_path, "new_path": new_path, "version": new_version
        })

        log_info(f"[MutWrite] v{new_version}: moved folder {old_path} → {new_path}")

        self._post_commit_move(project_id, old_path, new_path)

        return MoveResult(
            version=new_version,
            root_hash=new_root,
            old_path=old_path,
            new_path=new_path,
        )

    async def mkdir(
        self,
        project_id: str,
        path: str,
        operator: str,
    ) -> WriteResult:
        """创建空目录（通过写入 .keep sentinel 文件）。"""
        keep_path = f"{path}/.keep"
        return await self.write_file(
            project_id=project_id,
            path=keep_path,
            content=b"",
            operator=operator,
            message=f"mkdir {path}",
        )

    async def trash(
        self,
        project_id: str,
        path: str,
        operator: str,
    ) -> MoveResult:
        """软删除：移动到 .trash/ 目录。"""
        basename = path.rsplit("/", 1)[-1] if "/" in path else path
        trash_path = f".trash/{basename}_{int(time.time())}"

        from src.mut_engine.tree_reader import MutTreeReader
        reader = MutTreeReader(self._repos)
        entry = reader.stat(project_id, path)

        if entry and entry.type == "folder":
            return await self.move_folder(
                project_id, path, trash_path, operator, f"trash {basename}",
            )
        return await self.move_file(
            project_id, path, trash_path, operator, f"trash {basename}",
        )

    async def restore(
        self,
        project_id: str,
        trash_path: str,
        original_path: str,
        operator: str,
    ) -> MoveResult:
        """从 .trash 恢复。"""
        from src.mut_engine.tree_reader import MutTreeReader
        reader = MutTreeReader(self._repos)
        entry = reader.stat(project_id, trash_path)

        if entry and entry.type == "folder":
            return await self.move_folder(
                project_id, trash_path, original_path, operator, f"restore {original_path}",
            )
        return await self.move_file(
            project_id, trash_path, original_path, operator, f"restore {original_path}",
        )

    async def delete_folder(
        self,
        project_id: str,
        path: str,
        operator: str,
        message: str = "",
    ) -> DeleteResult:
        """删除文件夹（从 Mut tree 中移除所有子文件）。"""
        repo = self._repos.get_repo(project_id)
        current_root = repo.history.get_root_hash()
        current_version = repo.history.get_latest_version()

        if not current_root:
            raise ValueError(f"Folder not found: {path}")

        flat = tree_to_flat(repo.store, current_root)
        prefix = path.rstrip("/") + "/"
        changes = []

        new_flat = {}
        for p, h in flat.items():
            if p.startswith(prefix) or p == path:
                changes.append({"path": p, "op": "deleted"})
            else:
                new_flat[p] = h

        if not changes:
            raise ValueError(f"Folder not found or empty: {path}")

        if new_flat:
            new_root = _build_tree_from_flat(repo.store, new_flat)
        else:
            new_root = repo.store.put(json.dumps({}, sort_keys=True).encode())

        new_version = current_version + 1
        repo.history.record(
            version=new_version,
            who=operator,
            message=message or f"deleted folder {path}",
            scope_path="",
            changes=changes,
            root_hash=new_root,
        )
        repo.history.set_latest_version(new_version)
        repo.history.set_root_hash(new_root)

        repo.audit.record("delete_folder", operator, {"path": path, "version": new_version})

        log_info(f"[MutWrite] v{new_version}: deleted folder {path} ({len(changes)} files)")

        deleted_paths = [c["path"] for c in changes]
        deleted_paths.append(path)
        self._post_commit_delete(project_id, deleted_paths)

        return DeleteResult(
            version=new_version,
            root_hash=new_root,
            path=path,
        )

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
        """回滚到指定版本"""
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

        log_info(f"[MutWrite] Rolled back to v{target_version} as v{new_version}")

        deleted_in_rollback = [
            c["path"] for c in changes_list if c.get("op") == "deleted"
        ]
        if deleted_in_rollback:
            self._post_commit_delete(project_id, deleted_in_rollback)

        return new_version


# ================================================================
# Tree 操作辅助函数
# ================================================================

def _resolve_path_hash(store: ObjectStore, root_hash: str, path: str) -> str:
    if not root_hash:
        return ""
    try:
        flat = tree_to_flat(store, root_hash)
        return flat.get(path, "")
    except Exception:
        return ""


def _update_tree(store: ObjectStore, current_root: str, path: str, blob_hash: str) -> str:
    if not current_root:
        return _build_tree_from_single_file(store, path, blob_hash)

    flat = tree_to_flat(store, current_root)
    flat[path] = blob_hash
    return _build_tree_from_flat(store, flat)


def _build_tree_from_single_file(store: ObjectStore, path: str, blob_hash: str) -> str:
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
    if not root_hash:
        return ""

    flat = tree_to_flat(store, root_hash)
    flat.pop(path, None)

    if not flat:
        return store.put(json.dumps({}, sort_keys=True).encode())

    return _build_tree_from_flat(store, flat)


def _build_tree_from_flat(store: ObjectStore, flat: dict[str, str]) -> str:
    nested: dict = {}
    for filepath, blob_hash in flat.items():
        parts = filepath.split("/")
        d = nested
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        d[parts[-1]] = ("B", blob_hash)

    return _write_nested_tree(store, nested)


def _write_nested_tree(store: ObjectStore, node: dict) -> str:
    entries: dict = {}
    for name, val in sorted(node.items()):
        if isinstance(val, tuple):
            entries[name] = list(val)
        else:
            sub_hash = _write_nested_tree(store, val)
            entries[name] = ["T", sub_hash]
    return store.put(json.dumps(entries, sort_keys=True).encode())
