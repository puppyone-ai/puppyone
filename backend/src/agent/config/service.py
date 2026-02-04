"""
Agent Config Service

Agent 配置的业务逻辑层
"""

from typing import List, Optional

from src.agent.config.models import Agent, AgentBash
from src.agent.config.repository import AgentRepository
from src.agent.config.schemas import AgentAccessCreate, AgentBashCreate


class AgentConfigService:
    """Agent 配置服务"""

    def __init__(self, repository: AgentRepository = None):
        self._repo = repository or AgentRepository()

    # ============================================
    # Agent 操作
    # ============================================

    def get_agent(self, agent_id: str) -> Optional[Agent]:
        """获取 Agent"""
        return self._repo.get_by_id_with_accesses(agent_id)

    def list_agents(self, project_id: str) -> List[Agent]:
        """获取项目的 Agent 列表"""
        return self._repo.get_by_project_id_with_accesses(project_id)

    def get_default_agent(self, project_id: str) -> Optional[Agent]:
        """获取项目的默认 Agent"""
        agent = self._repo.get_default_agent(project_id)
        if agent:
            agent.bash_accesses = self._repo.get_bash_by_agent_id(agent.id)
        return agent

    def get_by_mcp_api_key(self, mcp_api_key: str) -> Optional[Agent]:
        """根据 MCP API key 获取 Agent（带 accesses）"""
        return self._repo.get_by_mcp_api_key_with_accesses(mcp_api_key)

    def verify_access(self, agent_id: str, user_id: str) -> bool:
        """验证用户是否有权限访问指定的 Agent（通过 project 检查）"""
        return self._repo.verify_access(agent_id, user_id)

    def create_agent(
        self,
        project_id: str,
        name: str,
        icon: str = "✨",
        type: str = "chat",
        description: Optional[str] = None,
        is_default: bool = False,
        accesses: List[AgentAccessCreate] = None,
        # Schedule Agent 新字段
        trigger_type: Optional[str] = "manual",
        trigger_config: Optional[dict] = None,
        task_content: Optional[str] = None,
        task_node_id: Optional[str] = None,
        external_config: Optional[dict] = None,
    ) -> Agent:
        """
        创建 Agent
        
        如果设置为默认，会先取消项目中其他默认 Agent
        """
        # 如果设置为默认，先取消其他默认
        if is_default:
            self._clear_default_agent(project_id)

        # 创建 Agent
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
            task_node_id=task_node_id,
            external_config=external_config,
        )

        # 创建访问权限（向后兼容旧的 accesses 格式）
        if accesses:
            for access in accesses:
                readonly = access.terminal_readonly if access.terminal else True
                self._repo.create_bash(
                    agent_id=agent.id,
                    node_id=access.node_id,
                    json_path=access.json_path,
                    readonly=readonly,
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
        # Schedule Agent 新字段
        trigger_type: Optional[str] = None,
        trigger_config: Optional[dict] = None,
        task_content: Optional[str] = None,
        task_node_id: Optional[str] = None,
        external_config: Optional[dict] = None,
    ) -> Optional[Agent]:
        """更新 Agent"""
        # 验证权限
        if not self._repo.verify_access(agent_id, user_id):
            return None

        # 如果设置为默认，先取消其他默认
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
            task_node_id=task_node_id,
            external_config=external_config,
        )
        if agent:
            agent.bash_accesses = self._repo.get_bash_by_agent_id(agent_id)
        return agent

    def delete_agent(self, agent_id: str, user_id: str) -> bool:
        """删除 Agent"""
        # 验证权限
        if not self._repo.verify_access(agent_id, user_id):
            return False
        return self._repo.delete(agent_id)

    def _clear_default_agent(self, project_id: str):
        """取消项目当前的默认 Agent"""
        current_default = self._repo.get_default_agent(project_id)
        if current_default:
            self._repo.update(current_default.id, is_default=False)

    # ============================================
    # AgentBash 操作 (新版)
    # ============================================

    def add_bash(
        self,
        agent_id: str,
        user_id: str,
        node_id: str,
        json_path: str = "",
        readonly: bool = True,
    ) -> Optional[AgentBash]:
        """添加 Bash 访问权限"""
        # 验证权限
        if not self._repo.verify_access(agent_id, user_id):
            return None

        return self._repo.create_bash(
            agent_id=agent_id,
            node_id=node_id,
            json_path=json_path,
            readonly=readonly,
        )

    def update_bash(
        self,
        bash_id: str,
        user_id: str,
        json_path: Optional[str] = None,
        readonly: Optional[bool] = None,
    ) -> Optional[AgentBash]:
        """更新 Bash 访问权限"""
        # 获取 bash 并验证权限
        bash = self._repo.get_bash_by_id(bash_id)
        if not bash:
            return None
        if not self._repo.verify_access(bash.agent_id, user_id):
            return None

        return self._repo.update_bash(
            bash_id=bash_id,
            json_path=json_path,
            readonly=readonly,
        )

    def remove_bash(self, bash_id: str, user_id: str) -> bool:
        """删除 Bash 访问权限"""
        # 获取 bash 并验证权限
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
        同步 Bash 访问权限（全量替换）
        
        删除旧的，创建新的
        """
        # 验证权限
        if not self._repo.verify_access(agent_id, user_id):
            return []

        # 删除旧的
        self._repo.delete_bash_by_agent_id(agent_id)

        # 创建新的
        result = []
        for bash in bash_list:
            new_bash = self._repo.create_bash(
                agent_id=agent_id,
                node_id=bash.node_id,
                json_path=bash.json_path,
                readonly=bash.readonly,
            )
            result.append(new_bash)

        return result

    # ============================================
    # 向后兼容的别名方法
    # ============================================

    def add_access(
        self,
        agent_id: str,
        user_id: str,
        node_id: str,
        terminal: bool = False,
        terminal_readonly: bool = True,
        can_read: bool = False,
        can_write: bool = False,
        can_delete: bool = False,
        json_path: str = "",
    ) -> Optional[AgentBash]:
        """添加访问权限（向后兼容）"""
        readonly = terminal_readonly if terminal else True
        return self.add_bash(agent_id, user_id, node_id, json_path, readonly)

    def update_access(
        self,
        access_id: str,
        user_id: str,
        terminal: Optional[bool] = None,
        terminal_readonly: Optional[bool] = None,
        can_read: Optional[bool] = None,
        can_write: Optional[bool] = None,
        can_delete: Optional[bool] = None,
        json_path: Optional[str] = None,
    ) -> Optional[AgentBash]:
        """更新访问权限（向后兼容）"""
        return self.update_bash(access_id, user_id, json_path, terminal_readonly)

    def remove_access(self, access_id: str, user_id: str) -> bool:
        """删除访问权限（向后兼容）"""
        return self.remove_bash(access_id, user_id)

    def sync_accesses(
        self,
        agent_id: str,
        user_id: str,
        accesses: List[AgentAccessCreate],
    ) -> List[AgentBash]:
        """同步访问权限（向后兼容）"""
        bash_list = [
            AgentBashCreate(
                node_id=a.node_id,
                json_path=a.json_path,
                readonly=a.terminal_readonly if a.terminal else True,
            )
            for a in accesses
        ]
        return self.sync_bash(agent_id, user_id, bash_list)

    # ============================================
    # Execution History
    # ============================================

    def get_execution_history(self, agent_id: str, limit: int = 10) -> List[dict]:
        """获取 Agent 的执行历史"""
        return self._repo.get_execution_history(agent_id, limit)

