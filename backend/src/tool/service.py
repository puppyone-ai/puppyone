from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List, Optional, Any

from src.exceptions import NotFoundException, ErrorCode, BusinessException
from src.table.service import TableService
from src.tool.models import Tool
from src.tool.repository import ToolRepositoryBase
from src.supabase.tools.schemas import (
    ToolCreate as SbToolCreate,
    ToolUpdate as SbToolUpdate,
)
from src.supabase.dependencies import get_supabase_repository
from src.mcp.cache_invalidator import invalidate_mcp_cache


@lru_cache(maxsize=64)
def _get_default_tool_description(tool_type: str) -> Optional[str]:
    """
    从 `src/mcp/description/{tool_type}.txt` 读取默认工具描述（用于 Tool.description 的默认值）。
    """
    desc_dir = Path(__file__).resolve().parents[1] / "mcp" / "description"
    p = desc_dir / f"{tool_type}.txt"
    if not p.exists():
        return None
    try:
        text = p.read_text(encoding="utf-8").strip()
        return text or None
    except Exception:
        return None


class ToolService:
    def __init__(self, repo: ToolRepositoryBase, table_service: TableService):
        self.repo = repo
        self.table_service = table_service
        self._sb = get_supabase_repository()

    def _invalidate_bound_mcps(self, tool_id: int) -> None:
        """
        best-effort：当 tool 发生变化时，通知所有绑定到它的 mcp_v2 使缓存失效。
        """
        bindings = self._sb.get_mcp_bindings_by_tool_id(tool_id)
        for b in bindings:
            mcp_id = int(b.mcp_id or 0)
            if not mcp_id:
                continue
            mcp = self._sb.get_mcp_v2(mcp_id)
            if not mcp or not mcp.api_key:
                continue
            invalidate_mcp_cache(mcp.api_key)

    def _assert_name_update_no_conflict(
        self, tool_id: int, user_id: str, new_name: str
    ) -> None:
        """
        如果该 tool 已绑定到任意 mcp_v2，则更新 name 前需要保证
        在每个相关 mcp_v2 内仍然保持 name 唯一。
        """
        bindings = self._sb.get_mcp_bindings_by_tool_id(tool_id)
        for b in bindings:
            mcp_id = int(b.mcp_id or 0)
            if not mcp_id:
                continue
            # 拉取该 mcp_id 下所有绑定的 tool，检查 name 冲突
            siblings = self._sb.get_mcp_bindings_by_mcp_id(mcp_id)
            for sb in siblings:
                sib_tool_id = int(sb.tool_id or 0)
                if not sib_tool_id or sib_tool_id == tool_id:
                    continue
                sib = self.repo.get_by_id(sib_tool_id)
                if not sib:
                    continue
                if sib.user_id != user_id:
                    # 正常不该出现（绑定/权限已校验），但这里保持安全
                    continue
                if sib.name == new_name:
                    raise BusinessException(
                        f"Tool name conflict within mcp_v2 (mcp_id={mcp_id}): name='{new_name}'",
                        code=ErrorCode.VALIDATION_ERROR,
                    )

    def list_user_tools(
        self, user_id: str, *, skip: int = 0, limit: int = 100
    ) -> List[Tool]:
        return self.repo.get_by_user_id(user_id, skip=skip, limit=limit)

    def list_user_tools_by_table_id(
        self,
        user_id: str,
        *,
        table_id: int,
        skip: int = 0,
        limit: int = 1000,
    ) -> List[Tool]:
        # 强校验：table 必须属于当前用户
        self.table_service.get_by_id_with_access_check(table_id, user_id)
        return self.repo.get_by_user_id(
            user_id, skip=skip, limit=limit, table_id=table_id
        )

    def get_by_id(self, tool_id: int) -> Optional[Tool]:
        return self.repo.get_by_id(tool_id)

    def get_by_id_with_access_check(self, tool_id: int, user_id: str) -> Tool:
        tool = self.repo.get_by_id(tool_id)
        if not tool or tool.user_id != user_id:
            raise NotFoundException(
                f"Tool not found: {tool_id}", code=ErrorCode.NOT_FOUND
            )
        return tool

    def create(
        self,
        *,
        user_id: str,
        table_id: int,
        json_path: str,
        type: str,
        name: str,
        alias: Optional[str],
        description: Optional[str],
        input_schema: Optional[Any],
        output_schema: Optional[Any],
        metadata: Optional[Any],
    ) -> Tool:
        # 强校验：table 必须属于当前用户
        self.table_service.get_by_id_with_access_check(table_id, user_id)

        # 约束：同一 scope（user_id + table_id + json_path）下，Bash 只能配置一个（rw/ro 二选一）
        self._assert_bash_unique_in_scope(
            user_id=user_id,
            table_id=int(table_id),
            json_path=json_path,
            tool_type=str(type or ""),
            exclude_tool_id=None,
        )

        # 默认工具描述：当未传 description（或仅空白）时，根据 type 自动填充默认值
        if description is None or not str(description).strip():
            description = _get_default_tool_description(str(type))

        created = self.repo.create(
            SbToolCreate(
                user_id=user_id,
                table_id=table_id,
                json_path=json_path,
                type=type,
                name=name,
                alias=alias,
                description=description,
                input_schema=input_schema,
                output_schema=output_schema,
                metadata=metadata,
            )
        )
        return created

    def update(self, *, tool_id: int, user_id: str, patch: dict[str, Any]) -> Tool:
        existing = self.get_by_id_with_access_check(tool_id, user_id)

        # 只处理传入的字段（路由层已用 exclude_unset 生成 patch）
        name = patch.get("name")
        if name is not None and name != existing.name:
            self._assert_name_update_no_conflict(tool_id, user_id, name)

        table_id = patch.get("table_id")
        if table_id is not None:
            self.table_service.get_by_id_with_access_check(int(table_id), user_id)

        # 约束：如果更新后 tool 变为 Bash（或仍为 Bash），确保同 scope 仍然只有一个 bash
        next_table_id = int(table_id) if table_id is not None else int(existing.table_id or 0)
        next_json_path = patch.get("json_path")
        if next_json_path is None:
            next_json_path = existing.json_path or ""
        next_type = patch.get("type")
        if next_type is None:
            next_type = existing.type or ""

        self._assert_bash_unique_in_scope(
            user_id=user_id,
            table_id=int(next_table_id) if next_table_id else 0,
            json_path=str(next_json_path or ""),
            tool_type=str(next_type or ""),
            exclude_tool_id=int(tool_id),
        )

        updated = self.repo.update(
            tool_id,
            SbToolUpdate(
                table_id=patch.get("table_id"),
                json_path=patch.get("json_path"),
                type=patch.get("type"),
                name=patch.get("name"),
                alias=patch.get("alias"),
                description=patch.get("description"),
                input_schema=patch.get("input_schema"),
                output_schema=patch.get("output_schema"),
                metadata=patch.get("metadata"),
            ),
        )
        if not updated:
            # 理论上不会发生（已做 get_by_id_with_access_check），这里做兜底
            raise BusinessException(
                "Tool update failed", code=ErrorCode.INTERNAL_SERVER_ERROR
            )

        # 保持 user_id 不变（DB 层也不会更新 user_id，但为了安全再校验一次）
        if updated.user_id != existing.user_id:
            raise BusinessException(
                "Tool owner mismatch after update", code=ErrorCode.INTERNAL_SERVER_ERROR
            )

        # 触发所有绑定该 tool 的 mcp_v2 失效（工具列表/执行参数都可能变化）
        self._invalidate_bound_mcps(tool_id)

        return updated

    def list_user_tools_by_project_id(
        self,
        user_id: str,
        *,
        project_id: int,
        limit_per_table: int = 1000,
    ) -> List[Tool]:
        """
        项目级聚合：返回该 project 下所有 table 的 tools（包含 shell_access*）。
        """
        if not self.table_service.verify_project_access(int(project_id), user_id):
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )
        tables = self._sb.get_tables(project_id=int(project_id), limit=1000)
        out: list[Tool] = []
        for t in tables:
            table_id = int(getattr(t, "id", 0) or 0)
            if not table_id:
                continue
            out.extend(
                self.repo.get_by_user_id(
                    user_id, table_id=table_id, skip=0, limit=int(limit_per_table)
                )
            )
        return out

    def _assert_bash_unique_in_scope(
        self,
        *,
        user_id: str,
        table_id: int,
        json_path: str,
        tool_type: str,
        exclude_tool_id: Optional[int],
    ) -> None:
        """
        规则：
        - 同一 scope（user_id + table_id + json_path）下，Bash 只能配置一条
          （type in {'shell_access','shell_access_readonly'} 二选一）。
        """
        bash_types = {"shell_access", "shell_access_readonly"}
        tool_type = (tool_type or "").strip()
        if tool_type not in bash_types:
            return
        if not table_id:
            return
        scope_path = (json_path or "").strip()  # 保持与现有存储一致：空字符串表示根

        # 读取该 table 下所有 tools（同 user），再在内存中过滤 scope + bash types
        siblings = self.repo.get_by_user_id(user_id, table_id=int(table_id), skip=0, limit=2000)
        for sib in siblings:
            if exclude_tool_id is not None and int(sib.id) == int(exclude_tool_id):
                continue
            if (sib.type or "").strip() not in bash_types:
                continue
            if (sib.json_path or "").strip() != scope_path:
                continue
            raise BusinessException(
                f"Only one bash is allowed per scope: table_id={table_id} json_path='{scope_path}'. "
                f"Existing='{sib.type}', attempted='{tool_type}'.",
                code=ErrorCode.VALIDATION_ERROR,
            )

    def delete(self, tool_id: int, user_id: str) -> None:
        _ = self.get_by_id_with_access_check(tool_id, user_id)
        ok = self.repo.delete(tool_id)
        if not ok:
            raise BusinessException(
                "Tool delete failed", code=ErrorCode.INTERNAL_SERVER_ERROR
            )
        self._invalidate_bound_mcps(tool_id)
