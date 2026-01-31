"""
Agent Config 数据仓库

定义 Agent 和 AgentBash 的数据访问实现
"""

from typing import List, Optional
import secrets

from src.agent.config.models import Agent, AgentBash, AgentTool
from src.utils.id_generator import generate_uuid_v7


def generate_mcp_api_key() -> str:
    """Generate a secure MCP API key"""
    return f"mcp_{secrets.token_urlsafe(32)}"


class AgentRepository:
    """Agent 数据仓库"""

    def __init__(self, supabase_client=None):
        if supabase_client is None:
            from src.supabase.dependencies import get_supabase_client

            self._client = get_supabase_client()
        else:
            self._client = supabase_client

    # ============================================
    # Agent CRUD
    # ============================================

    def get_by_id(self, agent_id: str) -> Optional[Agent]:
        """根据 ID 获取 Agent"""
        response = (
            self._client.table("agent")
            .select("*")
            .eq("id", agent_id)
            .execute()
        )
        if response.data:
            return Agent(**response.data[0])
        return None

    def get_by_id_with_accesses(self, agent_id: str) -> Optional[Agent]:
        """根据 ID 获取 Agent，包含 Bash 访问权限和 Tools"""
        agent = self.get_by_id(agent_id)
        if agent:
            agent.bash_accesses = self.get_bash_by_agent_id(agent_id)
            agent.tools = self.get_tools_by_agent_id(agent_id)
        return agent

    def get_by_user_id(self, user_id: str) -> List[Agent]:
        """根据用户 ID 获取 Agent 列表"""
        response = (
            self._client.table("agent")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return [Agent(**row) for row in response.data]

    def get_by_user_id_with_accesses(self, user_id: str) -> List[Agent]:
        """根据用户 ID 获取 Agent 列表，包含 Bash 访问权限和 Tools"""
        agents = self.get_by_user_id(user_id)
        for agent in agents:
            agent.bash_accesses = self.get_bash_by_agent_id(agent.id)
            agent.tools = self.get_tools_by_agent_id(agent.id)
        return agents

    def get_default_agent(self, user_id: str) -> Optional[Agent]:
        """获取用户的默认 Agent"""
        response = (
            self._client.table("agent")
            .select("*")
            .eq("user_id", user_id)
            .eq("is_default", True)
            .execute()
        )
        if response.data:
            return Agent(**response.data[0])
        return None

    def get_by_mcp_api_key(self, mcp_api_key: str) -> Optional[Agent]:
        """根据 MCP API key 获取 Agent"""
        response = (
            self._client.table("agent")
            .select("*")
            .eq("mcp_api_key", mcp_api_key)
            .execute()
        )
        if response.data:
            return Agent(**response.data[0])
        return None

    def get_by_mcp_api_key_with_accesses(self, mcp_api_key: str) -> Optional[Agent]:
        """根据 MCP API key 获取 Agent，包含 Bash 访问权限和 MCP 暴露的 Tools"""
        agent = self.get_by_mcp_api_key(mcp_api_key)
        if agent:
            agent.bash_accesses = self.get_bash_by_agent_id(agent.id)
            # MCP 访问只返回 mcp_exposed=True 的 Tools
            agent.tools = self.get_tools_by_agent_id_for_mcp(agent.id)
        return agent

    def create(
        self,
        user_id: str,
        name: str,
        icon: str = "✨",
        type: str = "chat",
        description: Optional[str] = None,
        is_default: bool = False,
        # Schedule Agent 新字段
        trigger_type: Optional[str] = "manual",
        trigger_config: Optional[dict] = None,
        task_content: Optional[str] = None,
        task_node_id: Optional[str] = None,
        external_config: Optional[dict] = None,
    ) -> Agent:
        """创建 Agent (自动生成 mcp_api_key)"""
        agent_id = generate_uuid_v7()
        mcp_api_key = generate_mcp_api_key()
        data = {
            "id": agent_id,
            "user_id": user_id,
            "name": name,
            "icon": icon,
            "type": type,
            "description": description,
            "is_default": is_default,
            "mcp_api_key": mcp_api_key,
            "trigger_type": trigger_type,
            "trigger_config": trigger_config,
            "task_content": task_content,
            "task_node_id": task_node_id,
            "external_config": external_config,
        }
        response = self._client.table("agent").insert(data).execute()
        return Agent(**response.data[0])

    def update(
        self,
        agent_id: str,
        name: Optional[str] = None,
        icon: Optional[str] = None,
        type: Optional[str] = None,
        description: Optional[str] = None,
        is_default: Optional[bool] = None,
        # Schedule Agent 新字段
        trigger_type: Optional[str] = None,
        trigger_config: Optional[dict] = None,
        task_content: Optional[str] = None,
        task_node_id: Optional[str] = None,
        external_config: Optional[dict] = None,
    ) -> Optional[Agent]:
        """更新 Agent"""
        data = {}
        if name is not None:
            data["name"] = name
        if icon is not None:
            data["icon"] = icon
        if type is not None:
            data["type"] = type
        if description is not None:
            data["description"] = description
        if is_default is not None:
            data["is_default"] = is_default
        # Schedule Agent 新字段
        if trigger_type is not None:
            data["trigger_type"] = trigger_type
        if trigger_config is not None:
            data["trigger_config"] = trigger_config
        if task_content is not None:
            data["task_content"] = task_content
        if task_node_id is not None:
            data["task_node_id"] = task_node_id
        if external_config is not None:
            data["external_config"] = external_config

        if not data:
            return self.get_by_id(agent_id)

        data["updated_at"] = "now()"
        response = (
            self._client.table("agent")
            .update(data)
            .eq("id", agent_id)
            .execute()
        )
        if response.data:
            return Agent(**response.data[0])
        return None

    def delete(self, agent_id: str) -> bool:
        """删除 Agent（会级联删除 agent_bash）"""
        response = (
            self._client.table("agent")
            .delete()
            .eq("id", agent_id)
            .execute()
        )
        return len(response.data) > 0

    def verify_access(self, agent_id: str, user_id: str) -> bool:
        """验证用户是否有权限访问指定的 Agent"""
        agent = self.get_by_id(agent_id)
        if not agent:
            return False
        return agent.user_id == user_id

    # ============================================
    # AgentBash CRUD (Bash 终端访问权限)
    # ============================================

    def get_bash_by_agent_id(self, agent_id: str) -> List[AgentBash]:
        """获取 Agent 的所有 Bash 访问权限"""
        response = (
            self._client.table("agent_bash")
            .select("*")
            .eq("agent_id", agent_id)
            .order("created_at")
            .execute()
        )
        return [AgentBash(**row) for row in response.data]

    def get_bash_by_id(self, bash_id: str) -> Optional[AgentBash]:
        """根据 ID 获取单个 AgentBash"""
        response = (
            self._client.table("agent_bash")
            .select("*")
            .eq("id", bash_id)
            .execute()
        )
        if response.data:
            return AgentBash(**response.data[0])
        return None

    def create_bash(
        self,
        agent_id: str,
        node_id: str,
        json_path: str = "",
        readonly: bool = True,
    ) -> AgentBash:
        """创建 AgentBash"""
        bash_id = generate_uuid_v7()
        data = {
            "id": bash_id,
            "agent_id": agent_id,
            "node_id": node_id,
            "json_path": json_path,
            "readonly": readonly,
        }
        response = self._client.table("agent_bash").insert(data).execute()
        return AgentBash(**response.data[0])

    def update_bash(
        self,
        bash_id: str,
        json_path: Optional[str] = None,
        readonly: Optional[bool] = None,
    ) -> Optional[AgentBash]:
        """更新 AgentBash"""
        data = {}
        if json_path is not None:
            data["json_path"] = json_path
        if readonly is not None:
            data["readonly"] = readonly

        if not data:
            return self.get_bash_by_id(bash_id)

        response = (
            self._client.table("agent_bash")
            .update(data)
            .eq("id", bash_id)
            .execute()
        )
        if response.data:
            return AgentBash(**response.data[0])
        return None

    def delete_bash(self, bash_id: str) -> bool:
        """删除单个 AgentBash"""
        response = (
            self._client.table("agent_bash")
            .delete()
            .eq("id", bash_id)
            .execute()
        )
        return len(response.data) > 0

    def delete_bash_by_agent_id(self, agent_id: str) -> int:
        """删除 Agent 的所有 Bash 访问权限"""
        response = (
            self._client.table("agent_bash")
            .delete()
            .eq("agent_id", agent_id)
            .execute()
        )
        return len(response.data)

    def upsert_bash(
        self,
        agent_id: str,
        node_id: str,
        json_path: str = "",
        readonly: bool = True,
    ) -> AgentBash:
        """
        Upsert AgentBash（根据 agent_id + node_id + json_path 唯一约束）
        如果存在则更新，不存在则创建
        """
        bash_id = generate_uuid_v7()
        data = {
            "id": bash_id,
            "agent_id": agent_id,
            "node_id": node_id,
            "json_path": json_path,
            "readonly": readonly,
        }
        response = (
            self._client.table("agent_bash")
            .upsert(data, on_conflict="agent_id,node_id,json_path")
            .execute()
        )
        return AgentBash(**response.data[0])
    
    # ============================================
    # 向后兼容的别名方法
    # ============================================
    
    def get_accesses_by_agent_id(self, agent_id: str) -> List[AgentBash]:
        """获取 Agent 的所有访问权限（向后兼容）"""
        return self.get_bash_by_agent_id(agent_id)
    
    def get_access_by_id(self, access_id: str) -> Optional[AgentBash]:
        """根据 ID 获取单个访问权限（向后兼容）"""
        return self.get_bash_by_id(access_id)
    
    def create_access(
        self,
        agent_id: str,
        node_id: str,
        terminal: bool = False,
        terminal_readonly: bool = True,
        can_read: bool = False,
        can_write: bool = False,
        can_delete: bool = False,
        json_path: str = "",
    ) -> AgentBash:
        """创建访问权限（向后兼容）"""
        # 新表结构只有 readonly 字段
        readonly = terminal_readonly if terminal else True
        return self.create_bash(agent_id, node_id, json_path, readonly)
    
    def update_access(
        self,
        access_id: str,
        terminal: Optional[bool] = None,
        terminal_readonly: Optional[bool] = None,
        can_read: Optional[bool] = None,
        can_write: Optional[bool] = None,
        can_delete: Optional[bool] = None,
        json_path: Optional[str] = None,
    ) -> Optional[AgentBash]:
        """更新访问权限（向后兼容）"""
        readonly = terminal_readonly
        return self.update_bash(access_id, json_path, readonly)
    
    def delete_access(self, access_id: str) -> bool:
        """删除访问权限（向后兼容）"""
        return self.delete_bash(access_id)
    
    def delete_accesses_by_agent_id(self, agent_id: str) -> int:
        """删除 Agent 的所有访问权限（向后兼容）"""
        return self.delete_bash_by_agent_id(agent_id)

    # ============================================
    # AgentTool CRUD (Tool 关联)
    # ============================================

    def get_tools_by_agent_id(self, agent_id: str) -> List[AgentTool]:
        """获取 Agent 关联的所有 Tools"""
        response = (
            self._client.table("agent_tool")
            .select("*")
            .eq("agent_id", agent_id)
            .order("created_at")
            .execute()
        )
        return [AgentTool(**row) for row in response.data]

    def get_tools_by_agent_id_for_mcp(self, agent_id: str) -> List[AgentTool]:
        """获取 Agent 关联的可通过 MCP 暴露的 Tools"""
        response = (
            self._client.table("agent_tool")
            .select("*")
            .eq("agent_id", agent_id)
            .eq("enabled", True)
            .eq("mcp_exposed", True)
            .order("created_at")
            .execute()
        )
        return [AgentTool(**row) for row in response.data]

    def get_tool_binding_by_id(self, binding_id: str) -> Optional[AgentTool]:
        """根据 ID 获取单个 AgentTool"""
        response = (
            self._client.table("agent_tool")
            .select("*")
            .eq("id", binding_id)
            .execute()
        )
        if response.data:
            return AgentTool(**response.data[0])
        return None

    def create_tool_binding(
        self,
        agent_id: str,
        tool_id: str,
        enabled: bool = True,
        mcp_exposed: bool = False,
    ) -> AgentTool:
        """创建 AgentTool 关联"""
        binding_id = generate_uuid_v7()
        data = {
            "id": binding_id,
            "agent_id": agent_id,
            "tool_id": tool_id,
            "enabled": enabled,
            "mcp_exposed": mcp_exposed,
        }
        response = self._client.table("agent_tool").insert(data).execute()
        return AgentTool(**response.data[0])

    def update_tool_binding(
        self,
        binding_id: str,
        enabled: Optional[bool] = None,
        mcp_exposed: Optional[bool] = None,
    ) -> Optional[AgentTool]:
        """更新 AgentTool 关联"""
        data = {}
        if enabled is not None:
            data["enabled"] = enabled
        if mcp_exposed is not None:
            data["mcp_exposed"] = mcp_exposed

        if not data:
            return self.get_tool_binding_by_id(binding_id)

        response = (
            self._client.table("agent_tool")
            .update(data)
            .eq("id", binding_id)
            .execute()
        )
        if response.data:
            return AgentTool(**response.data[0])
        return None

    def delete_tool_binding(self, binding_id: str) -> bool:
        """删除单个 AgentTool 关联"""
        response = (
            self._client.table("agent_tool")
            .delete()
            .eq("id", binding_id)
            .execute()
        )
        return len(response.data) > 0

    def delete_tools_by_agent_id(self, agent_id: str) -> int:
        """删除 Agent 的所有 Tool 关联"""
        response = (
            self._client.table("agent_tool")
            .delete()
            .eq("agent_id", agent_id)
            .execute()
        )
        return len(response.data)

    def get_tool_binding_by_agent_and_tool(
        self, agent_id: str, tool_id: str
    ) -> Optional[AgentTool]:
        """根据 agent_id 和 tool_id 获取 AgentTool"""
        response = (
            self._client.table("agent_tool")
            .select("*")
            .eq("agent_id", agent_id)
            .eq("tool_id", tool_id)
            .execute()
        )
        if response.data:
            return AgentTool(**response.data[0])
        return None

    def upsert_tool_binding(
        self,
        agent_id: str,
        tool_id: str,
        enabled: bool = True,
        mcp_exposed: bool = False,
    ) -> AgentTool:
        """
        Upsert AgentTool（根据 agent_id + tool_id 唯一约束）
        如果存在则更新，不存在则创建
        """
        binding_id = generate_uuid_v7()
        data = {
            "id": binding_id,
            "agent_id": agent_id,
            "tool_id": tool_id,
            "enabled": enabled,
            "mcp_exposed": mcp_exposed,
        }
        response = (
            self._client.table("agent_tool")
            .upsert(data, on_conflict="agent_id,tool_id")
            .execute()
        )
        return AgentTool(**response.data[0])

    # ============================================
    # Execution History
    # ============================================

    def get_execution_history(self, agent_id: str, limit: int = 10) -> list[dict]:
        """获取 Agent 的执行历史"""
        response = (
            self._client.table("agent_execution_log")
            .select("*")
            .eq("agent_id", agent_id)
            .order("started_at", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []

