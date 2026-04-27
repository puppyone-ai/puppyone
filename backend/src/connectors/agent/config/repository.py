"""
Agent Config Repository

Unified architecture: Agent data is stored in the access_points table (provider='agent').
AgentRepository is a domain view on the access_points table, specifically handling agent-type records.

Mut-Native architecture: Agent access permissions are stored in access_points.config.scope (JSONB).
The access_permissions table is no longer used for scope. Scope format:
  { "path": "docs/", "exclude": [], "mode": "rw" }
Frontend bash_accesses are derived from scope.
"""

from typing import List, Optional
from datetime import datetime, timezone
import secrets

from src.connectors.agent.config.models import Agent, AgentBash, AgentTool
from src.utils.id_generator import generate_uuid_v7


AGENT_PROVIDER = "agent"
_NOW = "now()"


def _scope_to_bash(agent_id: str, config: dict) -> list[AgentBash]:
    """Derive AgentBash list from access_points.config.scope (Mut-Native)."""
    scope = config.get("scope")
    if not scope:
        return []
    if scope.get("_orphaned_from"):
        return []
    path = scope.get("path", "")
    if not path:
        return []
    mode = scope.get("mode", "r")
    return [AgentBash(
        id=f"{agent_id}:scope",
        agent_id=agent_id,
        path=path,
        readonly=(mode == "r"),
        created_at=datetime.now(timezone.utc),
    )]


