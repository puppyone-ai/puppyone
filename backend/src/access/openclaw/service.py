"""
OpenClaw CLI Access Service

面向远程 CLI 的 connect / push / pull / ack 逻辑。
所有写入经 CollaborationService.commit() 走审计 + 版本管理。
"""

from typing import Optional, Any
from datetime import datetime

from src.access.config.repository import AgentRepository
from src.access.config.models import Agent
from src.sync.repository import SyncSourceRepository, NodeSyncRepository
from src.sync.schemas import SyncSource
from src.utils.logger import log_info, log_error


class OpenClawService:
    """面向 CLI 的 OpenClaw 接入服务"""

    def __init__(
        self,
        agent_repo: AgentRepository,
        source_repo: SyncSourceRepository,
        node_sync_repo: NodeSyncRepository,
    ):
        self._agents = agent_repo
        self._sources = source_repo
        self._node_sync = node_sync_repo

    # ----------------------------------------------------------
    # Auth: access key → Agent
    # ----------------------------------------------------------

    def authenticate(self, access_key: str) -> Optional[Agent]:
        """通过 access key 查找并验证 Agent（仅限 cli_ 前缀的 devbox 类型）。"""
        agent = self._agents.get_by_mcp_api_key(access_key)
        if not agent:
            return None
        if agent.type != "devbox":
            return None
        return agent

    # ----------------------------------------------------------
    # Connect: CLI 首次连接
    # ----------------------------------------------------------

    def connect(
        self,
        agent: Agent,
        workspace_path: str,
    ) -> SyncSource:
        """
        CLI 连接：注册 SyncSource 并关联到 Agent。

        如果已有同一 agent 的 active source，复用之。
        """
        existing = self._find_active_source(agent.id)
        if existing:
            log_info(
                f"[OpenClaw] Reusing existing source #{existing.id} "
                f"for agent {agent.id}"
            )
            if existing.config.get("path") != workspace_path:
                self._sources.update_config(
                    existing.id,
                    {**existing.config, "path": workspace_path},
                )
            return existing

        source = self._sources.create(
            project_id=agent.project_id,
            adapter_type="openclaw",
            config={
                "path": workspace_path,
                "agent_id": agent.id,
                "agent_name": agent.name,
            },
            trigger_config={"type": "cli_push"},
            sync_mode="bidirectional",
            conflict_strategy="three_way_merge",
        )

        log_info(
            f"[OpenClaw] Connected: agent {agent.id} → "
            f"source #{source.id} @ {workspace_path}"
        )
        return source

    # ----------------------------------------------------------
    # Pull: CLI 从 PuppyOne 拉取数据
    # ----------------------------------------------------------

    def pull(self, agent: Agent) -> dict:
        """
        返回 Agent 可访问的所有节点数据（通过 agent_bash 配置）。

        CLI 调用此接口拉取最新数据写入本地工作区。
        """
        from src.content_node.repository import ContentNodeRepository
        from src.supabase.client import SupabaseClient

        repo = ContentNodeRepository(SupabaseClient())
        bash_list = self._agents.get_bash_by_agent_id(agent.id)

        nodes = []
        for bash in bash_list:
            node = repo.get_by_id(bash.node_id)
            if not node:
                continue
            nodes.append({
                "node_id": node.id,
                "name": node.name,
                "type": node.type,
                "content": node.preview_json if node.type == "json" else node.preview_md,
                "version": getattr(node, "current_version", 0) or 0,
                "json_path": bash.json_path,
                "readonly": bash.readonly,
            })

        return {
            "agent_id": agent.id,
            "project_id": agent.project_id,
            "nodes": nodes,
            "pulled_at": datetime.utcnow().isoformat(),
        }

    # ----------------------------------------------------------
    # Push: CLI 推送变更到 PuppyOne
    # ----------------------------------------------------------

    def push(
        self,
        agent: Agent,
        node_id: str,
        content: Any,
        base_version: int,
        node_type: str = "json",
    ) -> dict:
        """
        CLI 推送单个节点变更 → CollaborationService.commit()。

        所有写入强制走版本管理和审计。
        """
        from src.collaboration.service import CollaborationService
        from src.collaboration.lock_service import LockService
        from src.collaboration.conflict_service import ConflictService
        from src.collaboration.version_service import VersionService
        from src.collaboration.version_repository import (
            FileVersionRepository, FolderSnapshotRepository,
        )
        from src.collaboration.audit_service import AuditService
        from src.collaboration.audit_repository import AuditRepository
        from src.content_node.repository import ContentNodeRepository
        from src.s3.service import S3Service
        from src.supabase.client import SupabaseClient

        bash_list = self._agents.get_bash_by_agent_id(agent.id)
        allowed = {b.node_id for b in bash_list if not b.readonly}
        if node_id not in allowed:
            return {"ok": False, "error": "permission_denied",
                    "message": "Node not writable by this agent"}

        supabase = SupabaseClient()
        node_repo = ContentNodeRepository(supabase)
        s3_svc = S3Service()
        version_svc = VersionService(
            node_repo=node_repo,
            version_repo=FileVersionRepository(supabase),
            snapshot_repo=FolderSnapshotRepository(supabase),
            s3_service=s3_svc,
        )
        collab_svc = CollaborationService(
            node_repo=node_repo,
            lock_service=LockService(node_repo),
            conflict_service=ConflictService(),
            version_service=version_svc,
            audit_service=AuditService(
                audit_repo=AuditRepository(supabase),
            ),
        )

        try:
            result = collab_svc.commit(
                node_id=node_id,
                new_content=content,
                base_version=base_version,
                node_type=node_type,
                operator_type="agent",
                operator_id=agent.id,
                summary=f"CLI push from agent '{agent.name}'",
            )
            log_info(
                f"[OpenClaw] PUSH node {node_id} v{result.version} "
                f"by agent {agent.id} ({result.status})"
            )
            return {
                "ok": True,
                "node_id": node_id,
                "version": result.version,
                "status": result.status,
            }
        except Exception as e:
            log_error(f"[OpenClaw] PUSH failed for node {node_id}: {e}")
            return {"ok": False, "error": "commit_failed", "message": str(e)}

    # ----------------------------------------------------------
    # Disconnect
    # ----------------------------------------------------------

    def disconnect(self, agent: Agent) -> bool:
        """停用 Agent 关联的 SyncSource。"""
        source = self._find_active_source(agent.id)
        if not source:
            return False
        self._sources.delete(source.id)
        log_info(f"[OpenClaw] Disconnected: agent {agent.id}, source #{source.id}")
        return True

    # ----------------------------------------------------------
    # Helpers
    # ----------------------------------------------------------

    def _find_active_source(self, agent_id: str) -> Optional[SyncSource]:
        """查找 Agent 关联的活跃 SyncSource。"""
        sources = self._sources.list_active("openclaw")
        for s in sources:
            if s.config.get("agent_id") == agent_id:
                return s
        return None
