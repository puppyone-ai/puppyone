"""
L2 Collaboration — CollaborationService 统一入口

产品核心壁垒层。所有数据写入最终经过此层。

对外接口（Agent / API / SDK 统一调用）：
- checkout()    获取工作副本 + 记录 base_version
- commit()      写入 + 乐观锁 + 冲突解决 + 版本记录
- get_history() 查看版本历史
- rollback()    回滚到指定版本

内部组合：
  LockService → ConflictService → VersionService → AuditService
"""

import json
from typing import Optional, Any, List

from src.content_node.repository import ContentNodeRepository
from src.collaboration.lock_service import LockService
from src.collaboration.conflict_service import ConflictService
from src.collaboration.version_service import VersionService
from src.collaboration.audit_service import AuditService
from src.collaboration.schemas import (
    WorkingCopy, CommitResult, MergeResult,
    VersionHistoryResponse, FileVersionDetail,
    FolderSnapshotHistoryResponse,
    RollbackResponse, FolderRollbackResponse,
    DiffResponse,
)
from src.utils.logger import log_info, log_error


class CollaborationService:
    """L2 协同层统一入口"""

    def __init__(
        self,
        node_repo: ContentNodeRepository,
        lock_service: LockService,
        conflict_service: ConflictService,
        version_service: VersionService,
        audit_service: AuditService,
    ):
        self.node_repo = node_repo
        self.lock_svc = lock_service
        self.conflict_svc = conflict_service
        self.version_svc = version_service
        self.audit_svc = audit_service

    # ============================================================
    # checkout: 获取工作副本
    # ============================================================

    def checkout(
        self,
        node_id: str,
        operator_type: str = "agent",
        operator_id: Optional[str] = None,
    ) -> Optional[WorkingCopy]:
        """
        checkout 一个文件的工作副本

        返回 WorkingCopy（含 base_version），供 commit 时做乐观锁。
        """
        node = self.node_repo.get_by_id(node_id)
        if not node:
            log_error(f"[Collab] checkout: node not found {node_id}")
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
        """批量 checkout"""
        copies = []
        for nid in node_ids:
            wc = self.checkout(nid, operator_type, operator_id)
            if wc:
                copies.append(wc)
        return copies

    # ============================================================
    # commit: 写入 + 乐观锁 + 冲突解决 + 版本记录
    # ============================================================

    def commit(
        self,
        node_id: str,
        new_content: Any,
        base_version: int,
        node_type: str = "json",
        base_content: Optional[str] = None,
        operator_type: str = "agent",
        operator_id: Optional[str] = None,
        session_id: Optional[str] = None,
        summary: Optional[str] = None,
    ) -> CommitResult:
        """
        提交单个文件的修改

        流程：
        1. 序列化 new_content
        2. 乐观锁检查（base_version vs current_version）
        3. 锁通过 → 直接写入
        4. 锁失败 → 三方合并（ConflictService）
        5. 创建版本记录（VersionService）
        6. 审计日志（AuditService）
        """
        # 序列化新内容
        new_content_str = _serialize_content(new_content, node_type)

        # Step 1: 乐观锁检查
        lock_passed = self.lock_svc.check_version(node_id, base_version)

        final_content = new_content_str
        status = "clean"
        strategy = "direct"
        conflict_details = None

        if not lock_passed:
            # Step 2: 乐观锁失败 → 三方合并
            current_content = self.lock_svc.get_current_content(node_id)

            merge_result = self.conflict_svc.merge(
                node_id=node_id,
                base_content=base_content,
                current_content=current_content,
                new_content=new_content_str,
                node_type=node_type,
                agent_id=operator_id,
            )

            final_content = merge_result.merged_content
            status = merge_result.status
            strategy = merge_result.strategy_used or "lww"
            conflict_details = merge_result.conflict_details

            if status in ("merged", "lww"):
                self.audit_svc.log_conflict(
                    node_id=node_id,
                    strategy=strategy,
                    details=conflict_details,
                    agent_id=operator_id,
                )

        # Step 3: 写入内容到 content_nodes
        content_json = None
        content_text = None

        if node_type == "json":
            try:
                content_json = json.loads(final_content) if isinstance(final_content, str) else final_content
            except (json.JSONDecodeError, TypeError) as e:
                log_error(
                    f"[Collab] commit: invalid JSON for node {node_id}, "
                    f"storing as markdown fallback. Error: {e}"
                )
                content_text = final_content if isinstance(final_content, str) else str(final_content)
                self.node_repo.update(node_id=node_id, preview_md=content_text)
                node_type = "markdown"
            if content_json is not None:
                self.node_repo.update(node_id=node_id, preview_json=content_json)
        elif node_type == "markdown":
            content_text = final_content if isinstance(final_content, str) else str(final_content)
            self.node_repo.update(node_id=node_id, preview_md=content_text)

        # Step 4: 创建版本记录
        # create_version 可能返回 None（内容哈希未变化时跳过）
        # 或者抛出 VersionConflictException（并发写入时）
        version = self.version_svc.create_version(
            node_id=node_id,
            operator_type=operator_type,
            operation="update",
            content_json=content_json,
            content_text=content_text,
            operator_id=operator_id,
            session_id=session_id,
            merge_strategy=strategy if status != "clean" else None,
            summary=summary,
        )

        if version:
            new_version_num = version.version
        else:
            # 内容未变化，版本号不变
            new_version_num = self.lock_svc.get_current_version(node_id)

        # Step 5: 审计日志
        self.audit_svc.log_commit(
            node_id=node_id,
            old_version=base_version,
            new_version=new_version_num,
            status=status,
            strategy=strategy,
            operator_type=operator_type,
            operator_id=operator_id,
        )

        return CommitResult(
            node_id=node_id,
            status=status,
            version=new_version_num,
            final_content=content_json or content_text,
            strategy=strategy,
            conflict_details=conflict_details,
        )

    # ============================================================
    # 查询
    # ============================================================

    def get_version_history(
        self, node_id: str, limit: int = 50, offset: int = 0
    ) -> VersionHistoryResponse:
        """获取文件版本历史"""
        return self.version_svc.get_version_history(node_id, limit, offset)

    def get_version_content(
        self, node_id: str, version: int
    ) -> FileVersionDetail:
        """获取某个版本的完整内容"""
        return self.version_svc.get_version_content(node_id, version)

    def get_snapshot_history(
        self, folder_node_id: str, limit: int = 50, offset: int = 0
    ) -> FolderSnapshotHistoryResponse:
        """获取文件夹快照历史"""
        return self.version_svc.get_snapshot_history(folder_node_id, limit, offset)

    def compute_diff(self, node_id: str, v1: int, v2: int) -> DiffResponse:
        """对比两个版本差异"""
        return self.version_svc.compute_diff(node_id, v1, v2)

    # ============================================================
    # 回滚
    # ============================================================

    def rollback_file(
        self, node_id: str, target_version: int, operator_id: Optional[str] = None
    ) -> RollbackResponse:
        """单文件回滚"""
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
        """文件夹回滚"""
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
        """创建文件夹快照"""
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
    """将内容序列化为字符串"""
    if isinstance(content, str):
        return content
    if node_type == "json":
        return json.dumps(content, ensure_ascii=False, indent=2)
    return str(content)
