"""
Agent Config 数据仓库

统一架构：Agent 数据存储在 connections 表中 (provider='agent')。
AgentRepository 是 connections 表上的一个领域视图，专门处理 agent 类型的记录。
connection_access / connection_tool 为共享权限表，FK 指向 connections.id。
"""

from typing import List, Optional
import secrets

from src.agent.config.models import Agent, AgentBash, AgentTool
from src.utils.id_generator import generate_uuid_v7


AGENT_PROVIDER = "agent"


def _row_to_bash(row: dict) -> AgentBash:
    """Map connection_access DB row to AgentBash model."""
    permission = row.get("permission", "r")
    return AgentBash(
        id=row["id"],
        agent_id=row.get("connection_id", row.get("agent_id", "")),
        node_id=row["node_id"],
        json_path=row.get("json_path", ""),
        readonly=(permission == "r"),
        created_at=row["created_at"],
    )


def _row_to_tool(row: dict) -> AgentTool:
    """Map connection_tool DB row to AgentTool model."""
    return AgentTool(
        id=row["id"],
        agent_id=row.get("connection_id", row.get("agent_id", "")),
        tool_id=row["tool_id"],
        enabled=row.get("enabled", True),
        mcp_exposed=row.get("mcp_exposed", False),
        created_at=row["created_at"],
    )


def generate_access_key(agent_type: str = "chat") -> str:
    prefix = "cli" if agent_type == "devbox" else "mcp"
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def generate_mcp_api_key() -> str:
    return generate_access_key("chat")


