from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List, Optional, Any

from src.exceptions import NotFoundException, ErrorCode, BusinessException
from src.content_node.service import ContentNodeService
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
    def __init__(self, repo: ToolRepositoryBase, node_service: ContentNodeService):
        self.repo = repo
        self.node_service = node_service
        self._sb = get_supabase_repository()

    def _invalidate_bound_agents_mcp(self, tool_id: str) -> None:
        """
        best-effort：当 tool 发生变化时，通知所有绑定了该 tool 的 Agent 使 MCP 缓存失效。
        
        基于新的 agent_tool 表结构：
        - 查找所有绑定了该 tool 的 agent_tool 记录
        - 获取对应 Agent 的 mcp_api_key
        - 使 MCP 缓存失效
        """
        from src.agent.config.repository import AgentRepository
        
        try:
            # 查询 agent_tool 表中绑定了该 tool 的记录
            response = self._sb._client.table("agent_tool").select("agent_id").eq("tool_id", tool_id).execute()
            if not response.data:
                return
            
            agent_repo = AgentRepository()
            seen_keys = set()
            
            for row in response.data:
                agent_id = row.get("agent_id")
                if not agent_id:
                    continue
                agent = agent_repo.get_by_id(agent_id)
                if not agent or not agent.mcp_api_key:
                    continue
                if agent.mcp_api_key in seen_keys:
                    continue
                seen_keys.add(agent.mcp_api_key)
                invalidate_mcp_cache(agent.mcp_api_key)
        except Exception:
            # best-effort，不抛异常
            pass

    def _assert_name_update_no_conflict(
        self, tool_id: str, user_id: str, new_name: str
    ) -> None:
        """
        检查更新 tool name 是否会导致冲突。
        
        在 MCP V3 架构中，Tool 通过 agent_tool 绑定到 Agent。
        同一个 Agent 下的 Tools 名称应该唯一（通过 MCP 暴露时）。
        """
        from src.agent.config.repository import AgentRepository
        
        try:
            # 查询 agent_tool 表中绑定了该 tool 的 Agent
            response = self._sb._client.table("agent_tool").select("agent_id").eq("tool_id", tool_id).execute()
            if not response.data:
                return
            
            agent_repo = AgentRepository()
            
            for row in response.data:
                agent_id = row.get("agent_id")
                if not agent_id:
                    continue
                
                # 获取该 Agent 的所有 Tools
                agent_tools = agent_repo.get_tools_by_agent_id(agent_id)
                for at in agent_tools:
                    if at.tool_id == tool_id:
                        continue
                    sib = self.repo.get_by_id(at.tool_id)
                    if not sib:
                        continue
                    if sib.user_id != user_id:
                        continue
                    if sib.name == new_name:
                        raise BusinessException(
                            f"Tool name conflict within Agent (agent_id={agent_id}): name='{new_name}'",
                            code=ErrorCode.VALIDATION_ERROR,
                        )
        except BusinessException:
            raise
        except Exception:
            # 其他异常忽略
            pass

    def list_user_tools(
        self, user_id: str, *, skip: int = 0, limit: int = 100
    ) -> List[Tool]:
        return self.repo.get_by_user_id(user_id, skip=skip, limit=limit)

    def list_user_tools_by_node_id(
        self,
        user_id: str,
        *,
        node_id: str,
        skip: int = 0,
        limit: int = 1000,
    ) -> List[Tool]:
        # 校验节点存在
        # TODO: 添加 project 成员关系验证
        self.node_service.get_by_id_unsafe(node_id)
        return self.repo.get_by_user_id(
            user_id, skip=skip, limit=limit, node_id=node_id
        )

    def get_by_id(self, tool_id: str) -> Optional[Tool]:
        return self.repo.get_by_id(tool_id)

    def get_by_id_with_access_check(self, tool_id: str, user_id: str) -> Tool:
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
        node_id: Optional[str],
        json_path: str,
        type: str,
        name: str,
        alias: Optional[str],
        description: Optional[str],
        input_schema: Optional[Any],
        output_schema: Optional[Any],
        metadata: Optional[Any],
        category: str = "builtin",
        script_type: Optional[str] = None,
        script_content: Optional[str] = None,
        project_id: Optional[str] = None,  # 新增：允许直接传入 project_id
    ) -> Tool:
        # 对于内置工具，校验节点存在
        # 同时自动获取 project_id（如果未传入）
        # TODO: 添加 project 成员关系验证
        if node_id and category == "builtin":
            node = self.node_service.get_by_id_unsafe(node_id)
            if not project_id:
                project_id = node.project_id

        # 默认工具描述：当未传 description（或仅空白）时，根据 type 自动填充默认值
        if description is None or not str(description).strip():
            description = _get_default_tool_description(str(type))

        created = self.repo.create(
            SbToolCreate(
                user_id=user_id,
                project_id=project_id,
                node_id=node_id,
                json_path=json_path,
                type=type,
                name=name,
                alias=alias,
                description=description,
                input_schema=input_schema,
                output_schema=output_schema,
                metadata=metadata,
                category=category,
                script_type=script_type,
                script_content=script_content,
            )
        )
        return created

    def update(self, *, tool_id: str, user_id: str, patch: dict[str, Any]) -> Tool:
        existing = self.get_by_id_with_access_check(tool_id, user_id)

        # 只处理传入的字段（路由层已用 exclude_unset 生成 patch）
        name = patch.get("name")
        if name is not None and name != existing.name:
            self._assert_name_update_no_conflict(tool_id, user_id, name)

        node_id = patch.get("node_id")
        if node_id is not None:
            # TODO: 添加 project 成员关系验证
            self.node_service.get_by_id_unsafe(node_id)

        updated = self.repo.update(
            tool_id,
            SbToolUpdate(
                node_id=patch.get("node_id"),
                json_path=patch.get("json_path"),
                type=patch.get("type"),
                name=patch.get("name"),
                alias=patch.get("alias"),
                description=patch.get("description"),
                input_schema=patch.get("input_schema"),
                output_schema=patch.get("output_schema"),
                metadata=patch.get("metadata"),
                category=patch.get("category"),
                script_type=patch.get("script_type"),
                script_content=patch.get("script_content"),
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

        # 触发所有绑定该 tool 的 Agent MCP 缓存失效
        self._invalidate_bound_agents_mcp(tool_id)

        return updated

    def list_user_tools_by_project_id(
        self,
        user_id: str,
        *,
        project_id: str,
        limit: int = 1000,
    ) -> List[Tool]:
        """
        项目级聚合：返回该用户在指定项目下的所有 tools。
        通过 tool.project_id 字段直接过滤。
        """
        return self.repo.get_by_user_id(
            user_id, skip=0, limit=limit, project_id=project_id
        )

    def delete(self, tool_id: str, user_id: str) -> None:
        _ = self.get_by_id_with_access_check(tool_id, user_id)
        ok = self.repo.delete(tool_id)
        if not ok:
            raise BusinessException(
                "Tool delete failed", code=ErrorCode.INTERNAL_SERVER_ERROR
            )
        self._invalidate_bound_agents_mcp(tool_id)
