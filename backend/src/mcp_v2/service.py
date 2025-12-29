from __future__ import annotations

from typing import List

from src.exceptions import NotFoundException, ErrorCode, ValidationException, BusinessException
from src.mcp.cache_invalidator import invalidate_mcp_cache
from src.supabase.dependencies import get_supabase_repository
from src.supabase.mcp_binding.schemas import McpBindingCreate, McpBindingUpdate
from src.supabase.mcp_v2.schemas import McpV2Create as SbMcpV2Create, McpV2Update as SbMcpV2Update
from src.tool.repository import ToolRepositorySupabase
from src.mcp_v2.models import McpV2Instance
from src.mcp_v2.schemas import BindToolRequest


class McpV2Service:
    def __init__(self):
        self._repo = get_supabase_repository()
        self._tool_repo = ToolRepositorySupabase(self._repo)

    def _to_model(self, resp) -> McpV2Instance:
        return McpV2Instance(
            id=resp.id,
            created_at=resp.created_at,
            updated_at=resp.updated_at,
            user_id=str(resp.user_id) if resp.user_id else "",
            name=resp.name,
            api_key=resp.api_key or "",
            status=bool(resp.status),
        )

    def list_user_instances(self, user_id: str, *, skip: int = 0, limit: int = 100) -> List[McpV2Instance]:
        resps = self._repo.get_mcp_v2_list(skip=skip, limit=limit, user_id=user_id)
        return [self._to_model(r) for r in resps]

    def create_instance(self, *, user_id: str, api_key: str, name: str | None, status: bool) -> McpV2Instance:
        resp = self._repo.create_mcp_v2(SbMcpV2Create(user_id=user_id, api_key=api_key, name=name, status=status))
        return self._to_model(resp)

    def get_by_api_key(self, api_key: str) -> McpV2Instance | None:
        resp = self._repo.get_mcp_v2_by_api_key(api_key)
        if not resp:
            return None
        return self._to_model(resp)

    def get_by_api_key_with_access_check(self, api_key: str, user_id: str) -> McpV2Instance:
        inst = self.get_by_api_key(api_key)
        if not inst or inst.user_id != user_id:
            raise NotFoundException("MCP v2 instance not found", code=ErrorCode.NOT_FOUND)
        return inst

    def update_instance(self, *, api_key: str, user_id: str, name: str | None, status: bool | None) -> McpV2Instance:
        inst = self.get_by_api_key_with_access_check(api_key, user_id)
        resp = self._repo.update_mcp_v2(inst.id, SbMcpV2Update(name=name, status=status))
        if not resp:
            raise BusinessException("MCP v2 update failed", code=ErrorCode.INTERNAL_SERVER_ERROR)
        updated = self._to_model(resp)
        invalidate_mcp_cache(api_key)
        return updated

    def delete_instance(self, *, api_key: str, user_id: str) -> None:
        inst = self.get_by_api_key_with_access_check(api_key, user_id)
        ok = self._repo.delete_mcp_v2(inst.id)
        if not ok:
            raise BusinessException("MCP v2 delete failed", code=ErrorCode.INTERNAL_SERVER_ERROR)
        invalidate_mcp_cache(api_key)

    def _list_bound_tools(self, mcp_id: int) -> List[tuple[int, Tool]]:
        bindings = self._repo.get_mcp_bindings_by_mcp_id(mcp_id)
        out: list[tuple[int, Tool]] = []
        for b in bindings:
            tool = self._tool_repo.get_by_id(int(b.tool_id or 0))
            if not tool:
                continue
            out.append((b.id, tool))
        return out

    def bind_tool(self, *, api_key: str, user_id: str, tool_id: int, status: bool) -> None:
        inst = self.get_by_api_key_with_access_check(api_key, user_id)

        tool = self._tool_repo.get_by_id(tool_id)
        if not tool or tool.user_id != user_id:
            raise NotFoundException("Tool not found", code=ErrorCode.NOT_FOUND)

        # 强制同一 mcp_v2 内 tool.name 唯一（不区分 binding status，确保未来 enable 不会冲突）
        for _, existing_tool in self._list_bound_tools(inst.id):
            if existing_tool.id != tool.id and existing_tool.name == tool.name:
                raise ValidationException(
                    f"Tool name conflict within mcp_v2: name='{tool.name}'"
                )

        existed = self._repo.get_mcp_binding_by_mcp_and_tool(inst.id, tool_id)
        if existed:
            # 已绑定则视为更新 status
            self._repo.update_mcp_binding(existed.id, McpBindingUpdate(status=status))
        else:
            self._repo.create_mcp_binding(McpBindingCreate(mcp_id=inst.id, tool_id=tool_id, status=status))

        invalidate_mcp_cache(api_key)

    def bind_tools(
        self,
        *,
        api_key: str,
        user_id: str,
        bindings: List[BindToolRequest],
    ) -> None:
        """
        批量绑定 Tool 到同一个 mcp_v2（尽量原子）：
        - 先做全量校验（Tool 归属、tool.name 冲突、tool_id 去重）
        - 再逐条写入（create 或 update status）
        - 若中途失败，回滚已处理的变更（恢复旧 status / 删除新建 binding）
        """
        if not bindings:
            raise ValidationException("bindings is required")

        inst = self.get_by_api_key_with_access_check(api_key, user_id)

        tool_ids = [b.tool_id for b in bindings]
        if len(tool_ids) != len(set(tool_ids)):
            raise ValidationException("bindings 中 tool_id 必须唯一")

        # 预拉取工具并校验归属；同时确保请求内 tool.name 唯一
        tools_by_id: dict[int, Tool] = {}
        request_names: set[str] = set()
        for b in bindings:
            tool = self._tool_repo.get_by_id(b.tool_id)
            if not tool or tool.user_id != user_id:
                raise NotFoundException("Tool not found", code=ErrorCode.NOT_FOUND)
            if tool.name in request_names:
                raise ValidationException(
                    f"Tool name conflict within request: name='{tool.name}'"
                )
            request_names.add(tool.name)
            tools_by_id[tool.id] = tool

        # 校验与已绑定工具的 name 冲突（无论 binding status）
        for _, existing_tool in self._list_bound_tools(inst.id):
            if existing_tool.id in tools_by_id:
                continue
            if existing_tool.name in request_names:
                raise ValidationException(
                    f"Tool name conflict within mcp_v2: name='{existing_tool.name}'"
                )

        # 记录变更，便于回滚
        processed: list[dict] = []
        wrote_anything = False
        try:
            for b in bindings:
                existed = self._repo.get_mcp_binding_by_mcp_and_tool(inst.id, b.tool_id)
                if existed:
                    prev_status = bool(existed.status)
                    self._repo.update_mcp_binding(existed.id, McpBindingUpdate(status=b.status))
                    wrote_anything = True
                    processed.append(
                        {"tool_id": b.tool_id, "existed": True, "binding_id": existed.id, "prev_status": prev_status}
                    )
                else:
                    created = self._repo.create_mcp_binding(
                        McpBindingCreate(mcp_id=inst.id, tool_id=b.tool_id, status=b.status)
                    )
                    wrote_anything = True
                    processed.append(
                        {"tool_id": b.tool_id, "existed": False, "binding_id": created.id}
                    )
        except Exception as e:
            # 回滚（best-effort）
            for item in reversed(processed):
                try:
                    if item["existed"]:
                        self._repo.update_mcp_binding(
                            int(item["binding_id"]),
                            McpBindingUpdate(status=bool(item["prev_status"])),
                        )
                    else:
                        self._repo.delete_mcp_binding(int(item["binding_id"]))
                except Exception:
                    # 回滚失败不覆盖原始异常
                    pass
            if wrote_anything:
                invalidate_mcp_cache(api_key)
            raise e

        if wrote_anything:
            invalidate_mcp_cache(api_key)

    def create_instance_with_bindings(
        self,
        *,
        user_id: str,
        api_key: str,
        name: str | None,
        status: bool,
        bindings: List[BindToolRequest],
    ) -> McpV2Instance:
        """
        原子创建 MCP v2 并批量绑定 Tool。

        任一 binding 校验/写入失败，则回滚本次创建的 mcp_v2 记录；mcp_binding 通过外键 on delete cascade 自动回收。
        """
        if not bindings:
            raise ValidationException("bindings is required")

        # 预拉取并校验：Tool 必须存在且归属当前用户；同一请求内 tool.name 唯一
        seen_names: set[str] = set()
        for b in bindings:
            tool = self._tool_repo.get_by_id(b.tool_id)
            if not tool or tool.user_id != user_id:
                raise NotFoundException("Tool not found", code=ErrorCode.NOT_FOUND)
            if tool.name in seen_names:
                raise ValidationException(
                    f"Tool name conflict within create payload: name='{tool.name}'"
                )
            seen_names.add(tool.name)

        inst = self.create_instance(user_id=user_id, api_key=api_key, name=name, status=status)

        try:
            for b in bindings:
                # 新创建的 mcp_v2 理论上不存在 binding；若出现唯一约束冲突，让异常上抛触发回滚。
                self._repo.create_mcp_binding(
                    McpBindingCreate(mcp_id=inst.id, tool_id=b.tool_id, status=b.status)
                )
        except Exception as e:
            ok = self._repo.delete_mcp_v2(inst.id)
            invalidate_mcp_cache(api_key)
            if not ok:
                raise BusinessException(
                    "Rollback failed after partial create+bind",
                    code=ErrorCode.INTERNAL_SERVER_ERROR,
                ) from e
            raise

        invalidate_mcp_cache(api_key)
        return inst

    def unbind_tool(self, *, api_key: str, user_id: str, tool_id: int) -> None:
        inst = self.get_by_api_key_with_access_check(api_key, user_id)
        binding = self._repo.get_mcp_binding_by_mcp_and_tool(inst.id, tool_id)
        if not binding:
            raise NotFoundException("Binding not found", code=ErrorCode.NOT_FOUND)
        ok = self._repo.delete_mcp_binding(binding.id)
        if not ok:
            raise BusinessException("Unbind failed", code=ErrorCode.INTERNAL_SERVER_ERROR)
        invalidate_mcp_cache(api_key)

    def update_binding_status(self, *, api_key: str, user_id: str, tool_id: int, status: bool) -> None:
        inst = self.get_by_api_key_with_access_check(api_key, user_id)
        binding = self._repo.get_mcp_binding_by_mcp_and_tool(inst.id, tool_id)
        if not binding:
            raise NotFoundException("Binding not found", code=ErrorCode.NOT_FOUND)
        self._repo.update_mcp_binding(binding.id, McpBindingUpdate(status=status))
        invalidate_mcp_cache(api_key)


