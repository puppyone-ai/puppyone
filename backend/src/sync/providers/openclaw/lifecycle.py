"""
OpenClaw CLI Connection Lifecycle Service

管理 CLI daemon 的 connect / status / disconnect 生命周期。
OpenClaw 是纯 Sync 实体，不依赖 agents 表。

数据同步操作 (pull/push/upload) 在 FolderSyncService
(/api/v1/sync/{folder_id}/).
"""

import secrets
from typing import Optional
from datetime import datetime

from src.content_node.repository import ContentNodeRepository
from src.sync.repository import SyncRepository
from src.sync.schemas import Sync
from src.supabase.client import SupabaseClient
from src.utils.logger import log_info


def _generate_cli_key() -> str:
    return f"cli_{secrets.token_urlsafe(32)}"


class OpenClawService:
    """OpenClaw CLI 连接生命周期服务"""

    def __init__(
        self,
        supabase: SupabaseClient,
        sync_repo: SyncRepository,
    ):
        self._supabase = supabase
        self._sync_repo = sync_repo
        self._node_repo = ContentNodeRepository(supabase)

    # ----------------------------------------------------------
    # Auth: access key → Sync
    # ----------------------------------------------------------

    def authenticate(self, access_key: str) -> Optional[Sync]:
        sync = self._sync_repo.get_by_access_key(access_key)
        if not sync:
            return None
        if sync.provider != "openclaw":
            return None
        return sync

    def touch_heartbeat(self, sync: Sync) -> None:
        self._sync_repo.touch_heartbeat(sync.id)

    # ----------------------------------------------------------
    # Bootstrap — create a new OpenClaw sync endpoint for a folder
    # ----------------------------------------------------------

    def bootstrap(
        self,
        project_id: str,
        node_id: str,
    ) -> Sync:
        """Create a new OpenClaw sync endpoint bound to a folder.
        Returns the sync with a fresh access_key for CLI auth."""
        existing = self._sync_repo.get_by_node(node_id)
        if existing and existing.provider == "openclaw":
            return existing

        sync = self._sync_repo.create(
            project_id=project_id,
            node_id=node_id,
            direction="bidirectional",
            provider="openclaw",
            access_key=_generate_cli_key(),
            config={},
            trigger={"type": "cli_push"},
            conflict_strategy="three_way_merge",
        )
        log_info(f"[OpenClaw] Bootstrapped sync #{sync.id} for node {node_id}")
        return sync

    # ----------------------------------------------------------
    # Connect — CLI daemon calls this on startup
    # ----------------------------------------------------------

    def connect(self, sync: Sync, workspace_path: str) -> Sync:
        if sync.config.get("path") != workspace_path:
            self._sync_repo.update_config(
                sync.id,
                {**sync.config, "path": workspace_path},
            )
        self._sync_repo.touch_heartbeat(sync.id)
        log_info(f"[OpenClaw] CLI connected: sync #{sync.id} @ {workspace_path}")
        return sync

    # ----------------------------------------------------------
    # Status
    # ----------------------------------------------------------

    def status(self, sync: Sync) -> dict:
        daemon_active = False
        if sync.updated_at:
            try:
                last_seen = datetime.fromisoformat(
                    sync.updated_at.replace("Z", "+00:00")
                    if isinstance(sync.updated_at, str)
                    else sync.updated_at.isoformat()
                )
                age = (datetime.now(last_seen.tzinfo) - last_seen).total_seconds()
                daemon_active = age < 90
            except Exception:
                pass

        return {
            "connected": daemon_active,
            "sync_id": sync.id,
            "folder_id": sync.node_id,
            "workspace_path": sync.config.get("path"),
            "connected_at": sync.created_at,
            "last_seen_at": sync.updated_at,
        }

    # ----------------------------------------------------------
    # Disconnect
    # ----------------------------------------------------------

    def disconnect(self, sync: Sync) -> bool:
        self._sync_repo.delete(sync.id)
        log_info(f"[OpenClaw] Disconnected: sync #{sync.id}")
        return True
