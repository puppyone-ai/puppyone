"""
Agent Config Service

Agent 配置的业务逻辑层
"""

from typing import List, Optional

from src.agent.config.models import Agent, AgentAccess
from src.agent.config.repository import AgentRepository
from src.agent.config.schemas import AgentAccessCreate


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

    def list_agents(self, user_id: str) -> List[Agent]:
        """获取用户的所有 Agent"""
        return self._repo.get_by_user_id_with_accesses(user_id)

    def get_default_agent(self, user_id: str) -> Optional[Agent]:
        """获取用户的默认 Agent"""
        agent = self._repo.get_default_agent(user_id)
        if agent:
            agent.accesses = self._repo.get_accesses_by_agent_id(agent.id)
        return agent

    def create_agent(
        self,
        user_id: str,
        name: str,
        icon: str = "✨",
        type: str = "chat",
        description: Optional[str] = None,
        is_default: bool = False,
        accesses: List[AgentAccessCreate] = None,
    ) -> Agent:
        """
        创建 Agent
        
        如果设置为默认，会先取消其他默认 Agent
        """
        # 如果设置为默认，先取消其他默认
        if is_default:
            self._clear_default_agent(user_id)

        # 创建 Agent
        agent = self._repo.create(
            user_id=user_id,
            name=name,
            icon=icon,
            type=type,
            description=description,
            is_default=is_default,
        )

        # 创建访问权限
        if accesses:
            for access in accesses:
                self._repo.create_access(
                    agent_id=agent.id,
                    node_id=access.node_id,
                    terminal=access.terminal,
                    terminal_readonly=access.terminal_readonly,
                    can_read=access.can_read,
                    can_write=access.can_write,
                    can_delete=access.can_delete,
                    json_path=access.json_path,
                )
            agent.accesses = self._repo.get_accesses_by_agent_id(agent.id)

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
        )
        if agent:
            agent.accesses = self._repo.get_accesses_by_agent_id(agent_id)
        return agent

    def delete_agent(self, agent_id: str, user_id: str) -> bool:
        """删除 Agent"""
        # 验证权限
        if not self._repo.verify_access(agent_id, user_id):
            return False
        return self._repo.delete(agent_id)

    def _clear_default_agent(self, user_id: str):
        """取消用户当前的默认 Agent"""
        current_default = self._repo.get_default_agent(user_id)
        if current_default:
            self._repo.update(current_default.id, is_default=False)

    # ============================================
    # AgentAccess 操作
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
    ) -> Optional[AgentAccess]:
        """添加访问权限"""
        # 验证权限
        if not self._repo.verify_access(agent_id, user_id):
            return None

        return self._repo.create_access(
            agent_id=agent_id,
            node_id=node_id,
            terminal=terminal,
            terminal_readonly=terminal_readonly,
            can_read=can_read,
            can_write=can_write,
            can_delete=can_delete,
            json_path=json_path,
        )

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
    ) -> Optional[AgentAccess]:
        """更新访问权限"""
        # 获取 access 并验证权限
        access = self._repo.get_access_by_id(access_id)
        if not access:
            return None
        if not self._repo.verify_access(access.agent_id, user_id):
            return None

        return self._repo.update_access(
            access_id=access_id,
            terminal=terminal,
            terminal_readonly=terminal_readonly,
            can_read=can_read,
            can_write=can_write,
            can_delete=can_delete,
            json_path=json_path,
        )

    def remove_access(self, access_id: str, user_id: str) -> bool:
        """删除访问权限"""
        # 获取 access 并验证权限
        access = self._repo.get_access_by_id(access_id)
        if not access:
            return False
        if not self._repo.verify_access(access.agent_id, user_id):
            return False

        return self._repo.delete_access(access_id)

    def sync_accesses(
        self,
        agent_id: str,
        user_id: str,
        accesses: List[AgentAccessCreate],
    ) -> List[AgentAccess]:
        """
        同步访问权限（全量替换）
        
        删除旧的，创建新的
        """
        # 验证权限
        if not self._repo.verify_access(agent_id, user_id):
            return []

        # 删除旧的
        self._repo.delete_accesses_by_agent_id(agent_id)

        # 创建新的
        result = []
        for access in accesses:
            new_access = self._repo.create_access(
                agent_id=agent_id,
                node_id=access.node_id,
                terminal=access.terminal,
                terminal_readonly=access.terminal_readonly,
                can_read=access.can_read,
                can_write=access.can_write,
                can_delete=access.can_delete,
                json_path=access.json_path,
            )
            result.append(new_access)

        return result

