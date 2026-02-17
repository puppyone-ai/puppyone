"""
向后兼容：MergeDaemon 核心逻辑已迁移到 src.collaboration.conflict_service

此文件保留以兼容 workspace/router.py 中的调用。
MergeDaemon 类仍存在，但内部委托给 ConflictService。

后续清理：workspace/router.py 改为使用 CollaborationService 后可删除此文件。
"""

import json
from typing import Optional, Any
from dataclasses import dataclass

from src.collaboration.conflict_service import ConflictService
from src.utils.logger import log_info, log_error, log_warning


@dataclass
class MergeResult:
    """单个文件的合并结果（向后兼容）"""
    node_id: str
    status: str
    merged_content: Optional[Any] = None
    strategy_used: Optional[str] = None
    conflict_details: Optional[str] = None


class MergeDaemon:
    """
    向后兼容包装器

    内部委托给 ConflictService。
    """

    def __init__(self, node_repo=None, version_service=None):
        self.node_repo = node_repo
        self.version_service = version_service
        self._conflict_svc = ConflictService()

    def merge_single_file(
        self,
        node_id: str,
        base_content: Optional[str],
        new_content: str,
        node_type: str,
        agent_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> MergeResult:
        """合并单个文件（向后兼容接口）"""
        # 获取数据库中的当前最新内容
        current_content = None
        if self.node_repo:
            node = self.node_repo.get_by_id(node_id)
            if node:
                current_content = _get_node_text(node)

        result = self._conflict_svc.merge(
            node_id=node_id,
            base_content=base_content,
            current_content=current_content,
            new_content=new_content,
            node_type=node_type,
            agent_id=agent_id,
        )

        return MergeResult(
            node_id=result.node_id,
            status=result.status,
            merged_content=result.merged_content,
            strategy_used=result.strategy_used,
            conflict_details=result.conflict_details,
        )


def _get_node_text(node) -> Optional[str]:
    """从 ContentNode 获取文本内容"""
    if node.preview_json is not None:
        return json.dumps(node.preview_json, ensure_ascii=False, indent=2)
    elif node.preview_md is not None:
        return node.preview_md
    return None
