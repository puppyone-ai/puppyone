"""
Agent Config 数据仓库

定义 Agent 和 AgentAccess 的数据访问实现
"""

from typing import List, Optional

from src.agent.config.models import Agent, AgentAccess
from src.utils.id_generator import generate_uuid_v7


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
        """根据 ID 获取 Agent，包含访问权限"""
        agent = self.get_by_id(agent_id)
        if agent:
            agent.accesses = self.get_accesses_by_agent_id(agent_id)
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
        """根据用户 ID 获取 Agent 列表，包含访问权限"""
        agents = self.get_by_user_id(user_id)
        for agent in agents:
            agent.accesses = self.get_accesses_by_agent_id(agent.id)
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

    def create(
        self,
        user_id: str,
        name: str,
        icon: str = "✨",
        type: str = "chat",
        description: Optional[str] = None,
        is_default: bool = False,
    ) -> Agent:
        """创建 Agent"""
        agent_id = generate_uuid_v7()
        data = {
            "id": agent_id,
            "user_id": user_id,
            "name": name,
            "icon": icon,
            "type": type,
            "description": description,
            "is_default": is_default,
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
        """删除 Agent（会级联删除 agent_access）"""
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
    # AgentAccess CRUD
    # ============================================

    def get_accesses_by_agent_id(self, agent_id: str) -> List[AgentAccess]:
        """获取 Agent 的所有访问权限"""
        response = (
            self._client.table("agent_access")
            .select("*")
            .eq("agent_id", agent_id)
            .order("created_at")
            .execute()
        )
        return [AgentAccess(**row) for row in response.data]

    def get_access_by_id(self, access_id: str) -> Optional[AgentAccess]:
        """根据 ID 获取单个 AgentAccess"""
        response = (
            self._client.table("agent_access")
            .select("*")
            .eq("id", access_id)
            .execute()
        )
        if response.data:
            return AgentAccess(**response.data[0])
        return None

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
    ) -> AgentAccess:
        """创建 AgentAccess"""
        access_id = generate_uuid_v7()
        data = {
            "id": access_id,
            "agent_id": agent_id,
            "node_id": node_id,
            "terminal": terminal,
            "terminal_readonly": terminal_readonly,
            "can_read": can_read,
            "can_write": can_write,
            "can_delete": can_delete,
            "json_path": json_path,
        }
        response = self._client.table("agent_access").insert(data).execute()
        return AgentAccess(**response.data[0])

    def update_access(
        self,
        access_id: str,
        terminal: Optional[bool] = None,
        terminal_readonly: Optional[bool] = None,
        can_read: Optional[bool] = None,
        can_write: Optional[bool] = None,
        can_delete: Optional[bool] = None,
        json_path: Optional[str] = None,
    ) -> Optional[AgentAccess]:
        """更新 AgentAccess"""
        data = {}
        if terminal is not None:
            data["terminal"] = terminal
        if terminal_readonly is not None:
            data["terminal_readonly"] = terminal_readonly
        if can_read is not None:
            data["can_read"] = can_read
        if can_write is not None:
            data["can_write"] = can_write
        if can_delete is not None:
            data["can_delete"] = can_delete
        if json_path is not None:
            data["json_path"] = json_path

        if not data:
            return self.get_access_by_id(access_id)

        response = (
            self._client.table("agent_access")
            .update(data)
            .eq("id", access_id)
            .execute()
        )
        if response.data:
            return AgentAccess(**response.data[0])
        return None

    def delete_access(self, access_id: str) -> bool:
        """删除单个 AgentAccess"""
        response = (
            self._client.table("agent_access")
            .delete()
            .eq("id", access_id)
            .execute()
        )
        return len(response.data) > 0

    def delete_accesses_by_agent_id(self, agent_id: str) -> int:
        """删除 Agent 的所有访问权限"""
        response = (
            self._client.table("agent_access")
            .delete()
            .eq("agent_id", agent_id)
            .execute()
        )
        return len(response.data)

    def upsert_access(
        self,
        agent_id: str,
        node_id: str,
        terminal: bool = False,
        terminal_readonly: bool = True,
        can_read: bool = False,
        can_write: bool = False,
        can_delete: bool = False,
        json_path: str = "",
    ) -> AgentAccess:
        """
        Upsert AgentAccess（根据 agent_id + node_id + json_path 唯一约束）
        如果存在则更新，不存在则创建
        """
        access_id = generate_uuid_v7()
        data = {
            "id": access_id,
            "agent_id": agent_id,
            "node_id": node_id,
            "terminal": terminal,
            "terminal_readonly": terminal_readonly,
            "can_read": can_read,
            "can_write": can_write,
            "can_delete": can_delete,
            "json_path": json_path,
        }
        response = (
            self._client.table("agent_access")
            .upsert(data, on_conflict="agent_id,node_id,json_path")
            .execute()
        )
        return AgentAccess(**response.data[0])

