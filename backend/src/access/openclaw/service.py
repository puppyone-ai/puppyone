"""
OpenClaw CLI Access Service

面向远程 CLI 的 connect / push / pull / ack 逻辑。
所有写入经 CollaborationService.commit() 走审计 + 版本管理。
"""

import os
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
        返回 Agent 可访问的所有节点数据。

        数据来源：
        1. agent_bash 绑定的节点（UI 手动绑定的资源）
        2. 通过 sync_source 绑定的节点（CLI push 创建的）

        两者取并集，去重。
        """
        from src.content_node.repository import ContentNodeRepository
        from src.supabase.client import SupabaseClient

        repo = ContentNodeRepository(SupabaseClient())

        seen_ids = set()
        nodes = []

        bash_list = self._agents.get_bash_by_agent_id(agent.id)
        for bash in bash_list:
            node = repo.get_by_id(bash.node_id)
            if not node or node.id in seen_ids:
                continue
            seen_ids.add(node.id)
            nodes.append({
                "node_id": node.id,
                "name": node.name,
                "type": node.type,
                "content": node.preview_json if node.type == "json" else node.preview_md,
                "version": getattr(node, "current_version", 0) or 0,
                "readonly": bash.readonly,
            })

        source = self._find_active_source(agent.id)
        if source:
            source_nodes = self._node_sync.list_by_source(source.id)
            for mapping in source_nodes:
                if mapping.node_id in seen_ids:
                    continue
                seen_ids.add(mapping.node_id)
                node = repo.get_by_id(mapping.node_id)
                if not node:
                    continue
                nodes.append({
                    "node_id": node.id,
                    "name": node.name,
                    "type": node.type,
                    "content": node.preview_json if node.type == "json" else node.preview_md,
                    "version": getattr(node, "current_version", 0) or 0,
                    "readonly": False,
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
        node_id: Optional[str],
        content: Any,
        base_version: int,
        node_type: str = "json",
        filename: Optional[str] = None,
    ) -> dict:
        """
        CLI 推送变更 → CollaborationService.commit()。

        node_id=None + filename → 创建新 content_node 并绑定到 sync source
        node_id=xxx → 更新现有节点（经乐观锁）
        """
        if node_id is None:
            return self._push_create(agent, content, node_type, filename)
        return self._push_update(agent, node_id, content, base_version, node_type)

    def _push_create(
        self,
        agent: Agent,
        content: Any,
        node_type: str,
        filename: Optional[str],
    ) -> dict:
        """创建新节点（本地文件在云端不存在时）。"""
        if not filename:
            return {"ok": False, "error": "missing_filename",
                    "message": "filename is required when creating a new node"}

        source = self._find_active_source(agent.id)
        if not source:
            return {"ok": False, "error": "not_connected",
                    "message": "No active OpenClaw connection"}

        from src.content_node.repository import ContentNodeRepository
        from src.collaboration.version_service import VersionService
        from src.collaboration.version_repository import (
            FileVersionRepository, FolderSnapshotRepository,
        )
        from src.s3.service import S3Service
        from src.supabase.client import SupabaseClient
        import uuid
        import json as _json

        supabase = SupabaseClient()
        node_repo = ContentNodeRepository(supabase)

        name = os.path.splitext(filename)[0] if "." in filename else filename
        created_by = f"openclaw:{agent.id}"

        try:
            new_id = str(uuid.uuid4())
            if node_type == "json":
                json_content = content if isinstance(content, (dict, list)) else {}
                size_bytes = len(_json.dumps(json_content, ensure_ascii=False).encode("utf-8"))
                node = node_repo.create(
                    project_id=agent.project_id,
                    name=name,
                    node_type="json",
                    id_path=f"{agent.project_id}/{new_id}",
                    parent_id=None,
                    created_by=created_by,
                    preview_json=json_content,
                    mime_type="application/json",
                    size_bytes=size_bytes,
                )
            else:
                content_str = content if isinstance(content, str) else str(content or "")
                size_bytes = len(content_str.encode("utf-8"))
                node = node_repo.create(
                    project_id=agent.project_id,
                    name=name,
                    node_type="markdown",
                    id_path=f"{agent.project_id}/{new_id}",
                    parent_id=None,
                    created_by=created_by,
                    preview_md=content_str,
                    mime_type="text/markdown",
                    size_bytes=size_bytes,
                )

            s3_svc = S3Service()
            version_svc = VersionService(
                node_repo=node_repo,
                version_repo=FileVersionRepository(supabase),
                snapshot_repo=FolderSnapshotRepository(supabase),
                s3_service=s3_svc,
            )
            if node_type == "json":
                version_svc.create_version(
                    node_id=node.id,
                    operator_type="agent",
                    operation="create",
                    content_json=content if isinstance(content, (dict, list)) else {},
                    operator_id=agent.id,
                    summary=f"CLI create from agent '{agent.name}'",
                )
            else:
                version_svc.create_version(
                    node_id=node.id,
                    operator_type="agent",
                    operation="create",
                    content_text=content if isinstance(content, str) else str(content or ""),
                    operator_id=agent.id,
                    summary=f"CLI create from agent '{agent.name}'",
                )

            self._node_sync.bind_node(
                node_id=node.id,
                source_id=source.id,
                external_resource_id=filename,
            )

            version = getattr(node, "current_version", 1) or 1
            self._node_sync.update_sync_point(
                node_id=node.id,
                last_sync_version=version,
            )

            log_info(
                f"[OpenClaw] CREATE node {node.id} ({filename}) "
                f"by agent {agent.id}"
            )
            return {
                "ok": True,
                "node_id": node.id,
                "version": version,
                "status": "created",
            }
        except Exception as e:
            log_error(f"[OpenClaw] CREATE failed for {filename}: {e}")
            return {"ok": False, "error": "create_failed", "message": str(e)}

    def _push_update(
        self,
        agent: Agent,
        node_id: str,
        content: Any,
        base_version: int,
        node_type: str,
    ) -> dict:
        """更新现有节点。"""
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
        allowed_bash = {b.node_id for b in bash_list if not b.readonly}

        source = self._find_active_source(agent.id)
        allowed_source = set()
        if source:
            for m in self._node_sync.list_by_source(source.id):
                allowed_source.add(m.node_id)

        if node_id not in allowed_bash and node_id not in allowed_source:
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

        lock_svc = LockService(node_repo)
        current_version = lock_svc.get_current_version(node_id)
        if base_version > 0 and current_version > base_version:
            return {
                "ok": False,
                "error": "version_conflict",
                "message": f"Version conflict: you have v{base_version}, server has v{current_version}",
                "server_version": current_version,
            }

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

            if source:
                mapping = self._node_sync.get_by_node(node_id)
                if mapping:
                    self._node_sync.update_sync_point(
                        node_id=node_id,
                        last_sync_version=result.version,
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
    # Status
    # ----------------------------------------------------------

    def status(self, agent: Agent) -> dict:
        """返回 Agent 的 OpenClaw 连接状态。"""
        source = self._find_active_source(agent.id)
        if not source:
            return {"connected": False, "source_id": None, "workspace_path": None}
        return {
            "connected": True,
            "source_id": source.id,
            "workspace_path": source.config.get("path"),
            "connected_at": source.created_at if hasattr(source, "created_at") else None,
        }

    # ----------------------------------------------------------
    # Disconnect
    # ----------------------------------------------------------

    def disconnect(self, agent: Agent) -> bool:
        """停用 Agent 关联的 SyncSource。"""
        source = self._find_active_source(agent.id)
        if not source:
            return False
        self._node_sync.unbind_by_source(source.id)
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
