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
from src.project.service import ProjectService


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
    def __init__(
        self,
        repo: ToolRepositoryBase,
        node_service: ContentNodeService,
        project_service: ProjectService,
        supabase_repository: Optional[Any] = None,
    ):
        self.repo = repo
        self.node_service = node_service
        self.project_service = project_service
        self._sb = supabase_repository

    def _get_supabase_repository(self):
        if self._sb is None:
            self._sb = get_supabase_repository()
        return self._sb

    def get_node_with_access_check(self, user_id: str, node_id: str):
        node = self.node_service.get_by_id_unsafe(node_id)
        if not self.project_service.verify_project_access(node.project_id, user_id):
            raise NotFoundException(
                f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND
            )
        return node

    def _invalidate_bound_agents_mcp(self, tool_id: str) -> None:
        """
        best-effort：当 tool 发生变化时，通知所有绑定了该 tool 的 Agent 使 MCP 缓存失效。
        
        基于 connection_tool 表结构：
        - 查找所有绑定了该 tool 的 connection_tool 记录
        - 获取对应 Agent 的 mcp_api_key
        - 使 MCP 缓存失效
        """
        from src.agent.config.repository import AgentRepository
        
        try:
            response = self._get_supabase_repository()._client.table("connection_tools").select("connection_id").eq("tool_id", tool_id).execute()
            if not response.data:
                return
            
            agent_repo = AgentRepository()
            seen_keys = set()
            
            for row in response.data:
                conn_id = row.get("connection_id")
                if not conn_id:
                    continue
                agent = agent_repo.get_by_id(conn_id)
                if not agent or not agent.mcp_api_key:
                    continue
                if agent.mcp_api_key in seen_keys:
                    continue
                seen_keys.add(agent.mcp_api_key)
                invalidate_mcp_cache(agent.mcp_api_key)
        except Exception:
            pass

    def _assert_name_update_no_conflict(
        self, tool_id: str, user_id: str, new_name: str
    ) -> None:
        """
        Check if updating tool name would conflict with sibling tools
        in the same connection (Agent or MCP).
        """
        from src.agent.config.repository import AgentRepository
        
        try:
            response = self._get_supabase_repository()._client.table("connection_tools").select("connection_id").eq("tool_id", tool_id).execute()
            if not response.data:
                return
            
            agent_repo = AgentRepository()
            
            for row in response.data:
                conn_id = row.get("connection_id")
                if not conn_id:
                    continue
                
                agent_tools = agent_repo.get_tools_by_agent_id(conn_id)
                for at in agent_tools:
                    if at.tool_id == tool_id:
                        continue
                    sib = self.repo.get_by_id(at.tool_id)
                    if not sib:
                        continue
                    if sib.created_by != user_id:
                        continue
                    if sib.name == new_name:
                        raise BusinessException(
                            f"Tool name conflict within connection (connection_id={conn_id}): name='{new_name}'",
                            code=ErrorCode.VALIDATION_ERROR,
                        )
        except BusinessException:
            raise
        except Exception:
            # 其他异常忽略
            pass

    def list_org_tools(
        self, org_id: str, *, skip: int = 0, limit: int = 100
    ) -> List[Tool]:
        return self.repo.get_by_org_id(org_id, skip=skip, limit=limit)

    def list_org_tools_by_node_id(
        self,
        user_id: str,
        org_id: str,
        *,
        node_id: str,
        skip: int = 0,
        limit: int = 1000,
    ) -> List[Tool]:
        self.get_node_with_access_check(user_id, node_id)
        return self.repo.get_by_org_id(
            org_id, skip=skip, limit=limit, node_id=node_id
        )

    def get_by_id(self, tool_id: str) -> Optional[Tool]:
        return self.repo.get_by_id(tool_id)

    def get_by_id_with_access_check(self, tool_id: str, user_id: str) -> Tool:
        tool = self.repo.get_by_id(tool_id)
        if not tool:
            raise NotFoundException(
                f"Tool not found: {tool_id}", code=ErrorCode.NOT_FOUND
            )
        if tool.project_id:
            if not self.project_service.verify_project_access(tool.project_id, user_id):
                raise NotFoundException(
                    f"Tool not found: {tool_id}", code=ErrorCode.NOT_FOUND
                )
        return tool

    def create(
        self,
        *,
        org_id: str,
        created_by: Optional[str] = None,
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
        project_id: Optional[str] = None,
    ) -> Tool:
        if node_id and created_by:
            node = self.get_node_with_access_check(created_by, node_id)
            if project_id and project_id != node.project_id:
                raise BusinessException(
                    "node_id does not belong to project_id",
                    code=ErrorCode.VALIDATION_ERROR,
                )
            if not project_id:
                project_id = node.project_id

        # 默认工具描述：当未传 description（或仅空白）时，根据 type 自动填充默认值
        if description is None or not str(description).strip():
            description = _get_default_tool_description(str(type))

        created = self.repo.create(
            SbToolCreate(
                created_by=created_by,
                org_id=org_id,
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
            node = self.get_node_with_access_check(user_id, node_id)
            if existing.project_id and node.project_id != existing.project_id:
                raise BusinessException(
                    "cannot move tool across projects via node_id update",
                    code=ErrorCode.VALIDATION_ERROR,
                )

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

        if updated.org_id != existing.org_id:
            raise BusinessException(
                "Tool org mismatch after update", code=ErrorCode.INTERNAL_SERVER_ERROR
            )

        # 触发所有绑定该 tool 的 Agent MCP 缓存失效
        self._invalidate_bound_agents_mcp(tool_id)

        return updated

    def list_org_tools_by_project_id(
        self,
        org_id: str,
        *,
        project_id: str,
        limit: int = 1000,
    ) -> List[Tool]:
        return self.repo.get_by_org_id(
            org_id, skip=0, limit=limit, project_id=project_id
        )

    def delete(self, tool_id: str, user_id: str) -> None:
        _ = self.get_by_id_with_access_check(tool_id, user_id)
        ok = self.repo.delete(tool_id)
        if not ok:
            raise BusinessException(
                "Tool delete failed", code=ErrorCode.INTERNAL_SERVER_ERROR
            )
        self._invalidate_bound_agents_mcp(tool_id)
