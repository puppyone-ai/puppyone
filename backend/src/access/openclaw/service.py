"""
OpenClaw CLI Access Service

面向远程 CLI 的 connect / pull / push / status / disconnect 逻辑。
所有写入经 CollaborationService.commit() 走审计 + 版本管理。

重构说明 (2026-02-22):
- pull: 基于 sync_changelog cursor 的增量拉取, 消除全表轮询
- push: 去除冗余的 premature version check, 由 CollaborationService 统一处理冲突
- 全面消除 N+1 查询 (batch get_by_ids)
- _find_active_source 走 DB-level config->> 过滤, 不再全表扫描

Phase 3 (2026-02-23):
- 大文件支持: JSON/MD 走 API body, 其他文件走 S3 Presigned URL
- pull 返回 file 类型节点时包含 download_url (presigned)
- 新增 request_upload_url / confirm_upload 流程
- S3Service 复用全局单例
"""

import os
import uuid as _uuid
from typing import Optional, Any
from datetime import datetime

from src.access.config.repository import AgentRepository
from src.access.config.models import Agent
from src.content_node.repository import ContentNodeRepository
from src.sync.repository import SyncSourceRepository, NodeSyncRepository
from src.sync.changelog import SyncChangelogRepository
from src.sync.schemas import SyncSource
from src.collaboration.service import CollaborationService
from src.collaboration.version_service import VersionService
from src.collaboration.version_repository import FileVersionRepository, FolderSnapshotRepository
from src.collaboration.lock_service import LockService
from src.collaboration.conflict_service import ConflictService
from src.collaboration.audit_service import AuditService
from src.collaboration.audit_repository import AuditRepository
from src.s3.service import get_s3_service_instance
from src.supabase.client import SupabaseClient
from src.utils.logger import log_info, log_error

INLINE_TYPES = {"json", "markdown"}


