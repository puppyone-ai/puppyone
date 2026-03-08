"""
Mut Protocol — ConflictService 冲突解决引擎

三方合并（Three-Way Merge），冲突原子因内容类型而异：
- JSON: 路径级合并（递归到最深层，每个 JSON Path 是一个冲突原子）
- Markdown/Text: 行级合并（每行是一个冲突原子）
- 冲突时: 逐原子 LWW（只覆盖冲突的原子，保留其余合并结果）

commit() 永远成功。merge() 永远返回合并结果，不返回 None。

纯函数式：不访问数据库，只做内容比对和合并。
"""

import json
import difflib
from dataclasses import dataclass, field
from typing import Optional, Any, List, Dict

from src.collaboration.schemas import MergeResult
from src.utils.logger import log_info, log_warning


@dataclass
class _InternalMergeResult:
    """内部合并结果，用于在递归中传递 LWW 信息"""
    content: Any
    lww_paths: List[str] = field(default_factory=list)


class ConflictService:
    """
    Mut 三方合并引擎

    核心承诺：merge() 永远返回合并结果。
    不同位置的改动 → 自动合并。同一位置的改动 → LWW（incoming 赢）。
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
        if base_content is None:
            log_info(f"[Mut] {node_id}: no base content, direct write")
            return MergeResult(
                node_id=node_id, status="clean",
                merged_content=new_content,
                strategy_used="direct",
            )

        if base_content == current_content:
            log_info(f"[Mut] {node_id}: base == current, no conflict")
            return MergeResult(
                node_id=node_id, status="clean",
                merged_content=new_content,
                strategy_used="direct",
            )

        log_info(f"[Mut] {node_id}: concurrent write detected, three-way merge")

        if node_type == "json":
            return self._merge_json(node_id, base_content, current_content, new_content, agent_id)
        elif node_type == "markdown":
            return self._merge_text(node_id, base_content, current_content, new_content, agent_id)
        else:
            log_warning(f"[Mut] {node_id}: unknown type '{node_type}', LWW entire content")
            return MergeResult(
                node_id=node_id, status="merged",
                merged_content=new_content,
                strategy_used="lww",
                lww_applied=True,
                lww_details={"message": f"Unknown type '{node_type}', entire content overridden"},
            )

    def _merge_json(
        self, node_id: str, base_str: str, current_str: str, incoming_str: str, agent_id: Optional[str]
    ) -> MergeResult:
        try:
            base = json.loads(base_str)
            current = json.loads(current_str)
            incoming = json.loads(incoming_str)
        except (json.JSONDecodeError, TypeError):
            log_warning(f"[Mut] {node_id}: JSON parse error, LWW entire content")
            return MergeResult(
                node_id=node_id, status="merged",
                merged_content=incoming_str,
                strategy_used="json_path",
                lww_applied=True,
                lww_details={"message": "JSON parse error, entire content overridden"},
            )

        result = _json_three_way_merge(base, current, incoming, prefix="")

        merged_str = json.dumps(result.content, ensure_ascii=False, indent=2)
        lww_applied = len(result.lww_paths) > 0

        if lww_applied:
            log_warning(
                f"[Mut] {node_id}: merged with {len(result.lww_paths)} path(s) LWW'd "
                f"(agent {agent_id}): {result.lww_paths}"
            )
        else:
            log_info(f"[Mut] {node_id}: JSON auto-merged, zero conflicts")

        return MergeResult(
            node_id=node_id, status="merged",
            merged_content=merged_str,
            strategy_used="json_path",
            lww_applied=lww_applied,
            lww_details={"paths": result.lww_paths} if lww_applied else None,
        )

    def _merge_text(
        self, node_id: str, base_str: str, current_str: str, incoming_str: str, agent_id: Optional[str]
    ) -> MergeResult:
        result = _text_three_way_merge(base_str, current_str, incoming_str)

        lww_applied = len(result.lww_paths) > 0

        if lww_applied:
            log_warning(
                f"[Mut] {node_id}: merged with {len(result.lww_paths)} line(s) LWW'd "
                f"(agent {agent_id}): {result.lww_paths}"
            )
        else:
            log_info(f"[Mut] {node_id}: Markdown auto-merged, zero conflicts")

        return MergeResult(
            node_id=node_id, status="merged",
            merged_content=result.content,
            strategy_used="line_diff3",
            lww_applied=lww_applied,
            lww_details={"lines": result.lww_paths} if lww_applied else None,
        )


# ============================================================
# JSON 路径级三方合并（递归）
# ============================================================

def _json_three_way_merge(
    base: Any, current: Any, incoming: Any, prefix: str
) -> _InternalMergeResult:
    """
    JSON 三方合并，递归到最深层。冲突原子 = JSON Path。

    对每个路径：
    - 只有 current 改了 → 取 current
    - 只有 incoming 改了 → 取 incoming
    - 两方都改了，改成相同值 → 取该值
    - 两方都改了，改成不同值 → LWW，取 incoming
    - 都没改 → 取 base
    """
    if isinstance(base, dict) and isinstance(current, dict) and isinstance(incoming, dict):
        return _merge_dicts(base, current, incoming, prefix)

    if isinstance(base, list) and isinstance(current, list) and isinstance(incoming, list):
        return _merge_lists(base, current, incoming, prefix)

    return _merge_scalar(base, current, incoming, prefix)


def _merge_dicts(
    base: dict, current: dict, incoming: dict, prefix: str
) -> _InternalMergeResult:
    merged = {}
    lww_paths: List[str] = []
    all_keys = set(list(base.keys()) + list(current.keys()) + list(incoming.keys()))

    for key in all_keys:
        path = f"{prefix}/{key}"
        b = base.get(key, _MISSING)
        c = current.get(key, _MISSING)
        i = incoming.get(key, _MISSING)

        if b is _MISSING and c is _MISSING:
            merged[key] = i
        elif b is _MISSING and i is _MISSING:
            merged[key] = c
        elif c is _MISSING and i is _MISSING:
            pass
        elif b is _MISSING:
            if c == i:
                merged[key] = c
            else:
                merged[key] = i
                lww_paths.append(path)
        elif c is _MISSING:
            merged[key] = i
            if b != i:
                pass
        elif i is _MISSING:
            if b == c:
                pass
            else:
                lww_paths.append(path)
        else:
            if c == i:
                merged[key] = c
            elif b == c:
                merged[key] = i
            elif b == i:
                merged[key] = c
            elif isinstance(b, dict) and isinstance(c, dict) and isinstance(i, dict):
                sub = _merge_dicts(b, c, i, path)
                merged[key] = sub.content
                lww_paths.extend(sub.lww_paths)
            elif isinstance(b, list) and isinstance(c, list) and isinstance(i, list):
                sub = _merge_lists(b, c, i, path)
                merged[key] = sub.content
                lww_paths.extend(sub.lww_paths)
            else:
                merged[key] = i
                lww_paths.append(path)

    return _InternalMergeResult(content=merged, lww_paths=lww_paths)


def _merge_lists(
    base: list, current: list, incoming: list, prefix: str
) -> _InternalMergeResult:
    """
    列表合并：比较元素。如果长度或内容不同且三方都不同，LWW 取 incoming。
    对于元素级别的合并，如果元素是 dict 则递归。
    """
    if current == incoming:
        return _InternalMergeResult(content=current)
    if base == current:
        return _InternalMergeResult(content=incoming)
    if base == incoming:
        return _InternalMergeResult(content=current)

    return _InternalMergeResult(content=incoming, lww_paths=[prefix])


def _merge_scalar(
    base: Any, current: Any, incoming: Any, prefix: str
) -> _InternalMergeResult:
    if current == incoming:
        return _InternalMergeResult(content=current)
    if base == current:
        return _InternalMergeResult(content=incoming)
    if base == incoming:
        return _InternalMergeResult(content=current)
    return _InternalMergeResult(content=incoming, lww_paths=[prefix])


class _MissingSentinel:
    """Sentinel for missing keys (distinct from None)"""
    def __eq__(self, other):
        return isinstance(other, _MissingSentinel)
    def __hash__(self):
        return hash("_MISSING")
    def __repr__(self):
        return "<MISSING>"

_MISSING = _MissingSentinel()


# ============================================================
# Markdown 行级三方合并
# ============================================================

def _text_three_way_merge(
    base: str, current: str, incoming: str
) -> _InternalMergeResult:
    """
    Markdown 行级三方合并。冲突原子 = 行。

    算法：
    1. 计算 base→current 和 base→incoming 的行级差异
    2. 对于重叠区域：
       - 两方改动相同 → 取其一（不算冲突）
       - 两方改动不同 → LWW，取 incoming 的版本
    3. 非重叠区域正常合并
    """
    base_lines = base.splitlines(keepends=True)
    current_lines = current.splitlines(keepends=True)
    incoming_lines = incoming.splitlines(keepends=True)

    sm_current = difflib.SequenceMatcher(None, base_lines, current_lines)
    sm_incoming = difflib.SequenceMatcher(None, base_lines, incoming_lines)

    current_changes: List[tuple] = []
    incoming_changes: List[tuple] = []

    for tag, i1, i2, j1, j2 in sm_current.get_opcodes():
        if tag != "equal":
            current_changes.append((i1, i2, current_lines[j1:j2]))

    for tag, i1, i2, j1, j2 in sm_incoming.get_opcodes():
        if tag != "equal":
            incoming_changes.append((i1, i2, incoming_lines[j1:j2]))

    lww_lines: List[int] = []

    resolved_incoming: List[tuple] = []

    for i_start, i_end, i_new in incoming_changes:
        has_overlap = False
        for c_start, c_end, c_new in current_changes:
            if _ranges_overlap(i_start, i_end, c_start, c_end):
                has_overlap = True
                if i_new != c_new:
                    for line_num in range(i_start, max(i_end, i_start + 1)):
                        lww_lines.append(line_num + 1)
                break
        resolved_incoming.append((i_start, i_end, i_new))

    non_overlapping_current = []
    for c_start, c_end, c_new in current_changes:
        overlaps_with_incoming = False
        for i_start, i_end, i_new in incoming_changes:
            if _ranges_overlap(c_start, c_end, i_start, i_end):
                overlaps_with_incoming = True
                break
        if not overlaps_with_incoming:
            non_overlapping_current.append((c_start, c_end, c_new))

    all_changes = resolved_incoming + non_overlapping_current
    all_changes.sort(key=lambda x: x[0], reverse=True)

    merged_lines = list(base_lines)
    for start, end, new_lines in all_changes:
        merged_lines[start:end] = new_lines

    return _InternalMergeResult(
        content="".join(merged_lines),
        lww_paths=[f"line:{n}" for n in lww_lines] if lww_lines else [],
    )


def _ranges_overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    """检查两个行范围是否重叠"""
    if a_start == a_end and b_start == b_end:
        return a_start == b_start
    if a_start == a_end:
        return a_start > b_start and a_start < b_end
    if b_start == b_end:
        return b_start > a_start and b_start < a_end
    return a_start < b_end and b_start < a_end
