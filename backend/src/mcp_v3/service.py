"""
MCP V3 服务层

基于 Agent 架构的 MCP 服务，主要职责：
1. 通过 mcp_api_key 获取 Agent 配置
2. 管理 Agent 的 Tool 绑定（MCP 暴露）
3. 提供 MCP 特有的视图
"""

from __future__ import annotations

import secrets
from typing import List, Optional

from src.agent.config.models import Agent, AgentTool
from src.agent.config.repository import AgentRepository
from src.tool.repository import ToolRepositoryBase, ToolRepositorySupabase
from src.tool.models import Tool
from src.supabase.dependencies import get_supabase_repository
from src.mcp.cache_invalidator import invalidate_mcp_cache
from src.exceptions import NotFoundException, ErrorCode, BusinessException

from .models import McpAgentInfo, McpBoundTool
from .schemas import BindToolRequest


class McpV3Service:
    """MCP V3 服务"""

    def __init__(
        self,
        agent_repo: AgentRepository = None,
        tool_repo: ToolRepositoryBase = None,
    ):
        self._agent_repo = agent_repo or AgentRepository()
        self._tool_repo = tool_repo or ToolRepositorySupabase(get_supabase_repository())

    # ============================================
    # Agent MCP 配置
    # ============================================

    def get_agent_by_mcp_key(self, mcp_api_key: str) -> Optional[Agent]:
        """通过 MCP API Key 获取 Agent（带 tools）"""
        return self._agent_repo.get_by_mcp_api_key_with_accesses(mcp_api_key)

    def get_agent_mcp_info(self, agent_id: str, user_id: str) -> McpAgentInfo:
        """获取 Agent 的 MCP 配置信息"""
        agent = self._agent_repo.get_by_id(agent_id)
        if not agent or not self._agent_repo.verify_access(agent_id, user_id):
            raise NotFoundException("Agent not found", code=ErrorCode.NOT_FOUND)

        return McpAgentInfo(
            id=agent.id,
            name=agent.name,
            icon=agent.icon,
            mcp_api_key=agent.mcp_api_key or "",
            mcp_enabled=bool(agent.mcp_api_key),
            created_at=agent.created_at,
        )

    def regenerate_mcp_key(self, agent_id: str, user_id: str) -> str:
        """重新生成 Agent 的 MCP API Key"""
        agent = self._agent_repo.get_by_id(agent_id)
        if not agent or not self._agent_repo.verify_access(agent_id, user_id):
            raise NotFoundException("Agent not found", code=ErrorCode.NOT_FOUND)

        # 使旧 key 的缓存失效
        if agent.mcp_api_key:
            invalidate_mcp_cache(agent.mcp_api_key)

        # 生成新 key
        new_key = f"mcp_{secrets.token_urlsafe(32)}"
        updated = self._agent_repo.update(agent_id, mcp_api_key=new_key)
        if not updated:
            raise BusinessException(
                "Failed to regenerate MCP API key",
                code=ErrorCode.INTERNAL_SERVER_ERROR,
            )

        return new_key

    # ============================================
    # Tool 绑定管理
    # ============================================

    def list_bound_tools(
        self,
        agent_id: str,
        user_id: str,
        *,
        mcp_exposed_only: bool = False,
    ) -> List[McpBoundTool]:
        """获取 Agent 绑定的 Tools"""
        agent = self._agent_repo.get_by_id(agent_id)
        if not agent or not self._agent_repo.verify_access(agent_id, user_id):
            raise NotFoundException("Agent not found", code=ErrorCode.NOT_FOUND)

        # 获取绑定关系
        if mcp_exposed_only:
            agent_tools = self._agent_repo.get_tools_by_agent_id_for_mcp(agent_id)
        else:
            agent_tools = self._agent_repo.get_tools_by_agent_id(agent_id)

        # 获取 Tool 详情
        result: List[McpBoundTool] = []
        for at in agent_tools:
            tool = self._tool_repo.get_by_id(at.tool_id)
            if not tool:
                continue
            result.append(
                McpBoundTool(
                    id=at.id,
                    tool_id=tool.id,
                    name=tool.name,
                    type=tool.type,
                    description=tool.description,
                    node_id=tool.node_id,
                    json_path=tool.json_path,
                    enabled=at.enabled,
                    mcp_exposed=at.mcp_exposed,
                    category=tool.category,
                )
            )

        return result

    def bind_tool(
        self,
        agent_id: str,
        user_id: str,
        tool_id: str,
        enabled: bool = True,
        mcp_exposed: bool = True,
    ) -> AgentTool:
        """绑定 Tool 到 Agent"""
        # 验证 Agent 权限（通过 project）
        agent = self._agent_repo.get_by_id(agent_id)
        if not agent or not self._agent_repo.verify_access(agent_id, user_id):
            raise NotFoundException("Agent not found", code=ErrorCode.NOT_FOUND)

        # 验证 Tool 权限（Tool 直接绑定到 user_id）
        tool = self._tool_repo.get_by_id(tool_id)
        if not tool or tool.user_id != user_id:
            raise NotFoundException("Tool not found", code=ErrorCode.NOT_FOUND)

        # 创建或更新绑定
        binding = self._agent_repo.upsert_tool_binding(
            agent_id=agent_id,
            tool_id=tool_id,
            enabled=enabled,
            mcp_exposed=mcp_exposed,
        )

        # 使 MCP 缓存失效
        if agent.mcp_api_key:
            invalidate_mcp_cache(agent.mcp_api_key)

        return binding

    def bind_tools(
        self,
        agent_id: str,
        user_id: str,
        bindings: List[BindToolRequest],
    ) -> List[AgentTool]:
        """批量绑定 Tools 到 Agent"""
        # 验证 Agent 权限（通过 project）
        agent = self._agent_repo.get_by_id(agent_id)
        if not agent or not self._agent_repo.verify_access(agent_id, user_id):
            raise NotFoundException("Agent not found", code=ErrorCode.NOT_FOUND)

        result: List[AgentTool] = []
        for b in bindings:
            # 验证 Tool 权限
            tool = self._tool_repo.get_by_id(b.tool_id)
            if not tool or tool.user_id != user_id:
                raise NotFoundException(
                    f"Tool not found: {b.tool_id}", code=ErrorCode.NOT_FOUND
                )

            binding = self._agent_repo.upsert_tool_binding(
                agent_id=agent_id,
                tool_id=b.tool_id,
                enabled=b.enabled,
                mcp_exposed=b.mcp_exposed,
            )
            result.append(binding)

        # 使 MCP 缓存失效
        if agent.mcp_api_key:
            invalidate_mcp_cache(agent.mcp_api_key)

        return result

    def update_tool_binding(
        self,
        agent_id: str,
        user_id: str,
        tool_id: str,
        enabled: Optional[bool] = None,
        mcp_exposed: Optional[bool] = None,
    ) -> AgentTool:
        """更新 Tool 绑定"""
        # 验证 Agent 权限（通过 project）
        agent = self._agent_repo.get_by_id(agent_id)
        if not agent or not self._agent_repo.verify_access(agent_id, user_id):
            raise NotFoundException("Agent not found", code=ErrorCode.NOT_FOUND)

        # 查找现有绑定
        binding = self._agent_repo.get_tool_binding_by_agent_and_tool(agent_id, tool_id)
        if not binding:
            raise NotFoundException("Tool binding not found", code=ErrorCode.NOT_FOUND)

        # 更新
        updated = self._agent_repo.update_tool_binding(
            binding.id,
            enabled=enabled,
            mcp_exposed=mcp_exposed,
        )
        if not updated:
            raise BusinessException(
                "Failed to update tool binding",
                code=ErrorCode.INTERNAL_SERVER_ERROR,
            )

        # 使 MCP 缓存失效
        if agent.mcp_api_key:
            invalidate_mcp_cache(agent.mcp_api_key)

        return updated

    def unbind_tool(self, agent_id: str, user_id: str, tool_id: str) -> bool:
        """解绑 Tool"""
        # 验证 Agent 权限（通过 project）
        agent = self._agent_repo.get_by_id(agent_id)
        if not agent or not self._agent_repo.verify_access(agent_id, user_id):
            raise NotFoundException("Agent not found", code=ErrorCode.NOT_FOUND)

        # 查找现有绑定
        binding = self._agent_repo.get_tool_binding_by_agent_and_tool(agent_id, tool_id)
        if not binding:
            raise NotFoundException("Tool binding not found", code=ErrorCode.NOT_FOUND)

        # 删除
        ok = self._agent_repo.delete_tool_binding(binding.id)
        if not ok:
            raise BusinessException(
                "Failed to unbind tool",
                code=ErrorCode.INTERNAL_SERVER_ERROR,
            )

        # 使 MCP 缓存失效
        if agent.mcp_api_key:
            invalidate_mcp_cache(agent.mcp_api_key)

        return True

    def get_mcp_status(self, agent_id: str, user_id: str) -> dict:
        """获取 Agent 的 MCP 状态摘要"""
        agent = self._agent_repo.get_by_id(agent_id)
        if not agent or not self._agent_repo.verify_access(agent_id, user_id):
            raise NotFoundException("Agent not found", code=ErrorCode.NOT_FOUND)

        all_tools = self._agent_repo.get_tools_by_agent_id(agent_id)
        mcp_exposed = [t for t in all_tools if t.enabled and t.mcp_exposed]

        return {
            "agent_id": agent.id,
            "mcp_api_key": agent.mcp_api_key or "",
            "mcp_enabled": bool(agent.mcp_api_key),
            "tools_count": len(all_tools),
            "mcp_exposed_count": len(mcp_exposed),
        }