class OpenClawService:
    """面向 CLI 的 OpenClaw 接入服务"""

    def __init__(
        self,
        supabase: SupabaseClient,
        agent_repo: AgentRepository,
        source_repo: SyncSourceRepository,
        node_sync_repo: NodeSyncRepository,
        changelog_repo: SyncChangelogRepository,
    ):
        self._supabase = supabase
        self._agents = agent_repo
        self._sources = source_repo
        self._node_sync = node_sync_repo
        self._changelog = changelog_repo

        self._node_repo = ContentNodeRepository(supabase)
        self._s3 = get_s3_service_instance()

    def _build_version_service(self) -> VersionService:
        return VersionService(
            node_repo=self._node_repo,
            version_repo=FileVersionRepository(self._supabase),
            snapshot_repo=FolderSnapshotRepository(self._supabase),
            s3_service=self._s3,
            changelog_repo=self._changelog,
        )

    def _build_collab_service(self) -> CollaborationService:
        return CollaborationService(
            node_repo=self._node_repo,
            lock_service=LockService(self._node_repo),
            conflict_service=ConflictService(),
            version_service=self._build_version_service(),
            audit_service=AuditService(
                audit_repo=AuditRepository(self._supabase),
            ),
        )

    # ----------------------------------------------------------
    # Auth: access key → Agent
    # ----------------------------------------------------------

    def authenticate(self, access_key: str) -> Optional[Agent]:
        agent = self._agents.get_by_mcp_api_key(access_key)
        if not agent:
            return None
        if agent.type != "devbox":
            return None
        return agent

    def touch_heartbeat(self, agent: Agent) -> None:
        """Update daemon heartbeat. Called by _auth() on every request arrival."""
        source = self._find_active_source(agent.id)
        if source:
            self._sources.touch_heartbeat(source.id)

    # ----------------------------------------------------------
    # Connect
    # ----------------------------------------------------------

    def connect(self, agent: Agent, workspace_path: str) -> SyncSource:
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
    # Pull (cursor-based incremental)
    # ----------------------------------------------------------

    def pull(self, agent: Agent, cursor: int = 0) -> dict:
        """
        Cursor-based incremental pull.

        cursor=0 → full sync (returns all accessible nodes + current cursor)
        cursor>0 → incremental (returns only changes since cursor)

        Returns:
            {
                "agent_id", "project_id",
                "nodes": [...],            # full or changed nodes
                "cursor": int,             # new cursor for next pull
                "has_more": bool,          # more pages available
                "is_full_sync": bool,
                "pulled_at": str,
            }
        """
        source = self._find_active_source(agent.id)

        if cursor == 0:
            return self._pull_full(agent, source)
        return self._pull_incremental(agent, source, cursor)

    def _pull_full(self, agent: Agent, source: Optional[SyncSource]) -> dict:
        """Full sync: return all accessible nodes (expanding folder children)."""
        seen_ids: set[str] = set()
        node_ids: list[str] = []
        readonly_map: dict[str, bool] = {}

        bash_list = self._agents.get_bash_by_agent_id(agent.id)
        for bash in bash_list:
            if bash.node_id not in seen_ids:
                seen_ids.add(bash.node_id)
                node_ids.append(bash.node_id)
                readonly_map[bash.node_id] = bash.readonly

        # Expand folder children: if a bash binding points to a folder,
        # include all its direct children in the accessible set.
        folder_node_ids = [nid for nid in node_ids]
        nodes_check = self._node_repo.get_by_ids(folder_node_ids)
        for node in nodes_check:
            if node.type == "folder":
                children = self._node_repo.list_children(
                    project_id=agent.project_id, parent_id=node.id,
                )
                for child in children:
                    if child.id not in seen_ids:
                        seen_ids.add(child.id)
                        node_ids.append(child.id)
                        readonly_map[child.id] = readonly_map.get(node.id, False)

        if source:
            source_mappings = self._node_sync.list_by_source(source.id)
            for mapping in source_mappings:
                if mapping.node_id not in seen_ids:
                    seen_ids.add(mapping.node_id)
                    node_ids.append(mapping.node_id)
                    readonly_map[mapping.node_id] = False

        nodes_data = self._node_repo.get_by_ids(node_ids)
        nodes_map = {n.id: n for n in nodes_data}

        result_nodes = []
        for nid in node_ids:
            node = nodes_map.get(nid)
            if not node:
                continue
            result_nodes.append(self._serialize_node(
                node, readonly=readonly_map.get(nid, False),
            ))

        new_cursor = self._changelog.get_latest_cursor(agent.project_id)

        return {
            "agent_id": agent.id,
            "project_id": agent.project_id,
            "nodes": result_nodes,
            "cursor": new_cursor,
            "has_more": False,
            "is_full_sync": True,
            "pulled_at": datetime.utcnow().isoformat(),
        }

    def _pull_incremental(
        self, agent: Agent, source: Optional[SyncSource], cursor: int,
    ) -> dict:
        """Incremental pull via changelog since cursor."""
        min_available = self._changelog.min_cursor()
        latest = self._changelog.get_latest_cursor(agent.project_id)

        if min_available > 0 and cursor < min_available:
            return self._pull_full(agent, source)
        if latest > 0 and cursor > latest:
            return self._pull_full(agent, source)

        limit = 500
        entries = self._changelog.list_since(agent.project_id, cursor, limit)

        if not entries:
            return {
                "agent_id": agent.id,
                "project_id": agent.project_id,
                "nodes": [],
                "cursor": max(cursor, latest),
                "has_more": False,
                "is_full_sync": False,
                "pulled_at": datetime.utcnow().isoformat(),
            }

        accessible = self._get_accessible_node_ids(agent, source)

        changed_ids = list(dict.fromkeys(
            e.node_id for e in entries if e.node_id in accessible
        ))

        deleted_ids = {
            e.node_id for e in entries
            if e.action == "delete" and e.node_id in accessible
        }

        fetch_ids = [nid for nid in changed_ids if nid not in deleted_ids]
        nodes_data = self._node_repo.get_by_ids(fetch_ids)
        nodes_map = {n.id: n for n in nodes_data}

        readonly_set = self._get_readonly_node_ids(agent)

        result_nodes = []
        for nid in changed_ids:
            if nid in deleted_ids:
                result_nodes.append({
                    "node_id": nid,
                    "action": "delete",
                })
                continue
            node = nodes_map.get(nid)
            if not node:
                continue
            entry = self._serialize_node(
                node, readonly=nid in readonly_set,
            )
            entry["action"] = "update"
            result_nodes.append(entry)

        new_cursor = entries[-1].id
        has_more = len(entries) >= limit

        return {
            "agent_id": agent.id,
            "project_id": agent.project_id,
            "nodes": result_nodes,
            "cursor": new_cursor,
            "has_more": has_more,
            "is_full_sync": False,
            "pulled_at": datetime.utcnow().isoformat(),
        }

    # ----------------------------------------------------------
    # Push
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
        if node_id is None:
            return self._push_create(agent, content, node_type, filename)
        return self._push_update(agent, node_id, content, base_version, node_type)

    def _push_create(
        self, agent: Agent, content: Any, node_type: str, filename: Optional[str],
    ) -> dict:
        if not filename:
            return {"ok": False, "error": "missing_filename",
                    "message": "filename is required when creating a new node"}

        source = self._find_active_source(agent.id)
        if not source:
            return {"ok": False, "error": "not_connected",
                    "message": "No active OpenClaw connection"}

        import uuid
        import json as _json

        name = os.path.splitext(filename)[0] if "." in filename else filename
        created_by = self._get_project_owner(agent.project_id)
        home_folder_id = self._get_home_folder_id(agent)

        try:
            new_id = str(uuid.uuid4())
            if node_type == "json":
                json_content = content if isinstance(content, (dict, list)) else {}
                size_bytes = len(_json.dumps(json_content, ensure_ascii=False).encode("utf-8"))
                node = self._node_repo.create(
                    project_id=agent.project_id,
                    name=name,
                    node_type="json",
                    id_path=f"{agent.project_id}/{new_id}",
                    parent_id=home_folder_id,
                    created_by=created_by,
                    preview_json=json_content,
                    mime_type="application/json",
                    size_bytes=size_bytes,
                )
            else:
                content_str = content if isinstance(content, str) else str(content or "")
                size_bytes = len(content_str.encode("utf-8"))
                node = self._node_repo.create(
                    project_id=agent.project_id,
                    name=name,
                    node_type="markdown",
                    id_path=f"{agent.project_id}/{new_id}",
                    parent_id=home_folder_id,
                    created_by=created_by,
                    preview_md=content_str,
                    mime_type="text/markdown",
                    size_bytes=size_bytes,
                )

            version_svc = self._build_version_service()
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
        accessible = self._get_accessible_node_ids(agent)
        readonly = self._get_readonly_node_ids(agent)

        if node_id not in accessible:
            return {"ok": False, "error": "permission_denied",
                    "message": "Node not accessible by this agent"}
        if node_id in readonly:
            return {"ok": False, "error": "permission_denied",
                    "message": "Node is read-only for this agent"}

        collab_svc = self._build_collab_service()

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

            source = self._find_active_source(agent.id)
            if source:
                mapping = self._node_sync.get_by_node(node_id)
                if mapping:
                    self._node_sync.update_sync_point(
                        node_id=node_id,
                        last_sync_version=result.version,
                    )
                else:
                    node_obj = self._node_repo.get_by_id(node_id)
                    ext_id = (node_obj.name if node_obj else node_id)
                    self._node_sync.bind_node(
                        node_id=node_id,
                        source_id=source.id,
                        external_resource_id=ext_id,
                    )
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
    # File upload (presigned URL flow for non-JSON/MD)
    # ----------------------------------------------------------

    def request_upload_url(
        self,
        agent: Agent,
        filename: str,
        content_type: str,
        size_bytes: int,
        node_id: Optional[str] = None,
    ) -> dict:
        """
        Request a presigned S3 upload URL.

        node_id=None → create a new file node and return its presigned URL.
        node_id=xxx  → update an existing file node's S3 object.
        """
        source = self._find_active_source(agent.id)
        if not source:
            return {"ok": False, "error": "not_connected",
                    "message": "No active OpenClaw connection"}

        if node_id:
            accessible = self._get_accessible_node_ids(agent, source)
            readonly = self._get_readonly_node_ids(agent)
            if node_id not in accessible:
                return {"ok": False, "error": "permission_denied",
                        "message": "Node not accessible"}
            if node_id in readonly:
                return {"ok": False, "error": "permission_denied",
                        "message": "Node is read-only"}

            node = self._node_repo.get_by_id(node_id)
            if not node:
                return {"ok": False, "error": "not_found", "message": "Node not found"}
            s3_key = node.s3_key or self._make_s3_key(agent.project_id, node_id, filename)
        else:
            node_id = str(_uuid.uuid4())
            s3_key = self._make_s3_key(agent.project_id, node_id, filename)
            name = os.path.splitext(filename)[0] if "." in filename else filename
            created_by = self._get_project_owner(agent.project_id)
            home_folder_id = self._get_home_folder_id(agent)

            node = self._node_repo.create(
                project_id=agent.project_id,
                name=name,
                node_type="file",
                id_path=f"{agent.project_id}/{node_id}",
                parent_id=home_folder_id,
                created_by=created_by,
                s3_key=s3_key,
                mime_type=content_type,
                size_bytes=size_bytes,
            )
            node_id = node.id

            self._node_sync.bind_node(
                node_id=node_id,
                source_id=source.id,
                external_resource_id=filename,
            )

        try:
            params = {"Bucket": self._s3.bucket_name, "Key": s3_key}
            if content_type:
                params["ContentType"] = content_type
            upload_url = self._s3.client.generate_presigned_url(
                ClientMethod="put_object",
                Params=params,
                ExpiresIn=3600,
            )
        except Exception as e:
            log_error(f"[OpenClaw] Failed to generate upload URL: {e}")
            return {"ok": False, "error": "s3_error", "message": str(e)}

        log_info(f"[OpenClaw] Upload URL for {filename} → s3://{s3_key}")
        return {
            "ok": True,
            "node_id": node_id,
            "s3_key": s3_key,
            "upload_url": upload_url,
        }

    def confirm_upload(
        self,
        agent: Agent,
        node_id: str,
        size_bytes: int,
        content_hash: Optional[str] = None,
    ) -> dict:
        """
        Called by CLI after a successful S3 presigned upload.
        Creates a version record and emits a changelog entry.
        """
        node = self._node_repo.get_by_id(node_id)
        if not node:
            return {"ok": False, "error": "not_found", "message": "Node not found"}

        self._node_repo.update(
            node_id=node_id,
            size_bytes=size_bytes,
        )

        version_svc = self._build_version_service()
        is_new = (node.current_version or 0) == 0
        try:
            version = version_svc.create_version(
                node_id=node_id,
                operator_type="agent",
                operation="create" if is_new else "update",
                s3_key=node.s3_key,
                operator_id=agent.id,
                summary=f"CLI file upload from agent '{agent.name}'",
            )
            new_version = version.version if version else 1

            self._node_sync.update_sync_point(
                node_id=node_id,
                last_sync_version=new_version,
            )

            log_info(
                f"[OpenClaw] CONFIRM upload {node_id} v{new_version} "
                f"({size_bytes} bytes) by agent {agent.id}"
            )
            return {
                "ok": True,
                "node_id": node_id,
                "version": new_version,
                "status": "uploaded",
            }
        except Exception as e:
            log_error(f"[OpenClaw] CONFIRM failed for {node_id}: {e}")
            return {"ok": False, "error": "confirm_failed", "message": str(e)}

    # ----------------------------------------------------------
    # Status
    # ----------------------------------------------------------

    def status(self, agent: Agent) -> dict:
        source = self._find_active_source(agent.id)
        if not source:
            return {"connected": False, "source_id": None, "workspace_path": None}

        daemon_active = False
        if source.updated_at:
            try:
                last_seen = datetime.fromisoformat(
                    source.updated_at.replace("Z", "+00:00")
                    if isinstance(source.updated_at, str)
                    else source.updated_at.isoformat()
                )
                age = (datetime.now(last_seen.tzinfo) - last_seen).total_seconds()
                daemon_active = age < 90
            except Exception:
                pass

        return {
            "connected": daemon_active,
            "source_id": source.id,
            "workspace_path": source.config.get("path"),
            "connected_at": source.created_at if hasattr(source, "created_at") else None,
            "last_seen_at": source.updated_at,
        }

    # ----------------------------------------------------------
    # Disconnect
    # ----------------------------------------------------------

    def disconnect(self, agent: Agent) -> bool:
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
        return self._sources.find_active_by_config_key("openclaw", "agent_id", agent_id)

    def _get_home_folder_id(self, agent: Agent) -> Optional[str]:
        """Get the agent's primary writable folder for new file creation."""
        bash_list = self._agents.get_bash_by_agent_id(agent.id)
        writable = [b for b in bash_list if not b.readonly]
        if not writable:
            return None
        nodes = self._node_repo.get_by_ids([b.node_id for b in writable])
        for node in nodes:
            if node.type == "folder":
                return node.id
        return None

    def _get_accessible_node_ids(
        self, agent: Agent, source: Optional[SyncSource] = None,
    ) -> set[str]:
        """All node IDs this agent can access (bash bindings + folder children + sync source)."""
        ids: set[str] = set()
        bash_list = self._agents.get_bash_by_agent_id(agent.id)
        folder_ids = []
        for bash in bash_list:
            ids.add(bash.node_id)
            folder_ids.append(bash.node_id)
        nodes_check = self._node_repo.get_by_ids(folder_ids)
        for node in nodes_check:
            if node.type == "folder":
                for child in self._node_repo.list_children(
                    project_id=agent.project_id, parent_id=node.id,
                ):
                    ids.add(child.id)
        if source is None:
            source = self._find_active_source(agent.id)
        if source:
            for m in self._node_sync.list_by_source(source.id):
                ids.add(m.node_id)
        return ids

    def _get_readonly_node_ids(self, agent: Agent) -> set[str]:
        """Node IDs that are read-only for this agent."""
        bash_list = self._agents.get_bash_by_agent_id(agent.id)
        return {b.node_id for b in bash_list if b.readonly}

    def _serialize_node(self, node, *, readonly: bool = False) -> dict:
        """Build a pull response entry for a single node."""
        entry = {
            "node_id": node.id,
            "name": node.name,
            "type": node.type,
            "version": node.current_version or 0,
            "readonly": readonly,
        }
        if node.type in INLINE_TYPES:
            entry["content"] = (
                node.preview_json if node.type == "json" else node.preview_md
            )
        else:
            entry["s3_key"] = node.s3_key
            entry["mime_type"] = node.mime_type
            entry["size_bytes"] = node.size_bytes or 0
            if node.s3_key:
                try:
                    url = self._s3.client.generate_presigned_url(
                        ClientMethod="get_object",
                        Params={"Bucket": self._s3.bucket_name, "Key": node.s3_key},
                        ExpiresIn=3600,
                    )
                    entry["download_url"] = url
                except Exception:
                    entry["download_url"] = None
        return entry

    @staticmethod
    def _make_s3_key(project_id: str, node_id: str, filename: str) -> str:
        safe_name = filename.replace("/", "_").replace("\\", "_")
        return f"projects/{project_id}/openclaw/{node_id}/{safe_name}"

    def _get_project_owner(self, project_id: str) -> Optional[str]:
        from src.project.repository import ProjectRepositorySupabase
        try:
            repo = ProjectRepositorySupabase()
            project = repo.get_by_id(project_id)
            return project.user_id if project else None
        except Exception:
            return None
