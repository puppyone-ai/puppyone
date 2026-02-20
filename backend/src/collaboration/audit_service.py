"""
L2 Collaboration — AuditService 审计日志

记录所有协同操作的审计日志：
- checkout: 谁在什么时间 checkout 了哪些文件
- commit: 谁写入了什么内容，合并策略是什么
- rollback: 谁回滚了哪个文件到哪个版本
- conflict: 冲突事件记录

持久化到 audit_logs 表，同时输出 Loguru 日志。
"""

from typing import Optional, Any
from src.collaboration.audit_repository import AuditRepository
from src.utils.logger import log_info, log_error


class AuditService:
    """审计日志服务"""

    def __init__(self, audit_repo: Optional[AuditRepository] = None):
        self._repo = audit_repo

    def _persist(
        self,
        action: str,
        node_id: str,
        operator_type: str = "user",
        operator_id: Optional[str] = None,
        old_version: Optional[int] = None,
        new_version: Optional[int] = None,
        status: Optional[str] = None,
        strategy: Optional[str] = None,
        conflict_details: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        """持久化审计记录到数据库，失败不阻塞主流程"""
        if not self._repo:
            return
        try:
            self._repo.insert(
                action=action,
                node_id=node_id,
                operator_type=operator_type,
                operator_id=operator_id,
                old_version=old_version,
                new_version=new_version,
                status=status,
                strategy=strategy,
                conflict_details=conflict_details,
                metadata=metadata,
            )
        except Exception as e:
            log_error(f"[Audit] Failed to persist audit log: {e}")

    def log_checkout(
        self,
        node_id: str,
        version: int,
        operator_type: str,
        operator_id: Optional[str] = None,
    ) -> None:
        """记录 checkout 操作"""
        log_info(
            f"[Audit] CHECKOUT node={node_id} v={version} "
            f"by={operator_type}:{operator_id or 'N/A'}"
        )
        self._persist(
            action="checkout",
            node_id=node_id,
            operator_type=operator_type,
            operator_id=operator_id,
            new_version=version,
        )

    def log_commit(
        self,
        node_id: str,
        old_version: int,
        new_version: int,
        status: str,
        strategy: Optional[str] = None,
        operator_type: str = "agent",
        operator_id: Optional[str] = None,
    ) -> None:
        """记录 commit 操作"""
        log_info(
            f"[Audit] COMMIT node={node_id} v{old_version}→v{new_version} "
            f"status={status} strategy={strategy} "
            f"by={operator_type}:{operator_id or 'N/A'}"
        )
        self._persist(
            action="commit",
            node_id=node_id,
            operator_type=operator_type,
            operator_id=operator_id,
            old_version=old_version,
            new_version=new_version,
            status=status,
            strategy=strategy,
        )

    def log_rollback(
        self,
        node_id: str,
        target_version: int,
        new_version: int,
        operator_id: Optional[str] = None,
    ) -> None:
        """记录 rollback 操作"""
        log_info(
            f"[Audit] ROLLBACK node={node_id} "
            f"target=v{target_version} new=v{new_version} "
            f"by=user:{operator_id or 'N/A'}"
        )
        self._persist(
            action="rollback",
            node_id=node_id,
            operator_type="user",
            operator_id=operator_id,
            old_version=target_version,
            new_version=new_version,
        )

    def log_conflict(
        self,
        node_id: str,
        strategy: str,
        details: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> None:
        """记录冲突事件"""
        log_info(
            f"[Audit] CONFLICT node={node_id} strategy={strategy} "
            f"details={details} agent={agent_id or 'N/A'}"
        )
        self._persist(
            action="conflict",
            node_id=node_id,
            operator_type="agent",
            operator_id=agent_id,
            strategy=strategy,
            conflict_details=details,
        )
