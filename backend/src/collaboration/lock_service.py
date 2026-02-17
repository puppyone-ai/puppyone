"""
L2 Collaboration — LockService 乐观锁

实现基于 content_nodes.current_version 的乐观并发控制（OCC）。

流程：
1. checkout 时记录 base_version
2. commit 时比对 base_version 与当前 current_version
3. 匹配 → 直接写入
4. 不匹配 → 转入 ConflictService 三方合并
"""

import json
from typing import Optional, Any

from src.content_node.repository import ContentNodeRepository
from src.utils.logger import log_info, log_warning


class LockService:
    """乐观锁服务"""

    def __init__(self, node_repo: ContentNodeRepository):
        self.node_repo = node_repo

    def check_version(self, node_id: str, expected_version: int) -> bool:
        """
        检查乐观锁是否通过

        Args:
            node_id: 节点 ID
            expected_version: 期望的版本号（checkout 时拿到的 base_version）

        Returns:
            True = 版本匹配，可以直接写入
            False = 版本冲突，需要合并
        """
        node = self.node_repo.get_by_id(node_id)
        if not node:
            log_warning(f"[Lock] Node not found: {node_id}")
            return False

        current = node.current_version or 0
        if current == expected_version:
            log_info(f"[Lock] {node_id}: version match (v{current}), lock passed")
            return True

        log_warning(
            f"[Lock] {node_id}: version conflict "
            f"(expected v{expected_version}, current v{current})"
        )
        return False

    def get_current_content(self, node_id: str) -> Optional[str]:
        """获取节点的当前内容（序列化字符串）"""
        node = self.node_repo.get_by_id(node_id)
        if not node:
            return None

        if node.preview_json is not None:
            return json.dumps(node.preview_json, ensure_ascii=False, indent=2)
        elif node.preview_md is not None:
            return node.preview_md
        return None

    def get_current_version(self, node_id: str) -> int:
        """获取节点的当前版本号"""
        node = self.node_repo.get_by_id(node_id)
        if not node:
            return 0
        return node.current_version or 0
