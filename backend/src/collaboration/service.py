"""
Mut Protocol — CollaborationService

系统中所有变更的唯一入口：commit(mutation)

commit() = Apply + Record + Hook
  Apply  — 执行变更（写数据库）
  Record — 版本快照 + 审计日志
  Hook   — 触发 post-commit hooks（副作用）
"""

import json
from typing import Optional, Any, List, Callable

from src.content_node.repository import ContentNodeRepository
from src.content_node.service import ContentNodeService
from src.collaboration.lock_service import LockService
from src.collaboration.conflict_service import ConflictService
from src.collaboration.version_service import VersionService
from src.collaboration.audit_service import AuditService
from src.collaboration.schemas import (
    Mutation, MutationType, Operator,
    WorkingCopy, CommitResult, MergeResult,
    VersionHistoryResponse, FileVersionDetail,
    FolderSnapshotHistoryResponse,
    RollbackResponse, FolderRollbackResponse,
    DiffResponse,
)
from src.utils.logger import log_info, log_error, log_warning


class CollaborationService:
    """
    Mut Protocol 统一入口

    所有数据写入通过 commit(mutation)。没有第二条写路径。
    """

    def __init__(
        self,
        node_repo: ContentNodeRepository,
        node_service: ContentNodeService,
        lock_service: LockService,
        conflict_service: ConflictService,
        version_service: VersionService,
        audit_service: AuditService,
    ):
        self.node_repo = node_repo
        self.node_svc = node_service
        self.lock_svc = lock_service
        self.conflict_svc = conflict_service
        self.version_svc = version_service
        self.audit_svc = audit_service
        self._hooks: List[Callable] = []

    # ============================================================
    # Hooks
    # ============================================================

    def register_hook(self, hook: Callable):
        """注册 post-commit hook"""
        self._hooks.append(hook)

    async def _run_hooks(self, mutation: Mutation, result: CommitResult):
        for hook in self._hooks:
            try:
                await hook(mutation, result)
            except Exception as e:
                log_error(f"[Mut] Hook {hook.__name__} failed: {e}")

    # ============================================================
    # commit: 唯一写入入口
    # ============================================================

    async def commit(self, mutation: Mutation) -> CommitResult:
        """
        Mut Protocol 核心。

        所有变更通过此方法。commit 永远成功。

        Apply → Record → Hook
        """
        t = mutation.type
        if t == MutationType.CONTENT_UPDATE:
            result = self._apply_content_update(mutation)
        elif t == MutationType.NODE_CREATE:
            result = await self._apply_node_create(mutation)
        elif t == MutationType.NODE_DELETE:
            result = self._apply_node_delete(mutation)
        elif t == MutationType.NODE_RENAME:
            result = self._apply_node_rename(mutation)
        elif t == MutationType.NODE_MOVE:
            result = self._apply_node_move(mutation)
        else:
            raise ValueError(f"Unknown mutation type: {mutation.type}")

        await self._run_hooks(mutation, result)
        return result

    # ============================================================
    # Apply: CONTENT_UPDATE
    # ============================================================

    def _apply_content_update(self, m: Mutation) -> CommitResult:
        node_id = m.node_id
        new_content_str = _serialize_content(m.content, m.node_type)

        # 1. Apply: 乐观锁 + 合并
        lock_passed = self.lock_svc.check_version(node_id, m.base_version)

        final_content = new_content_str
        status = "clean"
        strategy = "direct"
        lww_applied = False
        lww_details = None

        if not lock_passed:
            current_content = self.lock_svc.get_current_content(node_id)

            merge_result = self.conflict_svc.merge(
                node_id=node_id,
                base_content=m.base_content,
                current_content=current_content,
                new_content=new_content_str,
                node_type=m.node_type,
                agent_id=m.operator.id,
            )

            final_content = merge_result.merged_content
            status = merge_result.status
            strategy = merge_result.strategy_used or "direct"
            lww_applied = merge_result.lww_applied
            lww_details = merge_result.lww_details

        # Apply: 写入数据库
        content_json = None
        content_text = None

        if m.node_type == "json":
            try:
                content_json = json.loads(final_content) if isinstance(final_content, str) else final_content
            except (json.JSONDecodeError, TypeError) as e:
                log_error(f"[Mut] Invalid JSON for {node_id}, storing as markdown fallback: {e}")
                content_text = final_content if isinstance(final_content, str) else str(final_content)
                self.node_repo.update(node_id=node_id, preview_md=content_text)
                m.node_type = "markdown"
            if content_json is not None:
                self.node_repo.update(node_id=node_id, preview_json=content_json)
        elif m.node_type == "markdown":
            content_text = final_content if isinstance(final_content, str) else str(final_content)
            self.node_repo.update(node_id=node_id, preview_md=content_text)
        elif m.node_type == "file":
            pass

        # 2. Record: 版本快照
        version = self.version_svc.create_version(
            node_id=node_id,
            operator_type=m.operator.type,
            operation="update",
            content_json=content_json,
            content_text=content_text,
            operator_id=m.operator.id,
            session_id=m.operator.session_id,
            merge_strategy=strategy if status != "clean" else None,
            summary=m.operator.summary,
        )

        new_version = version.version if version else self.lock_svc.get_current_version(node_id)

        # 2. Record: 审计日志
        self.audit_svc.log_commit(
            node_id=node_id,
            old_version=m.base_version,
            new_version=new_version,
            status=status,
            strategy=strategy,
            operator_type=m.operator.type,
            operator_id=m.operator.id,
        )

        if lww_applied:
            self.audit_svc.log_conflict(
                node_id=node_id,
                strategy=strategy,
                details=json.dumps(lww_details) if lww_details else None,
                agent_id=m.operator.id,
            )

        return CommitResult(
            node_id=node_id,
            status=status,
            version=new_version,
            final_content=content_json or content_text,
            strategy=strategy,
            lww_applied=lww_applied,
            lww_details=lww_details,
        )

    # ============================================================
    # Apply: NODE_CREATE
    # ============================================================

    async def _apply_node_create(self, m: Mutation) -> CommitResult:
        # 1. Apply: 创建节点
        if m.node_type == "folder":
            node = self.node_svc.create_folder(
                project_id=m.project_id,
                name=m.name,
                parent_id=m.parent_id,
                created_by=m.created_by or m.operator.id,
            )
            # 2. Record: 审计日志（文件夹不创建版本快照）
            self.audit_svc.log_commit(
                node_id=node.id,
                old_version=0,
                new_version=0,
                status="clean",
                strategy="direct",
                operator_type=m.operator.type,
                operator_id=m.operator.id,
            )
            return CommitResult(
                node_id=node.id, status="clean", version=0,
                final_content=None, strategy="direct",
            )

        elif m.node_type == "json":
            node = self.node_svc.create_json_node(
                project_id=m.project_id,
                name=m.name,
                content=m.content or {},
                parent_id=m.parent_id,
                created_by=m.created_by or m.operator.id,
            )
            content_json = m.content or {}
            content_text = None
        elif m.node_type == "markdown":
            content_str = m.content if isinstance(m.content, str) else ""
            node = await self.node_svc.create_markdown_node(
                project_id=m.project_id,
                name=m.name,
                content=content_str,
                parent_id=m.parent_id,
                created_by=m.created_by or m.operator.id,
            )
            content_json = None
            content_text = content_str
        else:
            raise ValueError(f"Unsupported node_type for creation: {m.node_type}")

        new_version = node.current_version or 1

        # 2. Record: 审计日志
        self.audit_svc.log_commit(
            node_id=node.id,
            old_version=0,
            new_version=new_version,
            status="clean",
            strategy="direct",
            operator_type=m.operator.type,
            operator_id=m.operator.id,
        )

        return CommitResult(
            node_id=node.id, status="clean", version=new_version,
            final_content=content_json or content_text, strategy="direct",
        )

    # ============================================================
    # Apply: NODE_DELETE
    # ============================================================

    def _apply_node_delete(self, m: Mutation) -> CommitResult:
        # 1. Apply: 软删除（移入 .trash）
        node = self.node_svc.soft_delete_node(
            node_id=m.node_id,
            project_id=m.project_id,
            user_id=m.operator.id or "system",
        )

        # 2. Record: 审计日志
        self.audit_svc.log_commit(
            node_id=m.node_id,
            old_version=node.current_version or 0,
            new_version=node.current_version or 0,
            status="clean",
            strategy="direct",
            operator_type=m.operator.type,
            operator_id=m.operator.id,
        )

        return CommitResult(
            node_id=m.node_id, status="clean",
            version=node.current_version or 0,
            strategy="direct",
        )

    # ============================================================
    # Apply: NODE_RENAME
    # ============================================================

    def _apply_node_rename(self, m: Mutation) -> CommitResult:
        # 1. Apply: 重命名
        node = self.node_svc.update_node(
            node_id=m.node_id,
            project_id=m.project_id,
            name=m.new_name,
        )

        # 2. Record: 审计日志
        self.audit_svc.log_commit(
            node_id=m.node_id,
            old_version=node.current_version or 0,
            new_version=node.current_version or 0,
            status="clean",
            strategy="direct",
            operator_type=m.operator.type,
            operator_id=m.operator.id,
        )

        return CommitResult(
            node_id=m.node_id, status="clean",
            version=node.current_version or 0,
            strategy="direct",
        )

    # ============================================================
    # Apply: NODE_MOVE
    # ============================================================

    def _apply_node_move(self, m: Mutation) -> CommitResult:
        # 1. Apply: 移动节点
        node = self.node_svc.move_node(
            node_id=m.node_id,
            project_id=m.project_id,
            new_parent_id=m.new_parent_id,
        )

        # 2. Record: 审计日志
        self.audit_svc.log_commit(
            node_id=m.node_id,
            old_version=node.current_version or 0,
            new_version=node.current_version or 0,
            status="clean",
            strategy="direct",
            operator_type=m.operator.type,
            operator_id=m.operator.id,
        )

        return CommitResult(
            node_id=m.node_id, status="clean",
            version=node.current_version or 0,
            strategy="direct",
        )

    # ============================================================
    # checkout
    # ============================================================

    def checkout(
        self,
        node_id: str,
        operator_type: str = "agent",
        operator_id: Optional[str] = None,
    ) -> Optional[WorkingCopy]:
        node = self.node_repo.get_by_id(node_id)
        if not node:
            log_error(f"[Mut] checkout: node not found {node_id}")
            return None

        content_str = None
        content_json = None

        if node.preview_json is not None:
            content_json = node.preview_json
            content_str = json.dumps(node.preview_json, ensure_ascii=False, indent=2)
        elif node.preview_md is not None:
            content_str = node.preview_md

        base_version = node.current_version or 0

        self.audit_svc.log_checkout(
            node_id=node_id,
            version=base_version,
            operator_type=operator_type,
            operator_id=operator_id,
        )

        return WorkingCopy(
            node_id=node_id,
            node_type=node.type,
            content=content_str,
            content_json=content_json,
            base_version=base_version,
            content_hash=node.content_hash,
        )

    def checkout_batch(
        self,
        node_ids: List[str],
        operator_type: str = "agent",
        operator_id: Optional[str] = None,
    ) -> List[WorkingCopy]:
        copies = []
        for nid in node_ids:
            wc = self.checkout(nid, operator_type, operator_id)
            if wc:
                copies.append(wc)
        return copies

    # ============================================================
    # 查询
    # ============================================================

    def get_version_history(
        self, node_id: str, limit: int = 50, offset: int = 0
    ) -> VersionHistoryResponse:
        return self.version_svc.get_version_history(node_id, limit, offset)

    def get_version_content(
        self, node_id: str, version: int
    ) -> FileVersionDetail:
        return self.version_svc.get_version_content(node_id, version)

    def get_snapshot_history(
        self, folder_node_id: str, limit: int = 50, offset: int = 0
    ) -> FolderSnapshotHistoryResponse:
        return self.version_svc.get_snapshot_history(folder_node_id, limit, offset)

    def compute_diff(self, node_id: str, v1: int, v2: int) -> DiffResponse:
        return self.version_svc.compute_diff(node_id, v1, v2)

    # ============================================================
    # 回滚
    # ============================================================

    def rollback_file(
        self, node_id: str, target_version: int, operator_id: Optional[str] = None
    ) -> RollbackResponse:
        result = self.version_svc.rollback_file(node_id, target_version, operator_id)
        self.audit_svc.log_rollback(
            node_id=node_id,
            target_version=target_version,
            new_version=result.new_version,
            operator_id=operator_id,
        )
        return result

    def rollback_folder(
        self, folder_node_id: str, target_snapshot_id: int, operator_id: Optional[str] = None
    ) -> FolderRollbackResponse:
        return self.version_svc.rollback_folder(folder_node_id, target_snapshot_id, operator_id)

    # ============================================================
    # 文件夹快照
    # ============================================================

    def create_folder_snapshot(
        self,
        folder_node_id: str,
        changed_node_ids: List[str],
        operator_type: str = "agent",
        operation: str = "update",
        operator_id: Optional[str] = None,
        session_id: Optional[str] = None,
        summary: Optional[str] = None,
    ):
        return self.version_svc.create_folder_snapshot(
            folder_node_id=folder_node_id,
            changed_node_ids=changed_node_ids,
            operator_type=operator_type,
            operation=operation,
            operator_id=operator_id,
            session_id=session_id,
            summary=summary,
        )


# ============================================================
# 工具函数
# ============================================================

def _serialize_content(content: Any, node_type: str) -> str:
    if isinstance(content, str):
        return content
    if node_type == "json":
        return json.dumps(content, ensure_ascii=False, indent=2)
    return str(content)
