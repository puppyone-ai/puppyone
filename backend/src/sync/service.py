"""
L2.5 Sync — SyncService (bidirectional sync orchestrator)

Responsibilities:
  - bootstrap:       First-connect scan → create Sync rows
  - pull_sync:       External → PuppyOne (via L2.commit)
  - pull_all:        Pull all active syncs
  - push_node:       PuppyOne → external (after L2.commit)

All writes go through L2. L2.5 is a background conveyor belt, not a write gate.

Connector resolution uses BaseConnector from src.sync.connectors._base.
"""

import json
from typing import Optional, List, Any, TYPE_CHECKING

from src.sync.connectors._base import BaseConnector
from src.sync.repository import SyncRepository
from src.sync.schemas import Sync, PullResult, ResourceInfo
from src.collaboration.schemas import Mutation, MutationType, Operator
from src.utils.logger import log_info, log_error, log_debug

if TYPE_CHECKING:
    from src.collaboration.service import CollaborationService


class SyncService:
    """L2.5 bidirectional sync orchestrator."""

    def __init__(
        self,
        collab_service: Optional["CollaborationService"],
        sync_repo: SyncRepository,
    ):
        self.collab = collab_service
        self.sync_repo = sync_repo
        self._connectors: dict[str, BaseConnector] = {}

    def register_connector(self, connector: BaseConnector) -> None:
        self._connectors[connector.spec().provider] = connector

    def _get_connector(self, provider: str) -> Optional[BaseConnector]:
        return self._connectors.get(provider)

    # ============================================================
    # Sync lifecycle
    # ============================================================

    def remove_sync(self, sync_id: str) -> None:
        self.sync_repo.delete(sync_id)
        log_info(f"[L2.5] Removed sync #{sync_id}")

    def pause_sync(self, sync_id: str) -> None:
        self.sync_repo.update_status(sync_id, "paused")

    def resume_sync(self, sync_id: str) -> None:
        self.sync_repo.update_status(sync_id, "active")

    # ============================================================
    # Bootstrap: first-connect scan → create Sync rows
    # ============================================================

    async def bootstrap(
        self,
        project_id: str,
        provider: str,
        config: dict,
        target_folder_node_id: Optional[str] = None,
        credentials_ref: Optional[str] = None,
        direction: str = "bidirectional",
        conflict_strategy: str = "three_way_merge",
        sync_mode: str = "import_once",
        trigger: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> List[Sync]:
        """
        First connect: scan external source, create nodes in PuppyOne,
        and create Sync rows for each binding.

        sync_mode: 'import_once' | 'manual' | 'scheduled'
        trigger: optional trigger config, e.g. {"type": "scheduled", "schedule": "0 9 * * *", "timezone": "Asia/Shanghai"}
        """
        connector = self._get_connector(provider)
        if not connector:
            raise ValueError(f"No connector for provider: {provider}")
        if connector.spec().creation_mode != "bootstrap":
            raise ValueError(
                f"Connector {provider} must use direct sync creation, not bootstrap"
            )

        trigger_data = trigger or {}
        if not trigger_data.get("type"):
            trigger_data["type"] = sync_mode

        temp_sync = Sync(
            id="",
            project_id=project_id,
            node_id="",
            direction=direction,
            provider=provider,
            config=config,
            credentials_ref=credentials_ref,
        )

        resources = await connector.list_resources(temp_sync)
        created_syncs: List[Sync] = []

        for res in resources:
            existing = self.sync_repo.find_by_config_key(
                provider, "external_resource_id", res.external_resource_id,
            )
            if existing:
                continue

            node_id = await self._ensure_node_exists(
                project_id=project_id,
                resource=res,
                folder_node_id=target_folder_node_id,
            )

            sync_config = {
                **config,
                "external_resource_id": res.external_resource_id,
            }
            if user_id:
                sync_config["user_id"] = user_id

            sync = self.sync_repo.create(
                project_id=project_id,
                node_id=node_id,
                direction=direction,
                provider=provider,
                config=sync_config,
                credentials_ref=credentials_ref,
                conflict_strategy=conflict_strategy,
                trigger=trigger_data,
                created_by=user_id,
            )
            created_syncs.append(sync)
            log_info(f"[L2.5] Bound {res.external_resource_id} → node {node_id} (mode={sync_mode})")

        log_info(f"[L2.5] Bootstrap complete: {len(created_syncs)} syncs created (mode={sync_mode})")
        return created_syncs

    async def create_sync(
        self,
        project_id: str,
        provider: str,
        config: dict,
        target_folder_node_id: str,
        *,
        credentials_ref: Optional[str] = None,
        direction: str = "inbound",
        conflict_strategy: str = "three_way_merge",
        sync_mode: str = "import_once",
        trigger: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> Sync:
        """
        Create exactly one sync binding for connectors that fetch a single
        aggregated resource into one PuppyOne node.
        """
        connector = self._get_connector(provider)
        if not connector:
            raise ValueError(f"No connector for provider: {provider}")

        spec = connector.spec()
        if spec.creation_mode != "direct":
            raise ValueError(
                f"Connector {provider} does not support direct sync creation"
            )

        if not target_folder_node_id:
            raise ValueError("target_folder_node_id is required")

        trigger_data = trigger or {}
        if not trigger_data.get("type"):
            trigger_data["type"] = sync_mode

        placeholder = ResourceInfo(
            external_resource_id=f"direct:{provider}",
            name=config.get("name") or spec.display_name,
            node_type=spec.default_node_type,
        )
        node_id = await self._ensure_node_exists(
            project_id=project_id,
            resource=placeholder,
            folder_node_id=target_folder_node_id,
        )

        sync_config = {
            **config,
            "external_resource_id": f"direct:{provider}:{node_id}",
        }
        if user_id:
            sync_config["user_id"] = user_id

        sync = self.sync_repo.create(
            project_id=project_id,
            node_id=node_id,
            direction=direction,
            provider=provider,
            config=sync_config,
            credentials_ref=credentials_ref,
            conflict_strategy=conflict_strategy,
            trigger=trigger_data,
            created_by=user_id,
        )
        log_info(
            f"[L2.5] Direct sync created: {provider} → node {node_id} "
            f"(mode={sync_mode})"
        )
        return sync

    async def _ensure_node_exists(
        self, project_id: str, resource, folder_node_id: Optional[str],
    ) -> str:
        """Ensure a corresponding node exists in PuppyOne. Create if missing."""
        if not self.collab:
            raise RuntimeError("collab_service required for _ensure_node_exists")

        node_type = resource.node_type if resource.node_type in ("json", "markdown") else "markdown"
        mutation = Mutation(
            type=MutationType.NODE_CREATE,
            operator=Operator(type="sync", id="sync_bootstrap"),
            project_id=project_id,
            parent_id=folder_node_id,
            name=resource.name,
            node_type=node_type,
            content={} if node_type == "json" else "",
        )
        result = await self.collab.commit(mutation)
        return result.node_id

    # ============================================================
    # PULL: External → PuppyOne
    # ============================================================

    async def pull_sync(self, sync_id: str) -> Optional[dict]:
        """Pull changes for a single sync."""
        if not self.collab:
            raise RuntimeError("collab_service required for PULL")

        sync = self.sync_repo.get_by_id(sync_id)
        if not sync or sync.status != "active":
            return None
        if sync.direction == "outbound":
            return None

        connector = self._get_connector(sync.provider)
        if not connector:
            return None

        return await self._pull_one(sync, connector)

    async def pull_all(self, provider: Optional[str] = None) -> List[dict]:
        """Pull changes for all active syncs."""
        if not self.collab:
            raise RuntimeError("collab_service required for PULL")

        syncs = self.sync_repo.list_active(provider)
        results = []
        for sync in syncs:
            if sync.direction == "outbound":
                continue
            connector = self._get_connector(sync.provider)
            if not connector:
                continue
            result = await self._pull_one(sync, connector)
            if result:
                results.append(result)

        if results:
            log_info(f"[L2.5] pull_all: {len(results)} nodes synced")
        return results

    async def _pull_one(
        self, sync: Sync, connector: BaseConnector,
    ) -> Optional[dict]:
        """Pull changes for a single sync binding."""
        try:
            pull_result = await connector.pull(sync)
            if not pull_result:
                return None

            base_content = self._get_base_content(sync)

            external_resource_id = sync.config.get("external_resource_id", "")
            mutation = Mutation(
                type=MutationType.CONTENT_UPDATE,
                operator=Operator(
                    type="sync",
                    id=f"{sync.provider}:{external_resource_id}",
                    summary=pull_result.summary or f"Sync from {sync.provider}",
                ),
                node_id=sync.node_id,
                content=pull_result.content,
                base_version=sync.last_sync_version,
                node_type=pull_result.node_type,
                base_content=base_content,
            )
            commit_result = await self.collab.commit(mutation)

            self.sync_repo.update_sync_point(
                sync_id=sync.id,
                last_sync_version=commit_result.version,
                remote_hash=pull_result.remote_hash,
            )

            log_info(
                f"[L2.5] PULL {sync.provider}:{external_resource_id} → "
                f"node {sync.node_id} v{commit_result.version} ({commit_result.status})"
            )

            return {
                "sync_id": sync.id,
                "node_id": sync.node_id,
                "version": commit_result.version,
                "status": commit_result.status,
            }

        except Exception as e:
            log_error(f"[L2.5] PULL failed for node {sync.node_id}: {e}")
            self.sync_repo.update_error(sync.id, str(e))
            return None

    # ============================================================
    # PUSH: PuppyOne → External
    # ============================================================

    async def push_node(
        self,
        node_id: str,
        version: int,
        content: Any,
        node_type: str,
    ) -> List[dict]:
        """
        Called after L2.commit() succeeds.
        Push changes to the external system bound to this node.
        """
        sync = self.sync_repo.get_by_node(node_id)
        if not sync:
            return []

        if sync.last_sync_version >= version:
            return []

        if sync.status != "active" or sync.direction == "inbound":
            return []

        connector = self._get_connector(sync.provider)
        if not connector:
            return []

        try:
            push_result = await connector.push(sync, content, node_type)

            if push_result.success:
                self.sync_repo.update_sync_point(
                    sync_id=sync.id,
                    last_sync_version=version,
                    remote_hash=push_result.remote_hash,
                )
                external_resource_id = sync.config.get("external_resource_id", "")
                log_info(
                    f"[L2.5] PUSH node {node_id} v{version} → "
                    f"{sync.provider}:{external_resource_id}"
                )
                return [{
                    "node_id": sync.node_id,
                    "provider": sync.provider,
                    "success": True,
                }]
            else:
                self.sync_repo.update_error(sync.id, push_result.error or "push failed")
                return []

        except Exception as e:
            log_error(f"[L2.5] PUSH failed for node {node_id}: {e}")
            self.sync_repo.update_error(sync.id, str(e))
            return []

    # ============================================================
    # Internal helpers
    # ============================================================

    def _get_base_content(self, sync: Sync) -> Optional[str]:
        """Get base content for three-way merge (content at last sync version)."""
        if sync.last_sync_version <= 0 or not self.collab:
            return None
        try:
            ver = self.collab.get_version_content(sync.node_id, sync.last_sync_version)
            if ver.content_text:
                return ver.content_text
            if ver.content_json is not None:
                return json.dumps(ver.content_json, ensure_ascii=False, indent=2)
        except Exception:
            log_debug(f"[L2.5] Could not load base content for v{sync.last_sync_version}")
        return None