def _row_to_agent(row: dict) -> Agent:
    """Convert a syncs row to an Agent model."""
    config = row.get("config") or {}
    trigger = row.get("trigger") or {}
    return Agent(
        id=row["id"],
        project_id=row["project_id"],
        name=config.get("name", ""),
        icon=config.get("icon", "✨"),
        type=config.get("type", "chat"),
        description=config.get("description"),
        is_default=config.get("is_default", False),
        mcp_api_key=row.get("access_key"),
        trigger_type=trigger.get("type", "manual"),
        trigger_config=trigger.get("config"),
        task_content=config.get("task_content"),
        task_node_id=config.get("task_node_id"),
        external_config=config.get("external_config"),
        llm_model=config.get("llm_model"),
        system_prompt=config.get("system_prompt"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class AgentRepository:
    """Agent 数据仓库 — 读写 connections 表 (provider='agent')"""

    TABLE = "connections"

    def __init__(self, supabase_client=None):
        if supabase_client is None:
            from src.supabase.dependencies import get_supabase_client
            self._client = get_supabase_client()
        else:
            self._client = supabase_client

    def _query(self):
        return self._client.table(self.TABLE).select("*").eq("provider", AGENT_PROVIDER)

    # ============================================
    # Agent CRUD
    # ============================================

    def get_by_id(self, agent_id: str) -> Optional[Agent]:
        response = (
            self._query()
            .eq("id", agent_id)
            .execute()
        )
        if response.data:
            return _row_to_agent(response.data[0])
        return None

    def get_by_id_with_accesses(self, agent_id: str) -> Optional[Agent]:
        agent = self.get_by_id(agent_id)
        if agent:
            agent.bash_accesses = self.get_bash_by_agent_id(agent_id)
            agent.tools = self.get_tools_by_agent_id(agent_id)
        return agent

    def get_by_project_id(self, project_id: str) -> List[Agent]:
        response = (
            self._query()
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .execute()
        )
        return [_row_to_agent(row) for row in response.data]

    def get_by_project_id_with_accesses(self, project_id: str) -> List[Agent]:
        agents = self.get_by_project_id(project_id)
        if not agents:
            return agents

        agent_ids = [a.id for a in agents]

        all_bash = (
            self._client.table("connection_accesses")
            .select("*")
            .in_("connection_id", agent_ids)
            .order("created_at")
            .execute()
        ).data
        bash_by_agent: dict[str, list[AgentBash]] = {}
        for row in all_bash:
            cid = row.get("connection_id", "")
            bash_by_agent.setdefault(cid, []).append(_row_to_bash(row))

        all_tools = (
            self._client.table("connection_tools")
            .select("*")
            .in_("connection_id", agent_ids)
            .order("created_at")
            .execute()
        ).data
        tools_by_agent: dict[str, list[AgentTool]] = {}
        for row in all_tools:
            cid = row.get("connection_id", "")
            tools_by_agent.setdefault(cid, []).append(_row_to_tool(row))

        for agent in agents:
            agent.bash_accesses = bash_by_agent.get(agent.id, [])
            agent.tools = tools_by_agent.get(agent.id, [])

        return agents

    def get_default_agent(self, project_id: str) -> Optional[Agent]:
        response = (
            self._query()
            .eq("project_id", project_id)
            .execute()
        )
        for row in response.data:
            config = row.get("config") or {}
            if config.get("is_default"):
                return _row_to_agent(row)
        return None

    def get_by_mcp_api_key(self, mcp_api_key: str) -> Optional[Agent]:
        response = (
            self._query()
            .eq("access_key", mcp_api_key)
            .execute()
        )
        if response.data:
            return _row_to_agent(response.data[0])
        return None

    def get_by_mcp_api_key_with_accesses(self, mcp_api_key: str) -> Optional[Agent]:
        agent = self.get_by_mcp_api_key(mcp_api_key)
        if agent:
            agent.bash_accesses = self.get_bash_by_agent_id(agent.id)
            agent.tools = self.get_tools_by_agent_id_for_mcp(agent.id)
        return agent

    def create(
        self,
        project_id: str,
        name: str,
        icon: str = "✨",
        type: str = "chat",
        description: Optional[str] = None,
        is_default: bool = False,
        trigger_type: Optional[str] = "manual",
        trigger_config: Optional[dict] = None,
        task_content: Optional[str] = None,
        task_node_id: Optional[str] = None,
        external_config: Optional[dict] = None,
        llm_model: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> Agent:
        agent_id = generate_uuid_v7()
        access_key = generate_access_key(type)

        config = {
            "name": name,
            "icon": icon,
            "type": type,
            "description": description,
            "is_default": is_default,
            "task_content": task_content,
            "task_node_id": task_node_id,
            "external_config": external_config,
            "llm_model": llm_model,
            "system_prompt": system_prompt,
        }
        trigger = {
            "type": trigger_type or "manual",
            "config": trigger_config,
        }

        data = {
            "id": agent_id,
            "project_id": project_id,
            "node_id": task_node_id,  # nullable
            "direction": "bidirectional",
            "provider": AGENT_PROVIDER,
            "config": config,
            "access_key": access_key,
            "trigger": trigger,
            "status": "active",
        }
        response = self._client.table(self.TABLE).insert(data).execute()
        return _row_to_agent(response.data[0])

    def update(
        self,
        agent_id: str,
        name: Optional[str] = None,
        icon: Optional[str] = None,
        type: Optional[str] = None,
        description: Optional[str] = None,
        is_default: Optional[bool] = None,
        mcp_api_key: Optional[str] = None,
        trigger_type: Optional[str] = None,
        trigger_config: Optional[dict] = None,
        task_content: Optional[str] = None,
        task_node_id: Optional[str] = None,
        external_config: Optional[dict] = None,
        llm_model: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> Optional[Agent]:
        current = self.get_by_id(agent_id)
        if not current:
            return None

        # Rebuild config JSONB by merging updates
        response = (
            self._client.table(self.TABLE)
            .select("config, trigger")
            .eq("id", agent_id)
            .execute()
        )
        if not response.data:
            return None

        config = dict(response.data[0].get("config") or {})
        trigger = dict(response.data[0].get("trigger") or {})

        if name is not None:
            config["name"] = name
        if icon is not None:
            config["icon"] = icon
        if type is not None:
            config["type"] = type
        if description is not None:
            config["description"] = description
        if is_default is not None:
            config["is_default"] = is_default
        if task_content is not None:
            config["task_content"] = task_content
        if task_node_id is not None:
            config["task_node_id"] = task_node_id
        if external_config is not None:
            config["external_config"] = external_config
        if llm_model is not None:
            config["llm_model"] = llm_model if llm_model != "" else None
        if system_prompt is not None:
            config["system_prompt"] = system_prompt if system_prompt != "" else None
        if trigger_type is not None:
            trigger["type"] = trigger_type
        if trigger_config is not None:
            trigger["config"] = trigger_config

        update_data: dict = {
            "config": config,
            "trigger": trigger,
            "updated_at": "now()",
        }
        if mcp_api_key is not None:
            update_data["access_key"] = mcp_api_key
        if task_node_id is not None:
            update_data["node_id"] = task_node_id

        resp = (
            self._client.table(self.TABLE)
            .update(update_data)
            .eq("id", agent_id)
            .execute()
        )
        if resp.data:
            return _row_to_agent(resp.data[0])
        return None

    def delete(self, agent_id: str) -> bool:
        response = (
            self._client.table(self.TABLE)
            .delete()
            .eq("id", agent_id)
            .eq("provider", AGENT_PROVIDER)
            .execute()
        )
        return len(response.data) > 0

    def verify_access(self, agent_id: str, user_id: str) -> bool:
        agent = self.get_by_id(agent_id)
        if not agent:
            return False
        response = (
            self._client.table("projects")
            .select("org_id")
            .eq("id", agent.project_id)
            .execute()
        )
        if not response.data:
            return False
        org_id = response.data[0].get("org_id")
        if not org_id:
            return False
        from src.organization.repository import OrganizationRepository
        org_repo = OrganizationRepository(supabase_client=self._client)
        member = org_repo.get_member(org_id, user_id)
        return member is not None

    # ============================================
    # AgentBash CRUD
    # ============================================

    def get_bash_by_agent_id(self, agent_id: str) -> List[AgentBash]:
        response = (
            self._client.table("connection_accesses")
            .select("*")
            .eq("connection_id", agent_id)
            .order("created_at")
            .execute()
        )
        return [_row_to_bash(row) for row in response.data]

    def get_bash_by_id(self, bash_id: str) -> Optional[AgentBash]:
        response = (
            self._client.table("connection_accesses")
            .select("*")
            .eq("id", bash_id)
            .execute()
        )
        if response.data:
            return _row_to_bash(response.data[0])
        return None

    def create_bash(
        self,
        agent_id: str,
        node_id: str,
        json_path: str = "",
        readonly: bool = True,
    ) -> AgentBash:
        bash_id = generate_uuid_v7()
        data = {
            "id": bash_id,
            "connection_id": agent_id,
            "node_id": node_id,
            "json_path": json_path,
            "permission": "r" if readonly else "rw",
        }
        response = self._client.table("connection_accesses").insert(data).execute()
        return _row_to_bash(response.data[0])

    def update_bash(
        self,
        bash_id: str,
        json_path: Optional[str] = None,
        readonly: Optional[bool] = None,
    ) -> Optional[AgentBash]:
        data = {}
        if json_path is not None:
            data["json_path"] = json_path
        if readonly is not None:
            data["permission"] = "r" if readonly else "rw"
        if not data:
            return self.get_bash_by_id(bash_id)

        response = (
            self._client.table("connection_accesses")
            .update(data)
            .eq("id", bash_id)
            .execute()
        )
        if response.data:
            return _row_to_bash(response.data[0])
        return None

    def delete_bash(self, bash_id: str) -> bool:
        response = (
            self._client.table("connection_accesses")
            .delete()
            .eq("id", bash_id)
            .execute()
        )
        return len(response.data) > 0

    def delete_bash_by_agent_id(self, agent_id: str) -> int:
        response = (
            self._client.table("connection_accesses")
            .delete()
            .eq("connection_id", agent_id)
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
        bash_id = generate_uuid_v7()
        data = {
            "id": bash_id,
            "connection_id": agent_id,
            "node_id": node_id,
            "json_path": json_path,
            "permission": "r" if readonly else "rw",
        }
        response = (
            self._client.table("connection_accesses")
            .upsert(data, on_conflict="connection_id,node_id,json_path")
            .execute()
        )
        return _row_to_bash(response.data[0])

    # ============================================
    # Backward-compatible aliases
    # ============================================

    def get_accesses_by_agent_id(self, agent_id: str) -> List[AgentBash]:
        return self.get_bash_by_agent_id(agent_id)

    def get_access_by_id(self, access_id: str) -> Optional[AgentBash]:
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
        readonly = terminal_readonly
        return self.update_bash(access_id, json_path, readonly)

    def delete_access(self, access_id: str) -> bool:
        return self.delete_bash(access_id)

    def delete_accesses_by_agent_id(self, agent_id: str) -> int:
        return self.delete_bash_by_agent_id(agent_id)

    # ============================================
    # AgentTool CRUD
    # ============================================

    def get_tools_by_agent_id(self, agent_id: str) -> List[AgentTool]:
        response = (
            self._client.table("connection_tools")
            .select("*")
            .eq("connection_id", agent_id)
            .order("created_at")
            .execute()
        )
        return [_row_to_tool(row) for row in response.data]

    def get_tools_by_agent_id_for_mcp(self, agent_id: str) -> List[AgentTool]:
        response = (
            self._client.table("connection_tools")
            .select("*")
            .eq("connection_id", agent_id)
            .eq("enabled", True)
            .eq("mcp_exposed", True)
            .order("created_at")
            .execute()
        )
        return [_row_to_tool(row) for row in response.data]

    def get_tool_binding_by_id(self, binding_id: str) -> Optional[AgentTool]:
        response = (
            self._client.table("connection_tools")
            .select("*")
            .eq("id", binding_id)
            .execute()
        )
        if response.data:
            return _row_to_tool(response.data[0])
        return None

    def create_tool_binding(
        self,
        agent_id: str,
        tool_id: str,
        enabled: bool = True,
        mcp_exposed: bool = False,
    ) -> AgentTool:
        binding_id = generate_uuid_v7()
        data = {
            "id": binding_id,
            "connection_id": agent_id,
            "tool_id": tool_id,
            "enabled": enabled,
            "mcp_exposed": mcp_exposed,
        }
        response = self._client.table("connection_tools").insert(data).execute()
        return _row_to_tool(response.data[0])

    def update_tool_binding(
        self,
        binding_id: str,
        enabled: Optional[bool] = None,
        mcp_exposed: Optional[bool] = None,
    ) -> Optional[AgentTool]:
        data = {}
        if enabled is not None:
            data["enabled"] = enabled
        if mcp_exposed is not None:
            data["mcp_exposed"] = mcp_exposed
        if not data:
            return self.get_tool_binding_by_id(binding_id)

        response = (
            self._client.table("connection_tools")
            .update(data)
            .eq("id", binding_id)
            .execute()
        )
        if response.data:
            return _row_to_tool(response.data[0])
        return None

    def delete_tool_binding(self, binding_id: str) -> bool:
        response = (
            self._client.table("connection_tools")
            .delete()
            .eq("id", binding_id)
            .execute()
        )
        return len(response.data) > 0

    def delete_tools_by_agent_id(self, agent_id: str) -> int:
        response = (
            self._client.table("connection_tools")
            .delete()
            .eq("connection_id", agent_id)
            .execute()
        )
        return len(response.data)

    def get_tool_binding_by_agent_and_tool(
        self, agent_id: str, tool_id: str
    ) -> Optional[AgentTool]:
        response = (
            self._client.table("connection_tools")
            .select("*")
            .eq("connection_id", agent_id)
            .eq("tool_id", tool_id)
            .execute()
        )
        if response.data:
            return _row_to_tool(response.data[0])
        return None

    def upsert_tool_binding(
        self,
        agent_id: str,
        tool_id: str,
        enabled: bool = True,
        mcp_exposed: bool = False,
    ) -> AgentTool:
        binding_id = generate_uuid_v7()
        data = {
            "id": binding_id,
            "connection_id": agent_id,
            "tool_id": tool_id,
            "enabled": enabled,
            "mcp_exposed": mcp_exposed,
        }
        response = (
            self._client.table("connection_tools")
            .upsert(data, on_conflict="connection_id,tool_id")
            .execute()
        )
        return _row_to_tool(response.data[0])

    # ============================================
    # Execution History
    # ============================================

    def get_execution_history(self, agent_id: str, limit: int = 10) -> list[dict]:
        response = (
            self._client.table("agent_execution_logs")
            .select("*")
            .eq("agent_id", agent_id)
            .order("started_at", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []
