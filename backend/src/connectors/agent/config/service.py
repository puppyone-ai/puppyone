"""
Agent Config Service

Business logic layer for Agent configuration.
"""

from typing import List, Optional

from src.connectors.agent.config.models import Agent, AgentBash
from src.connectors.agent.config.repository import AgentRepository
from src.connectors.agent.config.schemas import AgentBashCreate


class AgentConfigService:
    """Agent configuration service."""

    def __init__(self, repository: AgentRepository = None):
        self._repo = repository or AgentRepository()

    # ============================================
    # Agent Operations
    # ============================================

    def get_agent(self, agent_id: str) -> Optional[Agent]:
        """Get an Agent."""
        return self._repo.get_by_id_with_accesses(agent_id)

    def list_agents(
        self, project_id: str, viewer_user_id: Optional[str] = None,
    ) -> List[Agent]:
        """Get the list of Agents for a project.

        viewer_user_id: pass the JWT user id so private agents owned by other
        users are filtered out (security: M-1 visibility). Pass None when
        called from an internal context that already gated by other means.
        """
        return self._repo.get_by_project_id_with_accesses(
            project_id, viewer_user_id=viewer_user_id,
        )

    def get_default_agent(self, project_id: str) -> Optional[Agent]:
        """Get the default Agent for a project."""
        agent = self._repo.get_default_agent(project_id)
        if agent:
            agent.bash_accesses = self._repo.get_bash_by_agent_id(agent.id)
        return agent

    def get_by_mcp_api_key(self, mcp_api_key: str) -> Optional[Agent]:
        """Get Agent by MCP API key (with accesses)."""
        return self._repo.get_by_mcp_api_key_with_accesses(mcp_api_key)

    def verify_access(self, agent_id: str, user_id: str) -> bool:
        """Verify whether the user has permission to access the specified Agent (via project check)."""
        return self._repo.verify_access(agent_id, user_id)

    def create_agent(
        self,
        project_id: str,
        name: str,
        icon: str = "✨",
        type: str = "chat",
        description: Optional[str] = None,
        is_default: bool = False,
        bash_accesses: Optional[List[AgentBashCreate]] = None,
        trigger_type: Optional[str] = "manual",
        trigger_config: Optional[dict] = None,
        task_content: Optional[str] = None,
        task_path: Optional[str] = None,
        external_config: Optional[dict] = None,
    ) -> Agent:
        if is_default:
            self._clear_default_agent(project_id)

        agent = self._repo.create(
            project_id=project_id,
            name=name,
            icon=icon,
            type=type,
            description=description,
            is_default=is_default,
            trigger_type=trigger_type,
            trigger_config=trigger_config,
            task_content=task_content,
            task_path=task_path,
            external_config=external_config,
        )

        if bash_accesses:
            for ba in bash_accesses:
                self._repo.create_bash(
                    agent_id=agent.id,
                    path=ba.path,
                    readonly=ba.readonly,
                )
            agent.bash_accesses = self._repo.get_bash_by_agent_id(agent.id)

        return agent

    def update_agent(
        self,
        agent_id: str,
        user_id: str,
        name: Optional[str] = None,
        icon: Optional[str] = None,
        type: Optional[str] = None,
        description: Optional[str] = None,
        is_default: Optional[bool] = None,
        # Schedule Agent new fields
        trigger_type: Optional[str] = None,
        trigger_config: Optional[dict] = None,
        task_content: Optional[str] = None,
        task_path: Optional[str] = None,
        external_config: Optional[dict] = None,
    ) -> Optional[Agent]:
        """Update an Agent."""
        # Verify access
        if not self._repo.verify_access(agent_id, user_id):
            return None

        # If setting as default, clear other defaults first
        if is_default:
            self._clear_default_agent(user_id)

        agent = self._repo.update(
            agent_id=agent_id,
            name=name,
            icon=icon,
            type=type,
            description=description,
            is_default=is_default,
            trigger_type=trigger_type,
            trigger_config=trigger_config,
            task_content=task_content,
            task_path=task_path,
            external_config=external_config,
        )
        if agent:
            agent.bash_accesses = self._repo.get_bash_by_agent_id(agent_id)
        return agent

    def delete_agent(self, agent_id: str, user_id: str) -> bool:
        """Delete an Agent."""
        # Verify access
        if not self._repo.verify_access(agent_id, user_id):
            return False
        return self._repo.delete(agent_id)

    def _clear_default_agent(self, project_id: str):
        """Clear the current default Agent for the project."""
        current_default = self._repo.get_default_agent(project_id)
        if current_default:
            self._repo.update(current_default.id, is_default=False)

    # ============================================
    # AgentBash Operations (new version)
    # ============================================

    def add_bash(
        self,
        agent_id: str,
        user_id: str,
        path: str,
        readonly: bool = True,
    ) -> Optional[AgentBash]:
        """Add Bash access permission."""
        if not self._repo.verify_access(agent_id, user_id):
            return None

        return self._repo.create_bash(
            agent_id=agent_id,
            path=path,
            readonly=readonly,
        )

    def update_bash(
        self,
        bash_id: str,
        user_id: str,
        readonly: Optional[bool] = None,
    ) -> Optional[AgentBash]:
        """Update Bash access permission."""
        bash = self._repo.get_bash_by_id(bash_id)
        if not bash:
            return None
        if not self._repo.verify_access(bash.agent_id, user_id):
            return None

        return self._repo.update_bash(
            bash_id=bash_id,
            readonly=readonly,
        )

    def remove_bash(self, bash_id: str, user_id: str) -> bool:
        """Delete Bash access permission."""
        # Get bash and verify access
        bash = self._repo.get_bash_by_id(bash_id)
        if not bash:
            return False
        if not self._repo.verify_access(bash.agent_id, user_id):
            return False

        return self._repo.delete_bash(bash_id)

    def sync_bash(
        self,
        agent_id: str,
        user_id: str,
        bash_list: List[AgentBashCreate],
    ) -> List[AgentBash]:
        """
        Sync Bash access permissions (full replacement).

        Delete old ones, create new ones.
        """
        # Verify access
        if not self._repo.verify_access(agent_id, user_id):
            return []

        # Delete old ones
        self._repo.delete_bash_by_agent_id(agent_id)

        # Create new ones
        result = []
        for bash in bash_list:
            new_bash = self._repo.create_bash(
                agent_id=agent_id,
                path=bash.path,
                readonly=bash.readonly,
            )
            result.append(new_bash)

        return result

    # ============================================
    # Execution History
    # ============================================

    def get_execution_history(self, agent_id: str, limit: int = 10) -> List[dict]:
        """Get execution history for an Agent."""
        return self._repo.get_execution_history(agent_id, limit)