def _row_to_tool(row: dict) -> AgentTool:
    """Map access_tools DB row to AgentTool model."""
    return AgentTool(
        id=row["id"],
        agent_id=row.get("access_point_id", row.get("access_point_id", row.get("agent_id", ""))),
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
        task_path=config.get("task_path"),
        external_config=config.get("external_config"),
        llm_model=config.get("llm_model"),
        system_prompt=config.get("system_prompt"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _merge_agent_updates(
    config: dict, trigger: dict, **kwargs,
) -> tuple[dict, dict]:
    """Merge non-None update fields into config and trigger dicts."""
    # Simple config fields (set directly if not None)
    _simple_keys = (
        "name", "icon", "type", "description", "is_default",
        "task_content", "task_path", "external_config",
    )
    for key in _simple_keys:
        val = kwargs.get(key)
        if val is not None:
            config[key] = val

    # Fields that clear to None on empty string
    for key in ("llm_model", "system_prompt"):
        val = kwargs.get(key)
        if val is not None:
            config[key] = val if val != "" else None

    # Trigger fields
    if kwargs.get("trigger_type") is not None:
        trigger["type"] = kwargs["trigger_type"]
    if kwargs.get("trigger_config") is not None:
        trigger["config"] = kwargs["trigger_config"]

    return config, trigger


class AgentRepository:
    """Agent repository -- reads/writes the access_points table (provider='agent')."""

    TABLE = "access_points"

    def __init__(self, supabase_client=None):
        if supabase_client is None:
            from src.infra.supabase.dependencies import get_supabase_client
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
        response = (
            self._query()
            .eq("id", agent_id)
            .execute()
        )
        if not response.data:
            return None
        row = response.data[0]
        agent = _row_to_agent(row)
        agent.bash_accesses = _scope_to_bash(agent_id, row.get("config") or {})
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

    def get_by_project_id_with_accesses(
        self, project_id: str, viewer_user_id: Optional[str] = None,
    ) -> List[Agent]:
        """Load agents with scope-derived bash_accesses and tool bindings.

        Visibility filter (security: M-1):
        Agents whose config.visibility == 'private' are only returned if
        viewer_user_id matches the agent's owner (access_points.user_id).
        Pass viewer_user_id=None for internal callers that already gated
        access; pass the JWT user id from request handlers.
        """
        response = (
            self._query()
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .execute()
        )
        rows = response.data or []

        if viewer_user_id is not None:
            rows = [
                r for r in rows
                if (r.get("config") or {}).get("visibility", "org").lower() != "private"
                or r.get("user_id") == viewer_user_id
            ]

        agents = [_row_to_agent(row) for row in rows]
        if not agents:
            return agents

        agent_ids = [a.id for a in agents]

        # Derive bash_accesses from connections.config.scope
        config_by_id = {row["id"]: (row.get("config") or {}) for row in rows}
        bash_by_agent: dict[str, list[AgentBash]] = {}
        for aid, cfg in config_by_id.items():
            bash_by_agent[aid] = _scope_to_bash(aid, cfg)

        all_tools = (
            self._client.table("access_tools")
            .select("*")
            .in_("access_point_id", agent_ids)
            .order("created_at")
            .execute()
        ).data
        tools_by_agent: dict[str, list[AgentTool]] = {}
        for row in all_tools:
            cid = row.get("access_point_id", row.get("access_point_id", ""))
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
        response = (
            self._query()
            .eq("access_key", mcp_api_key)
            .execute()
        )
        if not response.data:
            return None
        row = response.data[0]
        agent = _row_to_agent(row)
        agent.bash_accesses = _scope_to_bash(agent.id, row.get("config") or {})
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
        task_path: Optional[str] = None,
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
            "task_path": task_path,
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
            "path": task_path,  # nullable
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
        task_path: Optional[str] = None,
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

        config, trigger = _merge_agent_updates(
            config, trigger,
            name=name, icon=icon, type=type, description=description,
            is_default=is_default, task_content=task_content,
            task_path=task_path, external_config=external_config,
            llm_model=llm_model, system_prompt=system_prompt,
            trigger_type=trigger_type, trigger_config=trigger_config,
        )

        update_data: dict = {
            "config": config, "trigger": trigger, "updated_at": _NOW,
        }
        if mcp_api_key is not None:
            update_data["access_key"] = mcp_api_key
        if task_path is not None:
            update_data["path"] = task_path

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
        """Check whether `user_id` is allowed to access agent `agent_id`.

        Two layers of checks (security: M-1):
        1. Project membership — user must belong to the agent's project's org.
        2. Visibility — if agent is marked private (config.visibility == 'private'),
           only the agent's owner (access_points.user_id) may read it.

        Defaults to org-visibility when the field is missing (backward compatible
        with rows that pre-date the visibility flag).
        """
        # Pull both the row and the agent in one go to avoid N queries.
        row_resp = (
            self._client.table(self.TABLE)
            .select("id, project_id, config, user_id")
            .eq("id", agent_id)
            .eq("provider", AGENT_PROVIDER)
            .limit(1)
            .execute()
        )
        if not row_resp.data:
            return False
        row = row_resp.data[0]
        config = row.get("config") or {}
        project_id = row.get("project_id")

        # Layer 1: org membership
        proj_resp = (
            self._client.table("projects")
            .select("org_id")
            .eq("id", project_id)
            .execute()
        )
        if not proj_resp.data:
            return False
        org_id = proj_resp.data[0].get("org_id")
        if not org_id:
            return False
        from src.platform.organization.repository import OrganizationRepository
        org_repo = OrganizationRepository(supabase_client=self._client)
        member = org_repo.get_member(org_id, user_id)
        if member is None:
            return False

        # Layer 2: visibility
        visibility = (config.get("visibility") or "org").lower()
        if visibility == "private":
            owner = row.get("user_id")
            if owner and owner != user_id:
                return False
        return True

    # ============================================
    # AgentBash CRUD — operates on access_points.config.scope (JSONB)
    # ============================================

    def _get_agent_config(self, agent_id: str) -> Optional[dict]:
        """Read raw config JSONB for an agent."""
        resp = (
            self._client.table(self.TABLE)
            .select("config")
            .eq("id", agent_id)
            .execute()
        )
        if resp.data:
            return resp.data[0].get("config") or {}
        return None

    def _update_scope(self, agent_id: str, scope: dict) -> None:
        """Write scope back into access_points.config.scope."""
        config = self._get_agent_config(agent_id)
        if config is None:
            return
        config["scope"] = scope
        self._client.table(self.TABLE).update(
            {"config": config, "updated_at": _NOW}
        ).eq("id", agent_id).execute()

    def get_bash_by_agent_id(self, agent_id: str) -> List[AgentBash]:
        config = self._get_agent_config(agent_id)
        if config is None:
            return []
        return _scope_to_bash(agent_id, config)

    def get_bash_by_id(self, bash_id: str) -> Optional[AgentBash]:
        agent_id = bash_id.split(":")[0] if ":" in bash_id else bash_id
        accesses = self.get_bash_by_agent_id(agent_id)
        for a in accesses:
            if a.id == bash_id:
                return a
        return None

    def create_bash(
        self,
        agent_id: str,
        path: str,
        readonly: bool = True,
    ) -> AgentBash:
        scope = {
            "path": path,
            "exclude": [],
            "mode": "r" if readonly else "rw",
        }
        self._update_scope(agent_id, scope)
        return AgentBash(
            id=f"{agent_id}:scope",
            agent_id=agent_id,
            path=path,
            readonly=readonly,
            created_at=datetime.now(timezone.utc),
        )

    def update_bash(
        self,
        bash_id: str,
        readonly: Optional[bool] = None,
    ) -> Optional[AgentBash]:
        agent_id = bash_id.split(":")[0] if ":" in bash_id else bash_id
        config = self._get_agent_config(agent_id)
        if config is None:
            return None
        scope = config.get("scope", {})
        if readonly is not None:
            scope["mode"] = "r" if readonly else "rw"
        self._update_scope(agent_id, scope)
        return self.get_bash_by_id(bash_id)

    def delete_bash(self, bash_id: str) -> bool:
        agent_id = bash_id.split(":")[0] if ":" in bash_id else bash_id
        config = self._get_agent_config(agent_id)
        if config is None:
            return False
        if "scope" in config:
            del config["scope"]
            self._client.table(self.TABLE).update(
                {"config": config, "updated_at": _NOW}
            ).eq("id", agent_id).execute()
        return True

    def delete_bash_by_agent_id(self, agent_id: str) -> int:
        if self.delete_bash(f"{agent_id}:scope"):
            return 1
        return 0

    def upsert_bash(
        self,
        agent_id: str,
        path: str,
        readonly: bool = True,
    ) -> AgentBash:
        return self.create_bash(agent_id, path, readonly)

    # ============================================
    # AgentTool CRUD
    # ============================================

    def get_tools_by_agent_id(self, agent_id: str) -> List[AgentTool]:
        response = (
            self._client.table("access_tools")
            .select("*")
            .eq("access_point_id", agent_id)
            .order("created_at")
            .execute()
        )
        return [_row_to_tool(row) for row in response.data]

    def get_tools_by_agent_id_for_mcp(self, agent_id: str) -> List[AgentTool]:
        response = (
            self._client.table("access_tools")
            .select("*")
            .eq("access_point_id", agent_id)
            .eq("enabled", True)
            .eq("mcp_exposed", True)
            .order("created_at")
            .execute()
        )
        return [_row_to_tool(row) for row in response.data]

    def get_tool_binding_by_id(self, binding_id: str) -> Optional[AgentTool]:
        response = (
            self._client.table("access_tools")
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
            "access_point_id": agent_id,
            "tool_id": tool_id,
            "enabled": enabled,
            "mcp_exposed": mcp_exposed,
        }
        response = self._client.table("access_tools").insert(data).execute()
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
            self._client.table("access_tools")
            .update(data)
            .eq("id", binding_id)
            .execute()
        )
        if response.data:
            return _row_to_tool(response.data[0])
        return None

    def delete_tool_binding(self, binding_id: str) -> bool:
        response = (
            self._client.table("access_tools")
            .delete()
            .eq("id", binding_id)
            .execute()
        )
        return len(response.data) > 0

    def delete_tools_by_agent_id(self, agent_id: str) -> int:
        response = (
            self._client.table("access_tools")
            .delete()
            .eq("access_point_id", agent_id)
            .execute()
        )
        return len(response.data)

    def get_tool_binding_by_agent_and_tool(
        self, agent_id: str, tool_id: str
    ) -> Optional[AgentTool]:
        response = (
            self._client.table("access_tools")
            .select("*")
            .eq("access_point_id", agent_id)
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
            "access_point_id": agent_id,
            "tool_id": tool_id,
            "enabled": enabled,
            "mcp_exposed": mcp_exposed,
        }
        response = (
            self._client.table("access_tools")
            .upsert(data, on_conflict="access_point_id,tool_id")
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
