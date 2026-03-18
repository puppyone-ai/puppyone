"""
MutCompatService — 兼容层

保持与旧 CollaborationService 完全相同的接口:
  commit(Mutation) → CommitResult
  checkout(node_id) → WorkingCopy
  get_version_history / compute_diff / rollback_file 等

内部全部委托给 MutWriteService（版本管理、冲突合并、审计日志均由 Mut 内核处理）。
旧的 VersionService / LockService / ConflictService / AuditService 已删除。
"""

from __future__ import annotations

import json
import os
from typing import Optional, Any, List, Callable

from src.collaboration.schemas import (
    Mutation, MutationType, Operator,
    WorkingCopy, CommitResult,
    VersionHistoryResponse, FileVersionDetail, FileVersionInfo,
    FolderSnapshotHistoryResponse,
    RollbackResponse, FolderRollbackResponse,
    DiffResponse, DiffItem,
)
from src.content_node.repository import ContentNodeRepository
from src.mut_core.write_service import MutWriteService
from src.mut_core.repo_manager import MutRepoManager
from src.content_node.service import ContentNodeService
from src.utils.logger import log_info, log_error, log_warning


class MutCompatService:
    """Drop-in replacement for CollaborationService.

    Same public API, but internally powered by Mut.
    """

    def __init__(
        self,
        node_repo: ContentNodeRepository,
        node_service: ContentNodeService,
        mut_write: MutWriteService,
        repo_manager: MutRepoManager,
    ):
        self._node_repo = node_repo
        self._node_svc = node_service
        self._mut = mut_write
        self._repos = repo_manager
        self._hooks: List[Callable] = []

    def register_hook(self, hook: Callable):
        self._hooks.append(hook)

    async def _run_hooks(self, mutation: Mutation, result: CommitResult):
        for hook in self._hooks:
            try:
                await hook(mutation, result)
            except Exception as e:
                log_error(f"[MutCompat] Hook {hook.__name__} failed: {e}")

    # ================================================================
    # commit — 唯一写入入口（兼容旧接口）
    # ================================================================

    async def commit(self, mutation: Mutation) -> CommitResult:
        t = mutation.type
        if t == MutationType.CONTENT_UPDATE:
            result = await self._do_content_update(mutation)
        elif t == MutationType.NODE_CREATE:
            result = await self._do_node_create(mutation)
        elif t == MutationType.NODE_DELETE:
            result = await self._do_node_delete(mutation)
        elif t == MutationType.NODE_RENAME:
            result = await self._do_node_rename(mutation)
        elif t == MutationType.NODE_MOVE:
            result = await self._do_node_move(mutation)
        else:
            raise ValueError(f"Unknown mutation type: {mutation.type}")

        await self._run_hooks(mutation, result)
        return result

    # ── CONTENT_UPDATE ──

    async def _do_content_update(self, m: Mutation) -> CommitResult:
        node = self._node_repo.get_by_id(m.node_id)
        if not node:
            raise ValueError(f"Node not found: {m.node_id}")

        project_id = node.project_id
        path = node.mut_path or self._derive_mut_path(node)
        operator = _format_operator(m.operator)
        content_bytes = _serialize_content(m.content, m.node_type)

        result = await self._mut.write_file(
            project_id=project_id,
            path=path,
            content=content_bytes,
            operator=operator,
            message=m.operator.summary or "",
            base_version=m.base_version,
        )

        final_content = m.content
        if result.op == "unchanged":
            final_content = m.content

        return CommitResult(
            node_id=result.node_id or m.node_id,
            status="merged" if result.conflicts else "clean",
            version=result.version,
            final_content=final_content,
            strategy="mut_merge" if result.conflicts else "direct",
            lww_applied=any(c.get("strategy") == "lww" for c in result.conflicts),
            lww_details={"conflicts": result.conflicts} if result.conflicts else None,
        )

    # ── NODE_CREATE ──

    async def _do_node_create(self, m: Mutation) -> CommitResult:
        operator = _format_operator(m.operator)

        if m.node_type == "folder":
            parent_path = self._get_parent_path(m.parent_id, m.project_id)
            folder_path = f"{parent_path}/{m.name}" if parent_path else m.name
            node = self._node_svc.create_folder(
                project_id=m.project_id,
                name=m.name,
                parent_id=m.parent_id,
                created_by=m.created_by,
            )
            self._node_repo.update(node_id=node.id, mut_path=folder_path)
            return CommitResult(
                node_id=node.id, status="clean", version=0,
                final_content=None, strategy="direct",
            )

        parent_path = self._get_parent_path(m.parent_id, m.project_id)
        filename = _add_extension(m.name, m.node_type)
        path = f"{parent_path}/{filename}" if parent_path else filename

        content_bytes = _serialize_content(m.content, m.node_type)

        node = self._create_node_in_db(m)
        self._node_repo.update(node_id=node.id, mut_path=path)

        result = await self._mut.write_file(
            project_id=m.project_id,
            path=path,
            content=content_bytes,
            operator=operator,
            message=m.operator.summary or f"create {m.name}",
        )

        return CommitResult(
            node_id=node.id, status="clean",
            version=result.version,
            final_content=m.content, strategy="direct",
        )

    # ── NODE_DELETE ──

    async def _do_node_delete(self, m: Mutation) -> CommitResult:
        node = self._node_repo.get_by_id(m.node_id)
        if not node:
            raise ValueError(f"Node not found: {m.node_id}")

        operator = _format_operator(m.operator)

        self._node_svc.soft_delete_node(
            node_id=m.node_id,
            project_id=m.project_id or node.project_id,
            user_id=m.created_by,
        )

        if node.mut_path and node.type != "folder":
            try:
                await self._mut.delete_file(
                    project_id=node.project_id,
                    path=node.mut_path,
                    operator=operator,
                    message=m.operator.summary or f"delete {node.name}",
                )
            except Exception as e:
                log_warning(f"[MutCompat] Failed to delete from Mut tree: {e}")

        return CommitResult(
            node_id=m.node_id, status="clean",
            version=node.current_version or 0,
            strategy="direct",
        )

    # ── NODE_RENAME ──

    async def _do_node_rename(self, m: Mutation) -> CommitResult:
        node = self._node_svc.update_node(
            node_id=m.node_id,
            project_id=m.project_id,
            name=m.new_name,
        )
        operator = _format_operator(m.operator)

        if node.mut_path and node.type != "folder":
            old_path = node.mut_path
            parent_dir = os.path.dirname(old_path)
            new_filename = _add_extension(m.new_name, node.type)
            new_path = f"{parent_dir}/{new_filename}" if parent_dir else new_filename

            try:
                result = await self._mut.move_file(
                    project_id=node.project_id,
                    old_path=old_path,
                    new_path=new_path,
                    operator=operator,
                    message=m.operator.summary or f"rename {node.name} → {m.new_name}",
                )
                self._node_repo.update(node_id=m.node_id, mut_path=new_path)
                return CommitResult(
                    node_id=m.node_id, status="clean",
                    version=result.version,
                    strategy="direct",
                )
            except Exception as e:
                log_warning(f"[MutCompat] Failed to rename in Mut tree: {e}")

        return CommitResult(
            node_id=m.node_id, status="clean",
            version=node.current_version or 0,
            strategy="direct",
        )

    # ── NODE_MOVE ──

    async def _do_node_move(self, m: Mutation) -> CommitResult:
        node = self._node_svc.move_node(
            node_id=m.node_id,
            project_id=m.project_id,
            new_parent_id=m.new_parent_id,
        )
        operator = _format_operator(m.operator)

        if node.mut_path and node.type != "folder":
            old_path = node.mut_path
            new_parent_path = self._get_parent_path(m.new_parent_id, m.project_id or node.project_id)
            filename = os.path.basename(old_path)
            new_path = f"{new_parent_path}/{filename}" if new_parent_path else filename

            try:
                result = await self._mut.move_file(
                    project_id=node.project_id,
                    old_path=old_path,
                    new_path=new_path,
                    operator=operator,
                    message=m.operator.summary or f"move {filename}",
                )
                self._node_repo.update(node_id=m.node_id, mut_path=new_path)
                return CommitResult(
                    node_id=m.node_id, status="clean",
                    version=result.version,
                    strategy="direct",
                )
            except Exception as e:
                log_warning(f"[MutCompat] Failed to move in Mut tree: {e}")

        return CommitResult(
            node_id=m.node_id, status="clean",
            version=node.current_version or 0,
            strategy="direct",
        )

    # ================================================================
    # checkout — 兼容旧接口
    # ================================================================

    def checkout(
        self,
        node_id: str,
        operator_type: str = "agent",
        operator_id: Optional[str] = None,
    ) -> Optional[WorkingCopy]:
        node = self._node_repo.get_by_id(node_id)
        if not node:
            return None

        content_str = None
        content_json = None

        if node.content_hash and node.project_id:
            try:
                repo = self._repos.get_repo(node.project_id)
                content_bytes = repo.store.get(node.content_hash)
                if node.type == "json":
                    content_json = json.loads(content_bytes.decode("utf-8"))
                    content_str = content_bytes.decode("utf-8")
                else:
                    content_str = content_bytes.decode("utf-8", errors="replace")
            except Exception as e:
                log_warning(f"[MutCompat] checkout: failed to read blob {node.content_hash}: {e}")

        return WorkingCopy(
            node_id=node_id,
            node_type=node.type,
            content=content_str,
            content_json=content_json,
            base_version=node.current_version or 0,
            content_hash=node.content_hash,
        )

    def checkout_batch(
        self,
        node_ids: List[str],
        operator_type: str = "agent",
        operator_id: Optional[str] = None,
    ) -> List[WorkingCopy]:
        return [
            wc for nid in node_ids
            if (wc := self.checkout(nid, operator_type, operator_id)) is not None
        ]

    # ================================================================
    # 查询 — 委托 MutWriteService
    # ================================================================

    def get_version_history(
        self, node_id: str, limit: int = 50, offset: int = 0
    ) -> VersionHistoryResponse:
        node = self._node_repo.get_by_id(node_id)
        if not node:
            from src.exceptions import NotFoundException, ErrorCode
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)

        repo = self._repos.get_repo(node.project_id)
        entries = repo.history.get_since(0, limit=limit)

        if node.mut_path:
            entries = [
                e for e in entries
                if any(c.get("path") == node.mut_path for c in e.get("changes", []))
            ]

        version_infos = [
            FileVersionInfo(
                id=e.get("id", 0),
                version=e.get("version", 0),
                content_hash=e.get("root_hash", ""),
                size_bytes=0,
                operator_type=_parse_operator_type(e.get("who", "")),
                operator_id=_parse_operator_id(e.get("who", "")),
                operation="update",
                summary=e.get("message", ""),
                created_at=e.get("created_at"),
            )
            for e in entries[offset:offset + limit]
        ]

        return VersionHistoryResponse(
            node_id=node_id,
            node_name=node.name,
            current_version=node.current_version or 0,
            versions=version_infos,
            total=len(entries),
        )

    def get_version_content(self, node_id: str, version: int) -> FileVersionDetail:
        node = self._node_repo.get_by_id(node_id)
        if not node:
            from src.exceptions import NotFoundException, ErrorCode
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)

        repo = self._repos.get_repo(node.project_id)
        entry = repo.history.get_entry(version)
        if not entry:
            from src.exceptions import NotFoundException, ErrorCode
            raise NotFoundException(f"Version {version} not found", code=ErrorCode.NOT_FOUND)

        content_json = None
        content_text = None
        root_hash = entry.get("root_hash", "")

        if node.mut_path and root_hash:
            try:
                from mut.core.tree import tree_to_flat
                flat = tree_to_flat(repo.store, root_hash)
                blob_hash = flat.get(node.mut_path, "")
                if blob_hash:
                    content_bytes = repo.store.get(blob_hash)
                    if node.type == "json":
                        content_json = json.loads(content_bytes.decode("utf-8"))
                    else:
                        content_text = content_bytes.decode("utf-8")
            except Exception as e:
                log_error(f"[MutCompat] Failed to read version content: {e}")

        return FileVersionDetail(
            id=entry.get("id", 0),
            node_id=node_id,
            version=version,
            content_json=content_json,
            content_text=content_text,
            content_hash=root_hash,
            size_bytes=0,
            operator_type=_parse_operator_type(entry.get("who", "")),
            operator_id=_parse_operator_id(entry.get("who", "")),
            operation="update",
            summary=entry.get("message", ""),
            created_at=entry.get("created_at"),
        )

    def get_snapshot_history(
        self, folder_node_id: str, limit: int = 50, offset: int = 0
    ) -> FolderSnapshotHistoryResponse:
        node = self._node_repo.get_by_id(folder_node_id)
        name = node.name if node else "unknown"
        return FolderSnapshotHistoryResponse(
            folder_node_id=folder_node_id,
            folder_name=name,
            snapshots=[],
            total=0,
        )

    def compute_diff(self, node_id: str, v1: int, v2: int) -> DiffResponse:
        node = self._node_repo.get_by_id(node_id)
        if not node:
            return DiffResponse(node_id=node_id, v1=v1, v2=v2, changes=[])

        repo = self._repos.get_repo(node.project_id)
        e1 = repo.history.get_entry(v1)
        e2 = repo.history.get_entry(v2)

        if not e1 or not e2:
            return DiffResponse(node_id=node_id, v1=v1, v2=v2, changes=[])

        try:
            tree_changes = diff_trees(
                repo.store, e1.get("root_hash", ""), e2.get("root_hash", "")
            )
            items = [
                DiffItem(path=c.get("path", ""), change_type=c.get("op", "changed"))
                for c in tree_changes
                if not node.mut_path or c.get("path") == node.mut_path
            ]
            return DiffResponse(node_id=node_id, v1=v1, v2=v2, changes=items)
        except Exception:
            return DiffResponse(node_id=node_id, v1=v1, v2=v2, changes=[])

    # ================================================================
    # 回滚 — 委托 MutWriteService
    # ================================================================

    def rollback_file(
        self, node_id: str, target_version: int, operator_id: Optional[str] = None
    ) -> RollbackResponse:
        node = self._node_repo.get_by_id(node_id)
        if not node:
            from src.exceptions import NotFoundException, ErrorCode
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)

        import asyncio
        operator = f"user:{operator_id}" if operator_id else "system"

        try:
            loop = asyncio.get_event_loop()
            new_version = loop.run_until_complete(
                self._mut.rollback(node.project_id, target_version, operator)
            )
        except RuntimeError:
            new_version = asyncio.run(
                self._mut.rollback(node.project_id, target_version, operator)
            )

        return RollbackResponse(
            node_id=node_id,
            new_version=new_version,
            rolled_back_to=target_version,
        )

    def rollback_folder(
        self, folder_node_id: str, target_snapshot_id: int, operator_id: Optional[str] = None
    ) -> FolderRollbackResponse:
        return FolderRollbackResponse(
            folder_node_id=folder_node_id,
            new_snapshot_id=0,
            rolled_back_to_snapshot=target_snapshot_id,
            files_restored=0,
        )

    def create_folder_snapshot(self, **kwargs):
        pass

    # ================================================================
    # 辅助方法
    # ================================================================

    def _derive_mut_path(self, node) -> str:
        """从 content_node 推导 Mut 路径"""
        parts = []
        current = node
        while current:
            parts.append(_add_extension(current.name, current.type) if current.type != "folder" else current.name)
            parent_id = current.parent_id
            if not parent_id:
                break
            current = self._node_repo.get_by_id(parent_id)

        parts.reverse()
        path = "/".join(parts)

        if not node.mut_path:
            self._node_repo.update(node_id=node.id, mut_path=path)

        return path

    def _get_parent_path(self, parent_id: Optional[str], project_id: str) -> str:
        if not parent_id:
            return ""
        parent = self._node_repo.get_by_id(parent_id)
        if not parent:
            return ""
        if parent.mut_path:
            return parent.mut_path
        return self._derive_mut_path(parent)

    def _create_node_in_db(self, m: Mutation):
        content_bytes = _serialize_content(m.content, m.node_type)
        size_bytes = len(content_bytes) if content_bytes else None

        if m.node_type == "json":
            return self._node_svc.create_json_node(
                project_id=m.project_id,
                name=m.name,
                parent_id=m.parent_id,
                created_by=m.created_by,
                size_bytes=size_bytes,
            )
        elif m.node_type == "markdown":
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                return loop.run_until_complete(
                    self._node_svc.create_markdown_node(
                        project_id=m.project_id,
                        name=m.name,
                        parent_id=m.parent_id,
                        created_by=m.created_by,
                        size_bytes=size_bytes,
                    )
                )
            except RuntimeError:
                return asyncio.run(
                    self._node_svc.create_markdown_node(
                        project_id=m.project_id,
                        name=m.name,
                        parent_id=m.parent_id,
                        created_by=m.created_by,
                        size_bytes=size_bytes,
                    )
                )
        elif m.node_type == "file":
            return self._node_svc.create_file_node(
                project_id=m.project_id,
                name=m.name,
                s3_key=m.content if isinstance(m.content, str) else "",
                parent_id=m.parent_id,
                created_by=m.created_by,
            )
        raise ValueError(f"Unsupported node_type: {m.node_type}")


# ================================================================
# 工具函数
# ================================================================

def _format_operator(op: Operator) -> str:
    return f"{op.type}:{op.id}" if op.id else op.type


def _serialize_content(content: Any, node_type: str) -> bytes:
    if content is None:
        return b""
    if isinstance(content, bytes):
        return content
    if node_type == "json":
        if isinstance(content, str):
            return content.encode("utf-8")
        return json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")
    if isinstance(content, str):
        return content.encode("utf-8")
    return str(content).encode("utf-8")


def _add_extension(name: str, node_type: str) -> str:
    if not name:
        return name
    if node_type == "json" and not name.endswith(".json"):
        return f"{name}.json"
    if node_type == "markdown" and not name.endswith(".md"):
        return f"{name}.md"
    return name


def _parse_operator_type(who: str) -> str:
    if ":" in who:
        return who.split(":", 1)[0]
    return who or "system"


def _parse_operator_id(who: str) -> str:
    if ":" in who:
        return who.split(":", 1)[1]
    return who


try:
    from mut.core.diff import diff_trees
except ImportError:
    def diff_trees(*args, **kwargs):
        return []
