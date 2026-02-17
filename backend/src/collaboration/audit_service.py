"""
L2 Collaboration — AuditService 审计日志

记录所有协同操作的审计日志：
- checkout: 谁在什么时间 checkout 了哪些文件
- commit: 谁写入了什么内容，合并策略是什么
- rollback: 谁回滚了哪个文件到哪个版本

当前实现：仅 Loguru 日志，后续可扩展为写入数据库审计表。
"""

from typing import Optional, Any
from src.utils.logger import log_info


class AuditService:
    """审计日志服务"""

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
