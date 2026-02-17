"""
L2 Collaboration — ConflictService 冲突解决引擎

三方合并（Three-Way Merge）：
- JSON: Key 级合并
- Markdown/Text: 行级合并（类似 Git diff3）
- 合并失败时: LWW（后写者覆盖前者）

纯函数式：不访问数据库，只做内容比对和合并。

迁移自 workspace/merge_daemon.py
"""

import json
import difflib
from typing import Optional, Any, List

from src.collaboration.schemas import MergeResult
from src.utils.logger import log_info, log_warning


class ConflictService:
    """
    三方合并引擎

    用法：
        conflict_svc = ConflictService()
        result = conflict_svc.merge(
            node_id="abc",
            base_content='{"a":1}',
            current_content='{"a":1,"b":2}',
            new_content='{"a":1,"c":3}',
            node_type="json",
        )
        # result.status == "merged"
        # result.merged_content == '{"a":1,"b":2,"c":3}'
    """

    def merge(
        self,
        node_id: str,
        base_content: Optional[str],
        current_content: Optional[str],
        new_content: str,
        node_type: str,
        agent_id: Optional[str] = None,
    ) -> MergeResult:
        """
        三方合并入口

        Args:
            node_id: 节点 ID
            base_content: Agent 读取时的内容（base）
            current_content: 数据库当前最新内容（可能被其他人改过）
            new_content: Agent 要写入的新内容
            node_type: "json" 或 "markdown"
            agent_id: Agent ID（日志用）

        Returns:
            MergeResult: 合并结果
        """
        # 没有 base → 直接写入
        if base_content is None:
            log_info(f"[Merge] {node_id}: no base content, direct write")
            return MergeResult(
                node_id=node_id, status="clean",
                merged_content=new_content,
                strategy_used="direct",
            )

        # Base == Current → 没人改过，直接写入
        if base_content == current_content:
            log_info(f"[Merge] {node_id}: base == current, no conflict")
            return MergeResult(
                node_id=node_id, status="clean",
                merged_content=new_content,
                strategy_used="direct",
            )

        # Base != Current → 需要三方合并
        log_info(f"[Merge] {node_id}: conflict detected, attempting three-way merge")

        merged = None
        strategy = None

        if node_type == "json":
            merged = _json_three_way_merge_str(base_content, current_content, new_content)
            strategy = "json_key"
        elif node_type == "markdown":
            merged = _text_three_way_merge(base_content, current_content, new_content)
            strategy = "line_diff3"

        if merged is not None:
            log_info(f"[Merge] {node_id}: auto-merged successfully via {strategy}")
            return MergeResult(
                node_id=node_id, status="merged",
                merged_content=merged,
                strategy_used=strategy,
            )

        # 合并失败 → LWW
        log_warning(
            f"[Merge] {node_id}: cannot auto-merge, LWW "
            f"(agent {agent_id} overwrites previous changes)"
        )
        return MergeResult(
            node_id=node_id, status="lww",
            merged_content=new_content,
            strategy_used="lww",
            conflict_details=f"Agent {agent_id} overwrote via LWW",
        )


# ============================================================
# JSON Key 级三方合并
# ============================================================

def _json_three_way_merge_str(
    base_str: str, ours_str: str, theirs_str: str
) -> Optional[str]:
    """JSON 三方合并（字符串输入输出）"""
    try:
        base = json.loads(base_str)
        ours = json.loads(ours_str)
        theirs = json.loads(theirs_str)
    except (json.JSONDecodeError, TypeError):
        return None

    merged = _json_three_way_merge(base, ours, theirs)
    if merged is not None:
        return json.dumps(merged, ensure_ascii=False, indent=2)
    return None


def _json_three_way_merge(
    base: dict, ours: dict, theirs: dict
) -> Optional[dict]:
    """
    JSON 对象的三方合并（Key 级）

    对每个 key：
    - Base == Ours == Theirs → 无变化
    - Base == Ours, Theirs 不同 → 采用 Theirs
    - Base == Theirs, Ours 不同 → 采用 Ours
    - Ours == Theirs → 都改成一样的 → 采用任一
    - 三方都不同 → 冲突，返回 None
    """
    if not isinstance(base, dict) or not isinstance(ours, dict) or not isinstance(theirs, dict):
        return None

    merged = {}
    all_keys = set(list(base.keys()) + list(ours.keys()) + list(theirs.keys()))

    for key in all_keys:
        b = base.get(key)
        o = ours.get(key)
        t = theirs.get(key)

        if o == t:
            merged[key] = o
        elif b == o:
            merged[key] = t
        elif b == t:
            merged[key] = o
        else:
            log_warning(f"[Merge] JSON conflict on key '{key}': base={b}, ours={o}, theirs={t}")
            return None

    return merged


# ============================================================
# Markdown / 纯文本 行级三方合并（类似 Git diff3）
# ============================================================

def _text_three_way_merge(
    base: str, ours: str, theirs: str
) -> Optional[str]:
    """
    文本行级三方合并（类似 Git diff3）

    算法：
    1. 计算 Base→Ours 和 Base→Theirs 的行级差异
    2. 检查是否有重叠冲突（同一区域都改了且内容不同）
    3. 无冲突则合并所有改动
    """
    base_lines = base.splitlines(keepends=True)
    ours_lines = ours.splitlines(keepends=True)
    theirs_lines = theirs.splitlines(keepends=True)

    sm_ours = difflib.SequenceMatcher(None, base_lines, ours_lines)
    sm_theirs = difflib.SequenceMatcher(None, base_lines, theirs_lines)

    ours_changes: List[tuple] = []
    theirs_changes: List[tuple] = []

    for tag, i1, i2, j1, j2 in sm_ours.get_opcodes():
        if tag != "equal":
            ours_changes.append((i1, i2, ours_lines[j1:j2]))

    for tag, i1, i2, j1, j2 in sm_theirs.get_opcodes():
        if tag != "equal":
            theirs_changes.append((i1, i2, theirs_lines[j1:j2]))

    # 检查重叠冲突
    for o_start, o_end, o_new in ours_changes:
        for t_start, t_end, t_new in theirs_changes:
            if _ranges_overlap(o_start, o_end, t_start, t_end):
                if o_new == t_new:
                    continue
                log_warning(
                    f"[Merge] Text conflict at base lines {o_start}-{o_end}: "
                    f"both sides modified differently"
                )
                return None

    # 无冲突，合并改动（去重同区域同内容的）
    all_changes = [(s, e, n) for s, e, n in ours_changes]
    for start, end, new_lines in theirs_changes:
        is_dup = any(
            o_start == start and o_end == end and o_new == new_lines
            for o_start, o_end, o_new in ours_changes
        )
        if not is_dup:
            all_changes.append((start, end, new_lines))

    all_changes.sort(key=lambda x: x[0], reverse=True)

    merged_lines = list(base_lines)
    for start, end, new_lines in all_changes:
        merged_lines[start:end] = new_lines

    return "".join(merged_lines)


def _ranges_overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    """检查两个行范围是否重叠"""
    if a_start == a_end and b_start == b_end:
        return a_start == b_start
    if a_start == a_end:
        return a_start > b_start and a_start < b_end
    if b_start == b_end:
        return b_start > a_start and b_start < a_end
    return a_start < b_end and b_start < a_end
