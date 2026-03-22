from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List, Optional, Any

from src.exceptions import NotFoundException, ErrorCode, BusinessException
from src.mut_engine.ops import MutOps
from src.tool.models import Tool
from src.tool.repository import ToolRepositoryBase
from src.tool.supabase_schemas import (
    ToolCreate as SbToolCreate,
    ToolUpdate as SbToolUpdate,
)
from src.infra.supabase.dependencies import get_supabase_repository
from src.mcp.cache_invalidator import invalidate_mcp_cache
from src.platform.project.service import ProjectService


@lru_cache(maxsize=64)
def _get_default_tool_description(tool_type: str) -> Optional[str]:
    """
    Read default tool description from `src/mcp/description/{tool_type}.txt` (used as default for Tool.description).
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
        ops: MutOps,
        project_service: ProjectService,
        supabase_repository: Optional[Any] = None,
    ):
        self.repo = repo
        self._ops = ops
        self.project_service = project_service
        self._sb = supabase_repository

    def _get_supabase_repository(self):
        if self._sb is None:
            self._sb = get_supabase_repository()
        return self._sb

    def get_path_with_access_check(self, user_id: str, path: str):
        """Check that a path is accessible.

        Returns a simple object with project_id and type attributes.
        """
        from types import SimpleNamespace
        tool = self.repo.get_by_path(path) if hasattr(self.repo, 'get_by_path') else None
        project_id = tool.project_id if tool else None

        if not project_id:
            all_tools = self.repo.get_by_path_simple(path) if hasattr(self.repo, 'get_by_path_simple') else []
            if all_tools:
                project_id = all_tools[0].project_id

        if project_id:
            if not self.project_service.verify_project_access(project_id, user_id):
                raise NotFoundException(
                    f"Node not found: {path}", code=ErrorCode.NOT_FOUND
                )
            entry = self._ops.stat(project_id, path)
            if entry:
                return SimpleNamespace(
                    project_id=project_id,
                    type=entry.type,
                    name=entry.name,
                    path=entry.path,
                )

        raise NotFoundException(
            f"Node not found: {path}", code=ErrorCode.NOT_FOUND
        )

    def _invalidate_bound_agents_mcp(self, tool_id: str) -> None:
        """
        Best-effort: when a tool changes, notify all Agents bound to this tool to invalidate their MCP cache.

        Based on the connection_tool table structure:
        - Find all connection_tool records bound to this tool
        - Get the corresponding Agent's mcp_api_key
        - Invalidate MCP cache
        """
        from src.connectors.agent.config.repository import AgentRepository
        
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
        from src.connectors.agent.config.repository import AgentRepository
        
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
            # Ignore other exceptions
            pass

    def list_org_tools(
        self, org_id: str, *, skip: int = 0, limit: int = 100
    ) -> List[Tool]:
        return self.repo.get_by_org_id(org_id, skip=skip, limit=limit)

    def list_org_tools_by_path(
        self,
        user_id: str,
        org_id: str,
        *,
        path: str,
        skip: int = 0,
        limit: int = 1000,
    ) -> List[Tool]:
        self.get_path_with_access_check(user_id, path)
        return self.repo.get_by_org_id(
            org_id, skip=skip, limit=limit, path=path
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
        path: Optional[str],
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
        if path and created_by:
            node = self.get_path_with_access_check(created_by, path)
            if project_id and project_id != node.project_id:
                raise BusinessException(
                    "path does not belong to project_id",
                    code=ErrorCode.VALIDATION_ERROR,
                )
            if not project_id:
                project_id = node.project_id

        if description is None or not str(description).strip():
            description = _get_default_tool_description(str(type))

        created = self.repo.create(
            SbToolCreate(
                created_by=created_by,
                org_id=org_id,
                project_id=project_id,
                path=path,
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

        # Only process fields that were passed in (router layer used exclude_unset to generate patch)
        name = patch.get("name")
        if name is not None and name != existing.name:
            self._assert_name_update_no_conflict(tool_id, user_id, name)

        path = patch.get("path")
        if path is not None:
            self.get_path_with_access_check(user_id, path)

        updated = self.repo.update(
            tool_id,
            SbToolUpdate(
                path=patch.get("path"),
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
            # Should not happen in practice (already did get_by_id_with_access_check); this is a safety net
            raise BusinessException(
                "Tool update failed", code=ErrorCode.INTERNAL_SERVER_ERROR
            )

        if updated.org_id != existing.org_id:
            raise BusinessException(
                "Tool org mismatch after update", code=ErrorCode.INTERNAL_SERVER_ERROR
            )

        # Trigger MCP cache invalidation for all Agents bound to this tool
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
